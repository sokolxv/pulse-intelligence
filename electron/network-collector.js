/**
 * Network Graph collector (main process).
 *
 * Attaches the Chrome DevTools Protocol `Network` domain to every <webview>
 * WebContents, normalizes events into NetworkRequest records (contract in
 * src/network/types.ts) and streams batched upserts to the renderer.
 *
 * Data flow:
 *   webview WebContents --CDP--> records --batched IPC--> renderer store
 *
 * Requirements honoured here:
 *  - real network data only (no mock data in production);
 *  - initiator + initiator stack (script url / line / column);
 *  - resource type, method, status, timing, sizes, headers, cache flags;
 *  - bounded memory (ring buffers) + batched flushes (performance §18);
 *  - graceful degradation when DevTools or another debugger owns the target.
 */
const { app, ipcMain } = require('electron');

// Keep in sync with NETGRAPH_CHANNELS in src/network/types.ts
const CH = {
  bind: 'netgraph:bind',
  unbind: 'netgraph:unbind',
  streaming: 'netgraph:streaming',
  clear: 'netgraph:clear',
  status: 'netgraph:status',
  body: 'netgraph:body',
  batch: 'netgraph:batch',
  page: 'netgraph:page',
  statusEvent: 'netgraph:status-event',
};

const FLUSH_INTERVAL_MS = 100;
const MAX_QUEUE = 1000;          // pending outbound records per session
const MAX_RECORDS = 1500;        // ring buffer per session (replay on bind)
const MAX_BODY_CACHE = 24;       // LRU bodies per session
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_STACK_FRAMES = 8;
const MAX_ATTACH_RETRIES = 6;
const MAX_HANDLE_ERRORS = 50;

/** @type {((channel: string, payload: any) => void) | null} */
let send = null;
let streaming = false;
let seq = 0;
let statusTimer = null;
let handleErrors = 0;

/** @type {Map<number, any>} wcId -> session */
const sessions = new Map();

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

function flattenHeaders(h) {
  if (!h) return undefined;
  if (Array.isArray(h)) {
    const out = {};
    for (const entry of h) {
      if (!entry || typeof entry !== 'object') continue;
      const name = entry.name ?? entry.key;
      if (!name) continue;
      out[String(name).toLowerCase()] = String(entry.value ?? '');
    }
    return out;
  }
  if (typeof h === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(h)) {
      out[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
    }
    return out;
  }
  return undefined;
}

function normalizeInitiator(initiator) {
  if (!initiator || typeof initiator !== 'object') return undefined;
  const raw = String(initiator.type || 'other');
  const kind =
    raw === 'parser' || raw === 'script' || raw === 'preload' || raw === 'preflight'
      ? raw
      : 'other';
  const frames = [];
  let stack = initiator.stack;
  while (stack && frames.length < MAX_STACK_FRAMES) {
    const callFrames = Array.isArray(stack.callFrames) ? stack.callFrames : [];
    for (const f of callFrames) {
      if (frames.length >= MAX_STACK_FRAMES) break;
      if (!f || typeof f.url !== 'string') continue;
      frames.push({
        url: f.url,
        functionName: f.functionName ? String(f.functionName) : undefined,
        lineNumber: typeof f.lineNumber === 'number' ? f.lineNumber : undefined,
        columnNumber: typeof f.columnNumber === 'number' ? f.columnNumber : undefined,
      });
    }
    stack = stack.parent;
  }
  const info = { kind, frames };
  if (typeof initiator.url === 'string') info.url = initiator.url;
  if (typeof initiator.documentURL === 'string') info.documentURL = initiator.documentURL;
  if (!info.url && frames.length) info.url = frames[0].url;
  return info;
}

function normalizeTiming(timing) {
  if (!timing || typeof timing !== 'object') return undefined;
  const pick = (k) => (typeof timing[k] === 'number' && timing[k] >= 0 ? Math.round(timing[k]) : undefined);
  const out = {
    dnsStart: pick('dnsStart'),
    dnsEnd: pick('dnsEnd'),
    connectStart: pick('connectStart'),
    connectEnd: pick('connectEnd'),
    sslStart: pick('sslStart'),
    sslEnd: pick('sslEnd'),
    sendStart: pick('sendStart'),
    sendEnd: pick('sendEnd'),
    receiveHeadersEnd: pick('receiveHeadersEnd'),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

function classifyCdpType(type) {
  switch (type) {
    case 'Document': return 'document';
    case 'Stylesheet': return 'stylesheet';
    case 'Image': return 'image';
    case 'Media': return 'media';
    case 'Font': return 'font';
    case 'Script': return 'script';
    case 'XHR': return 'xhr';
    case 'Fetch': return 'fetch';
    case 'WebSocket': return 'websocket';
    case 'EventSource':
    case 'Prefetch':
    case 'SignedExchange': return 'fetch';
    default: return 'other';
  }
}

function pushRecord(session, rec) {
  session.all.set(rec.id, rec);
  if (session.all.size > MAX_RECORDS) {
    const first = session.all.keys().next().value;
    session.all.delete(first);
  }
  if (session.tabId && streaming) {
    session.queue.set(rec.id, rec);
    if (session.queue.size > MAX_QUEUE) {
      const first = session.queue.keys().next().value;
      session.queue.delete(first);
    }
  }
}

function emitStatus() {
  if (statusTimer) return;
  statusTimer = setTimeout(() => {
    statusTimer = null;
    sendStatus();
  }, 300);
}

function sendStatus() {
  if (!send) return;
  let attached = 0;
  let bound = 0;
  for (const s of sessions.values()) {
    if (s.attached) attached += 1;
    if (s.tabId) bound += 1;
  }
  send(CH.statusEvent, {
    available: attached > 0,
    streaming,
    boundTabs: bound,
    trackedTabs: sessions.size,
    source: attached > 0 || sessions.size > 0 ? 'live' : 'unavailable',
    message: sessions.size === 0
      ? 'No webviews tracked yet'
      : attached === 0
        ? 'Debugger not attached to any webview'
        : undefined,
  });
}

function flushSession(session, { replay = false } = {}) {
  if (!send) return;
  if (!session.tabId || !streaming) return;
  if (!session.queue.size && !replay) return;
  const source = replay ? session.all : session.queue;
  const batch = [];
  for (const rec of source.values()) {
    batch.push(rec);
    if (!replay) session.queue.delete(rec.id);
    if (batch.length >= 250) break;
  }
  if (!batch.length) return;
  if (replay) session.queue.clear();
  send(CH.batch, {
    tabId: session.tabId,
    wcId: session.wcId,
    pageLoadId: session.loadId,
    requests: batch,
  });
}

function flushAll(replay = false) {
  for (const s of sessions.values()) flushSession(s, { replay });
}

function scheduleFlush(session) {
  if (session.flushTimer) return;
  session.flushTimer = setTimeout(() => {
    session.flushTimer = null;
    flushSession(session);
  }, FLUSH_INTERVAL_MS);
}

// ── CDP message handling ────────────────────────────────────────────────

function getRecord(session, cdpId) {
  const ourId = session.byCdp.get(cdpId);
  return ourId ? session.all.get(ourId) : undefined;
}

function markRecord(session, rec) {
  if (!rec) return;
  pushRecord(session, rec);
  scheduleFlush(session);
}

function onRequestWillBeSent(session, p) {
  const { requestId, request, timestamp, wallTime, initiator, type, documentURL, redirectResponse } = p;
  let previous = null;

  if (redirectResponse) {
    previous = getRecord(session, requestId);
    if (previous) {
      previous.status = redirectResponse.status;
      previous.statusText = redirectResponse.statusText;
      previous.responseHeaders = flattenHeaders(redirectResponse.headers) || previous.responseHeaders;
      previous.mimeType = redirectResponse.mimeType || previous.mimeType;
      previous.protocol = redirectResponse.protocol || previous.protocol;
      previous.cache = Boolean(redirectResponse.fromDiskCache || redirectResponse.fromPrefetchCache);
      previous.state = 'finished';
      previous.endTime = previous.startTime + Math.round((timestamp - (previous._startTs ?? timestamp)) * 1000);
      previous.duration = Math.max(0, previous.endTime - previous.startTime);
      delete previous._startTs;
      markRecord(session, previous);
    }
  }

  const rec = {
    id: `${session.wcId}:${++seq}`,
    tabId: session.tabId || undefined,
    wcId: session.wcId,
    cdpRequestId: requestId,
    pageLoadId: session.loadId,
    url: String(request.url || ''),
    method: String(request.method || 'GET'),
    type: classifyCdpType(type),
    cdpType: type,
    initiator: initiator && typeof initiator.url === 'string' ? initiator.url : undefined,
    initiatorInfo: normalizeInitiator(initiator),
    domain: hostOf(request.url),
    origin: session.pageUrl ? originOf(session.pageUrl) : undefined,
    requestHeaders: flattenHeaders(request.headers),
    requestSize: request.postData
      ? Buffer.byteLength(String(request.postData), 'utf8')
      : undefined,
    startTime: Math.round((wallTime || Date.now() / 1000) * 1000),
    state: 'pending',
    priority: request.initialPriority ? String(request.initialPriority) : undefined,
  };
  if (documentURL) rec.documentURL = documentURL;
  if (previous && previous.url !== rec.url) {
    rec.redirectedFrom = previous.id;
    previous.redirectedTo = rec.id;
  }

  session.byCdp.set(requestId, rec.id);
  session.ts.set(rec.id, { startTs: timestamp, requestTime: p.wallTime });
  markRecord(session, rec);
}

function onExtraInfo(session, p) {
  const rec = getRecord(session, p.requestId);
  if (!rec) return;
  const headers = flattenHeaders(p.headers) || flattenHeaders(p.rawHeaders);
  if (headers) rec.requestHeaders = { ...headers, ...(rec.requestHeaders || {}) };
  markRecord(session, rec);
}

function onResponseReceived(session, p) {
  const rec = getRecord(session, p.requestId);
  if (!rec) return;
  const r = p.response || {};
  rec.status = typeof r.status === 'number' ? r.status : undefined;
  rec.statusText = r.statusText ? String(r.statusText) : undefined;
  rec.responseHeaders = flattenHeaders(r.headers) || rec.responseHeaders;
  rec.mimeType = r.mimeType ? String(r.mimeType) : rec.mimeType;
  rec.protocol = r.protocol ? String(r.protocol) : rec.protocol;
  rec.remoteIPAddress = r.remoteIPAddress ? String(r.remoteIPAddress) : undefined;
  rec.cache = Boolean(r.fromDiskCache || r.fromPrefetchCache);
  rec.fromServiceWorker = Boolean(r.fromServiceWorker);
  rec.timing = normalizeTiming(r.timing) || rec.timing;
  if (p.type && rec.type === 'other') rec.type = classifyCdpType(p.type);
  markRecord(session, rec);
}

function onResponseExtra(session, p) {
  const rec = getRecord(session, p.requestId);
  if (!rec) return;
  const headers = flattenHeaders(p.headers) || flattenHeaders(p.rawHeaders);
  if (headers) rec.responseHeaders = { ...headers, ...(rec.responseHeaders || {}) };
  markRecord(session, rec);
}

function finishRecord(session, cdpId, { size, state, errorText, timestamp }) {
  const rec = getRecord(session, cdpId);
  if (!rec) return;
  const meta = session.ts.get(rec.id);
  const endTs = typeof timestamp === 'number' ? timestamp : undefined;
  if (meta && typeof endTs === 'number') {
    rec.endTime = rec.startTime + Math.max(0, Math.round((endTs - meta.startTs) * 1000));
    rec.duration = rec.endTime - rec.startTime;
  } else {
    rec.endTime = Date.now();
    rec.duration = Math.max(0, rec.endTime - rec.startTime);
  }
  if (typeof size === 'number') rec.responseSize = size;
  rec.state = state;
  if (errorText) rec.errorText = String(errorText);
  delete rec._startTs;
  markRecord(session, rec);
}

function onDataReceived(session, p) {
  const rec = getRecord(session, p.requestId);
  if (!rec) return;
  rec.responseSize = (rec.responseSize || 0) + (p.dataLength || 0);
}

function onWebSocket(session, method, p) {
  if (method === 'Network.webSocketCreated') {
    const existing = getRecord(session, p.requestId);
    if (existing && existing.type === 'websocket') return;
    const rec = {
      id: `${session.wcId}:${++seq}`,
      tabId: session.tabId || undefined,
      wcId: session.wcId,
      cdpRequestId: `${p.requestId}::ws`,
      pageLoadId: session.loadId,
      url: String(p.url || ''),
      method: 'WS',
      type: 'websocket',
      cdpType: 'WebSocket',
      domain: hostOf(p.url),
      origin: session.pageUrl ? originOf(session.pageUrl) : undefined,
      initiator: p.initiator && typeof p.initiator.url === 'string' ? p.initiator.url : undefined,
      initiatorInfo: normalizeInitiator(p.initiator),
      startTime: Date.now(),
      state: 'pending',
    };
    session.byCdp.set(`${p.requestId}::ws`, rec.id);
    markRecord(session, rec);
    return;
  }
  const wsId = `${p.requestId}::ws`;
  const rec = getRecord(session, wsId) || getRecord(session, p.requestId);
  if (!rec) return;
  if (method === 'Network.webSocketWillSendHandshakeRequest') {
    rec.requestHeaders = flattenHeaders(p.request && p.request.headers) || rec.requestHeaders;
    if (typeof p.timestamp === 'number') rec.startTime = Math.round(p.timestamp * 1000);
  } else if (method === 'Network.webSocketHandshakeResponse') {
    const r = p.response || {};
    rec.status = r.status;
    rec.statusText = r.statusText ? String(r.statusText) : undefined;
    rec.responseHeaders = flattenHeaders(r.headers) || rec.responseHeaders;
    rec.mimeType = 'websocket';
    rec.protocol = 'ws';
  } else if (method === 'Network.webSocketClosed') {
    rec.state = 'finished';
    if (typeof p.timestamp === 'number') {
      rec.endTime = Math.round(p.timestamp * 1000);
      rec.duration = Math.max(0, rec.endTime - rec.startTime);
    }
  } else if (method === 'Network.webSocketFrameError') {
    rec.state = 'failed';
    rec.errorText = String(p.errorMessage || 'websocket frame error');
  }
  markRecord(session, rec);
}

function onPageFrameNavigated(session, p) {
  const frame = p && p.frame;
  if (!frame) return;
  if (session.mainFrameId && frame.id !== session.mainFrameId) return;
  if (frame.parentId) return;
  const url = String(frame.url || '');
  if (!url || url === 'about:blank') return;
  session.loadId += 1;
  session.pageUrl = url;
  // New page load starts a new graph — drop the old ring buffer.
  session.all.clear();
  session.queue.clear();
  session.byCdp.clear();
  session.ts.clear();
  send(CH.page, {
    tabId: session.tabId || undefined,
    wcId: session.wcId,
    pageLoadId: session.loadId,
    url,
    ts: Date.now(),
  });
  emitStatus();
}

function handleMessage(session, method, params) {
  try {
    switch (method) {
      case 'Network.requestWillBeSent': onRequestWillBeSent(session, params); break;
      case 'Network.requestWillBeSentExtraInfo': onExtraInfo(session, params); break;
      case 'Network.responseReceived': onResponseReceived(session, params); break;
      case 'Network.responseReceivedExtraInfo': onResponseExtra(session, params); break;
      case 'Network.loadingFinished':
        finishRecord(session, params.requestId, { size: params.encodedDataLength, state: 'finished', timestamp: params.timestamp });
        break;
      case 'Network.loadingFailed':
        finishRecord(session, params.requestId, {
          state: params.canceled ? 'canceled' : 'failed',
          errorText: params.errorText || params.blockedReason,
          timestamp: params.timestamp,
        });
        break;
      case 'Network.dataReceived': onDataReceived(session, params); break;
      case 'Network.webSocketCreated':
      case 'Network.webSocketWillSendHandshakeRequest':
      case 'Network.webSocketHandshakeResponse':
      case 'Network.webSocketClosed':
      case 'Network.webSocketFrameError':
        onWebSocket(session, method, params);
        break;
      case 'Page.frameNavigated': onPageFrameNavigated(session, params); break;
      default: break;
    }
  } catch (err) {
    handleErrors += 1;
    if (handleErrors === 1) console.warn('[netgraph] handler error:', err && err.message);
    if (handleErrors > MAX_HANDLE_ERRORS) {
      console.warn('[netgraph] too many handler errors, detaching');
      detachDebugger(session);
    }
  }
}

// ── debugger lifecycle ──────────────────────────────────────────────────

function attachDebugger(session) {
  if (!session || session.destroyed || session.attached || session.attaching) return;
  if (session.devtools || session.retryCount > MAX_ATTACH_RETRIES) return;
  const contents = session.contents;
  if (!contents || contents.isDestroyed()) return;
  const dbg = contents.debugger;
  session.attaching = true;
  try {
    dbg.attach('1.3');
  } catch (err) {
    session.attaching = false;
    session.retryCount += 1;
    const delay = Math.min(8000, 400 * session.retryCount);
    session.retryTimer = setTimeout(() => {
      session.retryTimer = null;
      attachDebugger(session);
    }, delay);
    emitStatus();
    return;
  }

  session.debugger = dbg;
  session.attached = true;
  session.attaching = false;
  session.messageHandler = (_event, method, params) => handleMessage(session, method, params);
  session.detachHandler = () => {
    session.attached = false;
    session.debugger = null;
    emitStatus();
    // Someone else (devtools / crashed target) took over — retry later.
    if (!session.destroyed && !session.devtools) {
      session.retryCount += 1;
      session.retryTimer = setTimeout(() => {
        session.retryTimer = null;
        attachDebugger(session);
      }, 1000);
    }
  };
  dbg.on('message', session.messageHandler);
  dbg.on('detach', session.detachHandler);

  try {
    dbg.sendCommand('Network.enable', {
      maxTotalBufferSize: 100000000,
      maxResourceBufferSize: 50000000,
      maxPostDataSize: 65536,
    });
    dbg.sendCommand('Page.enable');
    dbg.sendCommand('Page.getFrameTree')
      .then((tree) => {
        const frame = tree && tree.frameTree && tree.frameTree.frame;
        if (frame && frame.id) session.mainFrameId = frame.id;
        if (frame && frame.url && frame.url !== 'about:blank' && session.loadId === 0) {
          session.loadId = 1;
          session.pageUrl = frame.url;
        }
      })
      .catch(() => {});
  } catch (err) {
    // attach succeeded but a command failed — keep session, it will settle.
    console.warn('[netgraph] command error:', err && err.message);
  }
  session.retryCount = 0;
  emitStatus();
}

function detachDebugger(session) {
  if (!session) return;
  if (session.retryTimer) { clearTimeout(session.retryTimer); session.retryTimer = null; }
  if (session.flushTimer) { clearTimeout(session.flushTimer); session.flushTimer = null; }
  if (!session.attached || !session.debugger) { session.attached = false; return; }
  try {
    if (session.messageHandler) session.debugger.removeListener('message', session.messageHandler);
    if (session.detachHandler) session.debugger.removeListener('detach', session.detachHandler);
    if (session.debugger.isAttached()) session.debugger.detach();
  } catch { /* already detached */ }
  session.attached = false;
  session.debugger = null;
  emitStatus();
}

function createSession(contents) {
  const wcId = contents.id;
  if (sessions.has(wcId)) return;
  const session = {
    wcId,
    contents,
    tabId: null,
    attached: false,
    attaching: false,
    devtools: false,
    destroyed: false,
    retryCount: 0,
    retryTimer: null,
    flushTimer: null,
    debugger: null,
    messageHandler: null,
    detachHandler: null,
    loadId: 0,
    mainFrameId: null,
    pageUrl: '',
    all: new Map(),
    queue: new Map(),
    byCdp: new Map(),
    ts: new Map(),
    bodies: new Map(),
    handleErrors: 0,
  };
  sessions.set(wcId, session);

  contents.on('destroyed', () => destroySession(wcId));
  contents.on('devtools-opened', () => {
    session.devtools = true;
    detachDebugger(session);
    emitStatus();
  });
  contents.on('devtools-closed', () => {
    session.devtools = false;
    session.retryCount = 0;
    attachDebugger(session);
    emitStatus();
  });

  attachDebugger(session);
  emitStatus();
}

function destroySession(wcId) {
  const session = sessions.get(wcId);
  if (!session) return;
  session.destroyed = true;
  detachDebugger(session);
  sessions.delete(wcId);
  emitStatus();
}

// ── IPC ─────────────────────────────────────────────────────────────────

async function handleBind(_event, tabId, wcId) {
  const session = sessions.get(wcId);
  if (!session) {
    // WebContents may not exist yet (renderer raced us) — track by polling once.
    return { ok: false, error: `unknown webContents ${wcId}` };
  }
  if (session.destroyed) return { ok: false, error: 'webContents destroyed' };
  session.tabId = String(tabId);
  if (!session.attached) {
    session.retryCount = 0;
    attachDebugger(session);
  }
  if (session.loadId === 0 && session.pageUrl && session.pageUrl !== 'about:blank') {
    session.loadId = 1;
  }
  const page = session.pageUrl && session.pageUrl !== 'about:blank'
    ? { tabId: session.tabId, wcId, pageLoadId: session.loadId, url: session.pageUrl, ts: Date.now() }
    : undefined;
  flushSession(session, { replay: true });
  emitStatus();
  return { ok: true, page };
}

function handleUnbind(_event, tabId, wcId) {
  const session = sessions.get(wcId);
  if (!session) return;
  if (session.tabId === String(tabId)) {
    session.tabId = null;
    session.queue.clear();
  }
  emitStatus();
}

function handleStreaming(_event, on) {
  streaming = Boolean(on);
  if (streaming) flushAll();
  emitStatus();
}

function handleClear(_event, tabId) {
  for (const session of sessions.values()) {
    if (tabId && session.tabId !== String(tabId)) continue;
    session.all.clear();
    session.queue.clear();
    session.byCdp.clear();
    session.ts.clear();
    session.bodies.clear();
  }
}

function handleStatus() {
  let attached = 0;
  let bound = 0;
  for (const s of sessions.values()) {
    if (s.attached) attached += 1;
    if (s.tabId) bound += 1;
  }
  return {
    available: attached > 0 || sessions.size > 0,
    streaming,
    boundTabs: bound,
    trackedTabs: sessions.size,
    source: sessions.size > 0 ? 'live' : 'unavailable',
    message: sessions.size === 0 ? 'Open a page to start collecting network events' : undefined,
  };
}

async function handleGetBody(_event, wcId, cdpRequestId, kind) {
  const session = sessions.get(Number(wcId));
  if (!session || !session.attached || !session.debugger) {
    return { ok: false, error: 'CDP session not attached' };
  }
  const cacheKey = `${cdpRequestId}:${kind}`;
  const cached = session.bodies.get(cacheKey);
  if (cached) {
    session.bodies.delete(cacheKey);
    session.bodies.set(cacheKey, cached);
    return cached;
  }
  try {
    const result = kind === 'request'
      ? await session.debugger.sendCommand('Network.getRequestPostData', { requestId: cdpRequestId })
      : await session.debugger.sendCommand('Network.getResponseBody', { requestId: cdpRequestId });
    let body = String(result && result.body != null ? result.body : '');
    let truncated = false;
    if (body.length > MAX_BODY_BYTES) {
      body = body.slice(0, MAX_BODY_BYTES);
      truncated = true;
    }
    const out = {
      ok: true,
      body,
      base64Encoded: Boolean(result && result.base64Encoded),
      truncated,
    };
    session.bodies.set(cacheKey, out);
    if (session.bodies.size > MAX_BODY_CACHE) {
      const first = session.bodies.keys().next().value;
      session.bodies.delete(first);
    }
    return out;
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * @param {{ getMainWindow: () => any }} opts
 */
function initNetworkCollector(opts) {
  send = (channel, payload) => {
    try {
      const win = opts.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    } catch { /* window gone */ }
  };

  app.on('web-contents-created', (_event, contents) => {
    try {
      if (contents.getType() === 'webview') createSession(contents);
    } catch (err) {
      console.warn('[netgraph] createSession failed:', err && err.message);
    }
  });

  ipcMain.handle(CH.bind, handleBind);
  ipcMain.on(CH.unbind, handleUnbind);
  ipcMain.on(CH.streaming, handleStreaming);
  ipcMain.on(CH.clear, handleClear);
  ipcMain.handle(CH.status, handleStatus);
  ipcMain.handle(CH.body, handleGetBody);

  return { sessions, flushAll };
}

module.exports = { initNetworkCollector, CH };
