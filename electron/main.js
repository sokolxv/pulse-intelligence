const { app, BrowserWindow, ipcMain, shell, session, dialog, net: electronNet, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, execSync, spawn } = require('child_process');
const { AdBlocker } = require('./adblocker');
const os = require('os');
const dns = require('dns');
const net = require('net');
let privProxy = null;
try { privProxy = require('./privacy-proxy'); } catch { privProxy = null; }

const SAFE_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

function isTrustedPermissionOrigin(webContents, requestingOrigin) {
  const candidate = requestingOrigin || webContents?.getURL?.() || '';
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isPermissionAllowed(webContents, permission, requestingOrigin) {
  return SAFE_PERMISSIONS.has(permission) && isTrustedPermissionOrigin(webContents, requestingOrigin);
}

const _dR = (s) => { try { return Buffer.from(s, 'base64').toString(); } catch { return s; } };
const _privDirR = _dR('cHJpdmFjeQ==');
const _helperR = _dR('cHVsc2UtaGVscGVyLmV4ZQ==');
function getPackagedHelperPath() {
  try {
    if (app.isPackaged) {
      const p = path.join(process.resourcesPath, _privDirR, _helperR);
      try { if (require('fs').existsSync(p)) return p; } catch {}
      return p;
    }
  } catch {}
  return null;
}

const isDev = !app.isPackaged;

let mainWindow;
const adBlocker = new AdBlocker();

// ── Network Graph: real CDP network capture for every <webview> ─────────
let networkCollector = null;
try {
  const { initNetworkCollector } = require('./network-collector');
  networkCollector = initNetworkCollector({ getMainWindow: () => mainWindow });
} catch (err) {
  console.warn('[netgraph] init failed:', err && err.message);
}

function generateRandomUA() {
  const chromeVersions = ['120.0.0.0','121.0.0.0','122.0.0.0','123.0.0.0','124.0.0.0','125.0.0.0','126.0.0.0'];
  const platforms = [
    (v) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`,
    (v) => `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`,
    (v) => `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`,
    (v) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36 Edg/${v}`,
    (v) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36 OPR/${v}`,
  ];
  const v = chromeVersions[Math.floor(Math.random() * chromeVersions.length)];
  const fn = platforms[Math.floor(Math.random() * platforms.length)];
  return fn(v);
}

let currentUserAgent = generateRandomUA();
console.log('[Pulse] Generated UA:', currentUserAgent);

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const mod = input.control || input.meta;
      // e.code-based: works on any keyboard layout (RU 'к' → KeyR etc.)
      let key = (input.key || '').toLowerCase();
      if (/^Key[A-Z]$/.test(input.code || '')) key = input.code.slice(3).toLowerCase();
      let action = null;
      if (mod && key === 't' && !input.shift) action = 'new-tab';
      else if (mod && key === 'w' && !input.shift) action = 'close-tab';
      else if (mod && input.shift && key === 't') action = 'restore-tab';
      else if (mod && input.shift && key === 'w') action = 'close-others';
      else if (mod && input.key === 'Tab' && !input.shift) action = 'next-tab';
      else if (mod && input.key === 'Tab' && input.shift) action = 'prev-tab';
      else if (mod && key === 'l') action = 'focus-url';
      else if ((mod && key === 'r') || input.key === 'F5') action = 'reload';
      else if (mod && key === 'd') action = 'bookmark';
      else if (mod && key === 'k') action = 'palette';
      else if (mod && key === 'f') action = 'find';
      else if (mod && input.shift && key === 'g') action = 'netgraph';
      else if (mod && (key === '/' || input.key === '?')) action = 'shortcuts';
      else if (input.key === 'F12') action = 'devtools';
      else if (mod && /^[0-9]$/.test(input.key)) {
        if (input.key === '0') action = 'switch-last';
        else action = `switch-${input.key}`;
      }
      if (action) {
        event.preventDefault();
        mainWindow?.webContents.send('shortcut', action);
      }
    });
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0A0A0C',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  // ── Tor proxy is user-controlled; do NOT auto-apply to persist:main ──
  // Only apply to private partitions if user explicitly enables it
  // (privacy-enable-routing IPC will set it when user enables Tor)
  try {
    const direct = { proxyRules: '' };
    for (const part of ['persist:main', 'persist:private', 'private']) {
      try {
        const ses = session.fromPartition(part);
        if (ses.setProxy) ses.setProxy(direct).catch(()=>{});
      } catch {}
    }
    if (session.defaultSession.setProxy) session.defaultSession.setProxy(direct).catch(()=>{});
    logPriv('webview proxy set to direct (no Tor) by default');
  } catch {}

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ── Set random User-Agent for all sessions ──────────────
  try {
    for (const part of ['persist:main', 'persist:private', 'private']) {
      try {
        const ses = session.fromPartition(part);
        if (ses.setUserAgent) ses.setUserAgent(currentUserAgent);
      } catch {}
    }
    if (session.defaultSession.setUserAgent) session.defaultSession.setUserAgent(currentUserAgent);
    if (mainWindow.webContents.setUserAgent) mainWindow.webContents.setUserAgent(currentUserAgent);
  } catch (e) {
    console.warn('[Pulse] setUserAgent failed:', e.message);
  }

  // Force User-Agent header on every request (fallback) — all partitions
  const injectUA = (details, callback) => {
    const headers = { ...details.requestHeaders };
    headers['User-Agent'] = currentUserAgent;
    headers['Accept-Language'] = 'en-US,en;q=0.9,ru;q=0.8';
    callback({ requestHeaders: headers });
  };
  try {
    for (const part of ['persist:main', 'persist:private', 'private']) {
      try { session.fromPartition(part).webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, injectUA); } catch {}
    }
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, injectUA);
  } catch (e) {
    console.warn('[Pulse] onBeforeSendHeaders UA inject failed:', e.message);
  }

  // Deny privileged permissions by default; allow only a small secure-origin allowlist.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(isPermissionAllowed(wc, permission, details?.requestingOrigin));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) =>
    isPermissionAllowed(wc, permission, requestingOrigin)
  );
  for (const part of ['persist:main', 'persist:private', 'private']) {
    try {
      const ses = session.fromPartition(part);
      ses.setPermissionRequestHandler((wc, permission, callback, details) => {
        callback(isPermissionAllowed(wc, permission, details?.requestingOrigin));
      });
      ses.setPermissionCheckHandler((wc, permission, requestingOrigin) =>
        isPermissionAllowed(wc, permission, requestingOrigin)
      );
    } catch {}
  }

  try { adBlocker.setMainWindowGetter(() => mainWindow); } catch {}
  adBlocker.startIntercepting();

  // ── Launch Tor in background and apply routing ONLY when it really bootstrapped ──
  // Важно: открытый SOCKS-порт ещё не означает рабочий Tor (порт слушается задолго
  // до готовности цепочек — в странах с блокировками bootstrap висит вечно).
  // Роутинг на незабутстрапленный процесс = белый экран и вечная загрузка.
  if (privProxy) {
    (async () => {
      try {
        const sendState = (ch, payload) => { try { mainWindow?.webContents.send(ch, payload); } catch {} };
        const alreadyRunning = await privProxy.isHelperRunning();
        if (!alreadyRunning) {
          const ok = await privProxy.launchHelper();
          if (ok) {
            for (let i = 0; i < 50; i++) {
              await new Promise(r => setTimeout(r, 800));
              const st = privProxy.getHelperStatus();
              if (st.ready) break;
              if (i % 5 === 0) logPriv(`Tor bootstrapping... ${i + 1}s`);
            }
          } else {
            logPriv('Tor helper not available');
          }
        } else {
          logPriv('Tor already running, verifying bootstrap', privProxy.getHelperStatus().port);
          // NOTE: no privacy-identity-changed here — it would wipe restored session on every cold start
        }
        const st = privProxy.getHelperStatus();
        let pct = -1;
        try { pct = await privProxy.getBootstrapPercent(); } catch {}
        const verified = st.ready || pct === 100;
        if (verified) {
          await privProxy.setupPrivacyRouting();
          logPriv('Tor bootstrapped, routing active on', privProxy.getHelperStatus().port);
          setTimeout(() => { sendState('privacy-routing-enabled'); }, alreadyRunning ? 400 : 600);
          // Фоновая сквозная проверка: если цепочки мёртвые — откат на прямое соединение
          probePrivacyRouting().then(async (alive) => {
            if (!alive) {
              try { await privProxy.clearPrivacyRouting(); } catch {}
              logPriv('Tor routing probe failed — fell back to direct connection');
              sendState('privacy-routing-failed', { reason: 'probe' });
            }
          });
        } else {
          try { await privProxy.clearPrivacyRouting(); } catch {}
          logPriv(`Tor not bootstrapped (bootstrap=${pct}%) — staying on direct connection`);
          sendState('privacy-routing-failed', { reason: 'tor-bootstrap', bootstrap: pct });
        }
      } catch (e) {
        logPriv('Tor background launch failed', e.message);
        try { await privProxy.clearPrivacyRouting(); } catch {}
        try { mainWindow?.webContents.send('privacy-routing-failed', { reason: 'launch-error' }); } catch {}
      }
    })();
  }
}

// Сквозная проба: реально ли ходят запросы через текущий маршрут.
// Используется ПОСЛЕ включения роутинга — если Tor не строит цепочки,
// откатываемся на прямое соединение вместо белого экрана.
async function probePrivacyRouting() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, 12000);
    const res = await electronNet.fetch('https://connectivitycheck.gstatic.com/generate_204', { signal: ctrl.signal });
    clearTimeout(timer);
    return !!res && res.status === 204;
  } catch {
    return false;
  }
}

// ── Window controls IPC ─────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized());

// ── External links ──────────────────────────────────────────
ipcMain.on('open-external', (_, url) => {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return;
  } catch { return; }
  shell.openExternal(url);
});

// ── Ad blocker IPC ──────────────────────────────────────────
ipcMain.handle('adblocker-get-stats', () => adBlocker.getStats());
ipcMain.handle('adblocker-get-per-site-stats', () => {
  try { return adBlocker.getPerSiteStats(); } catch { return []; }
});
ipcMain.handle('adblocker-get-site-stats', (_, host) => {
  try { return adBlocker.getSiteStats(host); } catch { return null; }
});
ipcMain.handle('adblocker-get-all-stats', () => {
  try { return adBlocker.getAllStats(); } catch { return adBlocker.getStats(); }
});
ipcMain.handle('adblocker-toggle-site', (_, host, enabled) => {
  try { adBlocker.toggleSite(host, enabled); } catch {}
  return { success: true };
});
ipcMain.handle('adblocker-clear-site', (_, host) => {
  try { adBlocker.clearSite(host); } catch {}
  return { success: true };
});
ipcMain.handle('adblocker-clear-all', () => {
  try { adBlocker.clearAll(); } catch {}
  return { success: true };
});
ipcMain.on('adblocker-toggle', (_, enabled) => adBlocker.toggle(enabled));
ipcMain.on('adblocker-reset-count', () => adBlocker.resetCount());

// ── User Agent ──────────────────────────────────────────────
ipcMain.handle('get-user-agent', () => currentUserAgent);
ipcMain.handle('get-random-ua', () => {
  currentUserAgent = generateRandomUA();
  try {
    for (const part of ['persist:main', 'persist:private', 'private']) {
      try { session.fromPartition(part).setUserAgent(currentUserAgent); } catch {}
    }
    session.defaultSession.setUserAgent(currentUserAgent);
    mainWindow?.webContents.setUserAgent(currentUserAgent);
  } catch {}
  return currentUserAgent;
});

// ── Webview devtools ────────────────────────────────────────
ipcMain.on('webview-devtools', (_event, _id) => {
  mainWindow?.webContents.send('open-webview-devtools', _id);
});

// ══════════════════════════════════════════════════════════════
// REAL TOOL IPC HANDLERS
// ══════════════════════════════════════════════════════════════

// ── Execute shell command (Terminal) ────────────────────────
const CURL_OPTIONS_WITH_VALUES = new Set(['--max-time', '--connect-timeout', '-o', '-w', '-H', '--header', '--data', '--data-raw', '--data-binary', '--data-urlencode', '-X', '--request']);
const CURL_OPTIONS = new Set(['-s', '-S', '-sS', '-i', '-I', '-L', '--location', '--compressed']);

function parseAllowedCurlCommand(command) {
  const input = String(command || '').trim();
  if (!input || /[\r\n;&|`<>]/.test(input) || /\$\(|\b(?:powershell|cmd|bash|sh|node|python|wscript|cscript)\b/i.test(input)) {
    return { error: 'Only a direct curl command is allowed' };
  }

  const rawTokens = input.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g) || [];
  const tokens = rawTokens.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1).replace(/\\([\\"'])/g, '$1');
    }
    return token;
  });
  if (tokens.length === 0 || !/^curl(?:\.exe)?$/i.test(tokens[0])) {
    return { error: 'Only curl is allowed for native requests' };
  }

  const args = [];
  const urls = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (CURL_OPTIONS.has(token)) {
      args.push(token);
      continue;
    }
    if (CURL_OPTIONS_WITH_VALUES.has(token)) {
      const value = tokens[++index];
      if (value === undefined || value.length > 4096) return { error: `Missing or oversized value for ${token}` };
      if (token === '-o' && !['/dev/null', 'NUL'].includes(value)) return { error: 'curl output files are not allowed' };
      if (token === '--max-time' || token === '--connect-timeout') {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 30) return { error: 'curl timeout must be between 0 and 30 seconds' };
      }
      args.push(token, value);
      continue;
    }
    if (/^https?:\/\//i.test(token)) {
      try {
        const url = new URL(token);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
        if (url.username || url.password) throw new Error('credentials in URL are not allowed');
        if (isPrivateIP(url.hostname)) throw new Error('private hosts are not allowed');
      } catch (e) {
        if (e.message === 'unsupported protocol' || e.message === 'credentials in URL are not allowed' || e.message === 'private hosts are not allowed') {
          return { error: e.message };
        }
        return { error: 'Invalid HTTP(S) URL' };
      }
      urls.push(token);
      args.push(token);
      continue;
    }
    return { error: `curl option or HTTP(S) URL is not allowed: ${token}` };
  }
  if (urls.length === 0) return { error: 'curl requires an HTTP(S) URL' };
  return { args };
}

ipcMain.handle('exec-command', async (_event, command, timeoutMs = 15000) => {
  const parsed = parseAllowedCurlCommand(command);
  if (parsed.error) {
    return { stdout: '', stderr: parsed.error, exitCode: -1, duration: 0 };
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    const effectiveTimeout = Math.min(Math.max(Number(timeoutMs) || 15000, 1000), 30000);
    const curlBinary = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const proc = spawn(curlBinary, parsed.args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    const timeout = setTimeout(() => proc.kill(), effectiveTimeout);

    proc.stdout?.on('data', (data) => { stdout += data; });
    proc.stderr?.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        stdout: stdout.slice(0, 1024 * 1024).trim(),
        stderr: stderr.slice(0, 1024 * 1024).trim(),
        exitCode: code ?? -1,
        duration: Date.now() - startTime,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: -1,
        duration: Date.now() - startTime,
      });
    });
  });
});

// ── HTTP Client request bridge ─────────────────────────────
ipcMain.handle('http-request', async (_event, request = {}) => {
  const method = String(request.method || 'GET').toUpperCase();
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  if (!allowedMethods.has(method)) return { ok: false, error: 'Unsupported HTTP method' };

  let target;
  try {
    target = new URL(String(request.url || ''));
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Only HTTP(S) URLs are supported');
    if (target.username || target.password) throw new Error('Credentials in URL are not allowed');
    const host = target.hostname;
    if (net.isIP(host) ? isPrivateIP(host) : isPrivateIP(host)) throw new Error('Private IP not allowed');
  } catch (error) {
    return { ok: false, error: error.message || 'Invalid URL' };
  }

  const timeoutMs = Math.min(Math.max(Number(request.timeoutMs) || 15000, 1000), 30000);
  const headers = request.headers && typeof request.headers === 'object' ? request.headers : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await electronNet.fetch(target.toString(), {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : String(request.body || ''),
      redirect: 'follow',
      signal: controller.signal,
    });
    const responseText = await response.text();
    const maxResponseBytes = 2 * 1024 * 1024;
    if (Buffer.byteLength(responseText, 'utf8') > maxResponseBytes) {
      return { ok: false, error: 'Response exceeds the 2 MB limit' };
    }
    const responseHeaders = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseText,
    };
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? 'Request timed out' : (error.message || 'Request failed') };
  } finally {
    clearTimeout(timer);
  }
});

// ── Get system info ─────────────────────────────────────────
ipcMain.handle('get-system-info', () => {
  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    ips: getNetworkInterfaces(),
    gateway: getDefaultGateway(),
  };
});

// ── Get network interfaces ──────────────────────────────────
ipcMain.handle('get-network-interfaces', () => {
  return getNetworkInterfaces();
});

const DNS_RECORD_TYPES = new Set(['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'CAA', 'DNSKEY']);

function isValidHost(value) {
  const host = String(value || '').trim();
  if (!host || host.length > 253 || /\s|[\\/;|&`$<>]/.test(host)) return false;
  if (net.isIP(host)) return true;
  return /^(?=.{1,253}$)(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.)*[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.?$/.test(host);
}

function isPrivateIP(value) {
  const host = String(value || '').trim();
  if (!host) return false;
  if (net.isIP(host)) {
    const ip = net.isIP(host);
    if (ip === 4) {
      const parts = host.split('.').map(Number);
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 127) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
      if (parts[0] === 0) return true;
    }
    return false;
  }
  const hostLower = host.toLowerCase();
  if (hostLower === 'localhost') return true;
  if (hostLower.endsWith('.local')) return true;
  if (hostLower.endsWith('.internal')) return true;
  if (hostLower.match(/^0\.0\.0\.0$/)) return true;
  return false;
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), minimum), maximum);
}

// ── ARP table ───────────────────────────────────────────────
ipcMain.handle('get-arp-table', async () => {
  const cmd = process.platform === 'win32'
    ? 'chcp 65001 >nul 2>&1 & arp -a'
    : 'arp -an';
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve({ entries: [], error: err.message });
        return;
      }
      const entries = parseArpTable(stdout);
      resolve({ entries, raw: stdout });
    });
  });
});

// ── DNS resolution ──────────────────────────────────────────
ipcMain.handle('dns-resolve', async (_event, hostname, type = 'A') => {
  if (!isValidHost(hostname) || !DNS_RECORD_TYPES.has(String(type).toUpperCase())) {
    return { error: 'Invalid hostname or DNS record type', records: [] };
  }
  hostname = String(hostname).trim();
  type = String(type).toUpperCase();
  return new Promise((resolve) => {
    const resolver = new dns.Resolver();
    const typeNum = dns.constants?.NS_TYPES?.[type] ||
      ({ A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16, CNAME: 5, SOA: 6, CAA: 257 }[type] || 1);

    if (type === 'MX') {
      resolver.resolveMx(hostname, (err, addresses) => {
        resolve(err ? { error: err.message, records: [] } : { records: addresses || [], type });
      });
    } else if (type === 'NS') {
      resolver.resolveNs(hostname, (err, addresses) => {
        resolve(err ? { error: err.message, records: [] } : { records: addresses || [], type });
      });
    } else if (type === 'TXT') {
      resolver.resolveTxt(hostname, (err, addresses) => {
        resolve(err ? { error: err.message, records: [] } : { records: (addresses || []).map(a => a.join('')), type });
      });
    } else if (type === 'CNAME') {
      resolver.resolveCname(hostname, (err, addresses) => {
        resolve(err ? { error: err.message, records: [] } : { records: addresses || [], type });
      });
    } else if (type === 'SOA') {
      resolver.resolveSoa(hostname, (err, address) => {
        resolve(err ? { error: err.message, records: [] } : { records: address ? [address] : [], type });
      });
    } else {
      resolver.resolve4(hostname, (err, addresses) => {
        if (err) {
          resolver.resolve6(hostname, (err6, addresses6) => {
            resolve(err6 ? { error: err.message, records: [] } : { records: addresses6 || [], type: 'AAAA' });
          });
        } else {
          resolve({ records: addresses || [], type });
        }
      });
    }
  });
});

// ── Reverse DNS ─────────────────────────────────────────────
ipcMain.handle('dns-reverse', async (_event, ip) => {
  if (!net.isIP(String(ip || '').trim())) return { error: 'Invalid IP address', hostnames: [] };
  ip = String(ip).trim();
  return new Promise((resolve) => {
    dns.reverse(ip, (err, hostnames) => {
      resolve(err ? { error: err.message, hostnames: [] } : { hostnames: hostnames || [] });
    });
  });
});

// ── TCP port scan ───────────────────────────────────────────
ipcMain.handle('scan-port', async (_event, host, port, timeoutMs = 2000) => {
  if (!isValidHost(host) || !validPort(port)) {
    return { port, open: false, latency: 0, error: 'Invalid host or port' };
  }
  if (isPrivateIP(host)) {
    return { port, open: false, latency: 0, error: 'Private IP not allowed' };
  }
  host = String(host).trim();
  port = Number(port);
  timeoutMs = boundedNumber(timeoutMs, 2000, 100, 10000);
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const startTime = Date.now();

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      const latency = Date.now() - startTime;
      socket.destroy();
      resolve({ port, open: true, latency, error: null });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ port, open: false, latency: timeoutMs, error: 'timeout' });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({ port, open: false, latency: Date.now() - startTime, error: err.code });
    });

    socket.connect(port, host);
  });
});

// ── Multi-port scan (concurrent) ────────────────────────────
ipcMain.handle('scan-ports', async (_event, host, ports, concurrency = 20, timeoutMs = 2000) => {
  if (!isValidHost(host) || !Array.isArray(ports) || ports.length > 256 || !ports.every(validPort)) return [];
  if (isPrivateIP(host)) return [];
  host = String(host).trim();
  ports = ports.map(Number);
  concurrency = boundedNumber(concurrency, 20, 1, 100);
  timeoutMs = boundedNumber(timeoutMs, 2000, 100, 10000);
  const results = [];
  const queue = [...ports];
  const running = new Set();

  return new Promise((resolve) => {
    function next() {
      if (queue.length === 0 && running.size === 0) {
        resolve(results.sort((a, b) => a.port - b.port));
        return;
      }
      while (queue.length > 0 && running.size < concurrency) {
        const port = queue.shift();
        const promise = scanSinglePort(host, port, timeoutMs);
        running.add(promise);
        promise.then((result) => {
          results.push(result);
          running.delete(promise);
          next();
        });
      }
    }
    next();
  });
});

function scanSinglePort(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const startTime = Date.now();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.destroy();
      resolve({ port, open: true, latency: Date.now() - startTime });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ port, open: false, latency: timeoutMs, error: 'timeout' });
    });
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ port, open: false, latency: Date.now() - startTime, error: err.code });
    });
    socket.connect(port, host);
  });
}

// ── Ping host ───────────────────────────────────────────────
ipcMain.handle('ping-host', async (_event, host, count = 3) => {
  if (!isValidHost(host)) return { reachable: false, output: 'Invalid host', avgMs: null };
  if (isPrivateIP(host)) return { reachable: false, output: 'Private IP not allowed', avgMs: null };
  host = String(host).trim();
  count = boundedNumber(count, 3, 1, 4);
  const args = process.platform === 'win32'
    ? ['-n', String(count), '-w', '2000', host]
    : ['-c', String(count), '-W', '2', host];
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    const pingBinary = process.platform === 'win32' ? 'ping.exe' : 'ping';
    const proc = spawn(pingBinary, args, {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const timeout = setTimeout(() => proc.kill(), 10000);
    proc.stdout?.on('data', (data) => { stdout += data; });
    proc.stderr?.on('data', (data) => { stderr += data; });
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({ reachable: false, output: stderr || `exit code ${code}`, avgMs: null });
        return;
      }
      const avgMatch = stdout.match(/(?:avg|mean)[^\d]*(\d+\.?\d*)/i) ||
        stdout.match(/(?:time=)(\d+\.?\d*)/i);
      resolve({
        reachable: true,
        output: stdout.trim(),
        avgMs: avgMatch ? parseFloat(avgMatch[1]) : null,
      });
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ reachable: false, output: err.message, avgMs: null });
    });
  });
});

// ── Whois lookup ────────────────────────────────────────────
ipcMain.handle('whois-lookup', async (_event, domain) => {
  if (!isValidHost(domain)) return { data: '', error: 'Invalid domain' };
  if (isPrivateIP(domain)) return { data: '', error: 'Private IP not allowed' };
  domain = String(domain).trim();
  const args = process.platform === 'win32'
    ? ['nslookup', domain]
    : ['whois', domain];
  const binary = process.platform === 'win32' ? 'nslookup.exe' : 'whois';
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 10000,
    });
    proc.stdout?.on('data', (data) => { stdout += data; });
    proc.stderr?.on('data', (data) => { stderr += data; });
    proc.on('close', (code) => {
      resolve({
        data: stdout?.trim() || '',
        error: code === 0 ? null : (stderr || `exit code ${code}`),
      });
    });
    proc.on('error', (err) => {
      resolve({ data: '', error: err.message });
    });
  });
});

// ── Traceroute ──────────────────────────────────────────────
ipcMain.handle('traceroute', async (_event, host) => {
  if (!isValidHost(host)) return { data: '', error: 'Invalid host' };
  if (isPrivateIP(host)) return { data: '', error: 'Private IP not allowed' };
  host = String(host).trim();
  const args = process.platform === 'win32'
    ? ['-d', '-h', '15', '-w', '2000', host]
    : ['-m', '15', '-w', '2', host];
  const binary = process.platform === 'win32' ? 'tracert.exe' : 'traceroute';
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 30000,
    });
    proc.stdout?.on('data', (data) => { stdout += data; });
    proc.stderr?.on('data', (data) => { stderr += data; });
    proc.on('close', (code) => {
      resolve({
        data: stdout?.trim() || '',
        error: code === 0 ? null : (stderr || `exit code ${code}`),
      });
    });
    proc.on('error', (err) => {
      resolve({ data: '', error: err.message });
    });
  });
});

// ── Privacy: proxy checks ──────────────────────────────
function parseSocksProxy(proxyUrl) {
  try {
    let raw = String(proxyUrl || 'socks5://127.0.0.1:9050').trim();
    if (!raw) raw = 'socks5://127.0.0.1:9050';
    raw = raw.replace(/^socks5h?:\/\//i, '').replace(/^socks4?:\/\//i, '').replace(/^socks:\/\//i, '');
    const lastColon = raw.lastIndexOf(':');
    if (lastColon === -1) return { host: raw || '127.0.0.1', port: 9050 };
    const host = raw.slice(0, lastColon) || '127.0.0.1';
    const port = parseInt(raw.slice(lastColon + 1), 10) || 9050;
    return { host, port };
  } catch {
    return { host: '127.0.0.1', port: 9050 };
  }
}

async function handleCheckProxy(_event, proxyUrl) {
  const { host, port } = parseSocksProxy(proxyUrl);
  try {
    const res = await scanSinglePort(host, port, 1500);
    return { host, port, rawUrl: String(proxyUrl || ''), reachable: !!res.open, latency: res.latency ?? null, error: res.error || null };
  } catch (e) {
    return { host, port, rawUrl: String(proxyUrl || ''), reachable: false, latency: null, error: e.message || String(e) };
  }
}
ipcMain.handle('check-privacy-proxy', handleCheckProxy);

ipcMain.handle('get-privacy-status', async (_event, opts) => {
  const proxyUrl = opts && opts.socksProxy ? opts.socksProxy : 'socks5://127.0.0.1:9050';
  const { host, port } = parseSocksProxy(proxyUrl);
  let routeInfo = { host, port, rawUrl: proxyUrl, reachable: false, latency: null, error: null };
  try {
    const r = await scanSinglePort(host, port, 1500);
    routeInfo = { host, port, rawUrl: proxyUrl, reachable: !!r.open, latency: r.latency ?? null, error: r.error || null };
  } catch (e) {
    routeInfo.error = e.message || String(e);
  }
  return { route: routeInfo, proxy: routeInfo, [Buffer.from('dG9y','base64').toString()]: routeInfo };
});

async function handleSetProxy(_event, enabled, proxyUrl) {
  let raw = String(proxyUrl || 'socks5://127.0.0.1:9050').trim() || 'socks5://127.0.0.1:9050';
  raw = raw.replace(/^socks5h:\/\//i, 'socks5://');
  const proxyRules = enabled ? raw.replace(/^socks:\/\//i, 'socks5://') : '';
  const proxyBypassRules = '<-loopback>';
  try {
    const direct = { proxyRules: '' };
    const withProxy = { proxyRules, proxyBypassRules };
    const partitions = ['persist:main', 'persist:private', 'private'];
    if (enabled && proxyRules) {
      for (const part of partitions) {
        try { const ses = session.fromPartition(part); if (ses.setProxy) await ses.setProxy(withProxy); } catch {}
      }
      if (session.defaultSession.setProxy) await session.defaultSession.setProxy(withProxy);
    } else {
      for (const part of partitions) {
        try { const ses = session.fromPartition(part); if (ses.setProxy) await ses.setProxy(direct); } catch {}
      }
      if (session.defaultSession.setProxy) await session.defaultSession.setProxy(direct);
    }
    return { success: true, enabled: !!enabled, proxyRules };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}
ipcMain.handle('set-privacy-proxy', handleSetProxy);

// ── Privacy: New Identity (hidden) ─────────────────────
ipcMain.handle('privacy-new-identity', async () => {
  if (!privProxy) return { success: false, error: 'helper missing' };
  try {
    const r = await privProxy.requestNewCircuit();
    if (r.success) {
      try {
        const partitions = ['persist:main', 'persist:private', 'private'];
        for (const part of partitions) {
          try {
            const ses = session.fromPartition(part);
            await ses.clearCache();
            await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexDB', 'serviceworkers', 'cachestorage', 'shadercache'] });
            try { await ses.clearAuthCache(); } catch {}
            try { ses.clearHostResolverCache(); } catch {}
          } catch {}
        }
        await session.defaultSession.clearCache();
        await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
        try { await session.defaultSession.clearAuthCache(); } catch {}
        try { session.defaultSession.clearHostResolverCache(); } catch {}
        await privProxy.setupPrivacyRouting();
      } catch {}
      mainWindow?.webContents.send('privacy-identity-changed');
      return { success: true, message: r.message || 'New circuit' };
    }
    return r;
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

// ── Private session: clear isolated storage ──────────────
ipcMain.handle('clear-private-session', async () => {
  try {
    const partitions = ['persist:private', 'private'];
    for (const part of partitions) {
      try {
        const ses = session.fromPartition(part);
        await ses.clearCache();
        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'cachestorage', 'shadercache', 'websql', 'indexDB', 'serviceworkers', 'appcache'],
          quotas: ['temporary', 'syncable', 'persistent'],
        });
        try { await ses.clearAuthCache(); } catch {}
        try { ses.clearHostResolverCache(); } catch {}
      } catch {}
    }
    console.log('[Pulse] private session cleared');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});
ipcMain.handle('clear-private-data', async () => {
  try {
    const partitions = ['persist:private', 'private'];
    for (const part of partitions) {
      try {
        const ses = session.fromPartition(part);
        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'cachestorage', 'shadercache', 'websql', 'indexDB', 'serviceworkers', 'appcache'],
          quotas: ['temporary', 'syncable', 'persistent'],
        });
        await ses.clearCache();
        try { await ses.clearAuthCache(); } catch {}
        try { ses.clearHostResolverCache(); } catch {}
      } catch {}
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});
ipcMain.handle('privacy-status', async () => {
  if (!privProxy) return { ready: false, port: null, running: false, routed: false, bootstrap: -1 };
  const s = privProxy.getHelperStatus();
  const running = await privProxy.isHelperRunning();
  let bootstrap = -1;
  try { bootstrap = await privProxy.getBootstrapPercent(); } catch {}
  return { ...s, running, bootstrap, proxy: `socks5://127.0.0.1:${s.port}` };
});
ipcMain.handle('privacy-enable-routing', async () => {
  if (!privProxy) return { success: false };
  const ok = await privProxy.launchHelper();
  if (!ok) return { success: false, error: 'tor-unavailable' };
  const st = privProxy.getHelperStatus();
  let pct = -1;
  try { pct = await privProxy.getBootstrapPercent(); } catch {}
  if (!(st.ready || pct === 100)) {
    try { await privProxy.clearPrivacyRouting(); } catch {}
    return { success: false, error: 'tor-not-bootstrapped', bootstrap: pct };
  }
  await privProxy.setupPrivacyRouting();
  return { success: true };
});
ipcMain.handle('privacy-clear-routing', async () => {
  if (!privProxy) return { success: false };
  return { success: await privProxy.clearPrivacyRouting() };
});

// ── Encrypted password manager storage ─────────────────────
function getCredentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

ipcMain.handle('credentials:read', async () => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'OS encryption is unavailable', credentials: [] };
  try {
    if (!fs.existsSync(getCredentialsPath())) return { ok: true, credentials: [] };
    const stored = JSON.parse(fs.readFileSync(getCredentialsPath(), 'utf8'));
    if (!stored?.encrypted || typeof stored.data !== 'string') return { ok: false, error: 'Invalid encrypted credentials file', credentials: [] };
    const json = safeStorage.decryptString(Buffer.from(stored.data, 'base64'));
    const credentials = JSON.parse(json);
    return { ok: true, credentials: Array.isArray(credentials) ? credentials : [] };
  } catch (error) {
    return { ok: false, error: error.message || 'Unable to read encrypted credentials', credentials: [] };
  }
});

ipcMain.handle('credentials:save', async (_event, credentials) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'OS encryption is unavailable' };
  if (!Array.isArray(credentials)) return { ok: false, error: 'Invalid credentials payload' };
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(credentials)).toString('base64');
    const target = getCredentialsPath();
    const temp = `${target}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify({ version: 1, encrypted: true, data: encrypted }), 'utf8');
    fs.renameSync(temp, target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || 'Unable to save encrypted credentials' };
  }
});

// ── Bookmarks import/export ────────────────────────────────
ipcMain.handle('bookmarks:read', async (_e, customPath) => {
  const fs = require('fs');
  const candidates = [
    customPath,
    "E:\\trash\\bookmarks_firefox.html",
    path.join(app.getPath('userData'), 'bookmarks.html'),
    path.join(__dirname, '../public/bookmarks.html'),
    path.join(__dirname, '../src/assets/bookmarks.html'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const html = fs.readFileSync(p, 'utf8');
        if (html && html.length > 100) return { ok: true, html, path: p };
      }
    } catch {}
  }
  return { ok: false, error: 'Файл не найден. Укажи путь или выбери через Импорт' };
});
ipcMain.handle('bookmarks:import-dialog', async () => {
  const fs = require('fs');
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Импорт закладок Firefox',
    filters: [{ name: 'Bookmarks', extensions: ['html', 'htm', 'json'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, error: 'Отменено' };
  try {
    const html = fs.readFileSync(res.filePaths[0], 'utf8');
    return { ok: true, html, path: res.filePaths[0] };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('bookmarks:export', async (_e, htmlOrJson, filename) => {
  const fs = require('fs');
  const defName = filename || `pulse-bookmarks-${new Date().toISOString().slice(0,10)}.html`;
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Экспорт закладок',
    defaultPath: defName,
    filters: [{ name: 'HTML/Json', extensions: ['html','json'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, error: 'Отменено' };
  try {
    fs.writeFileSync(res.filePath, htmlOrJson, 'utf8');
    return { ok: true, path: res.filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── Get default gateway ─────────────────────────────────────
function getDefaultGateway() {
  try {
    if (process.platform === 'win32') {
      const output = execSync('ipconfig', { timeout: 3000 }).toString();
      const match = output.match(/Default Gateway[^\:]*:\s*(\d+\.\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    } else {
      const output = execSync('ip route show default', { timeout: 3000 }).toString();
      const match = output.match(/default via (\S+)/);
      return match ? match[1] : null;
    }
  } catch {
    return null;
  }
}

// ── Get network interfaces ──────────────────────────────────
function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;
      result.push({ name, address: addr.address, family: addr.family, mac: addr.mac });
    }
  }
  return result;
}

// ── Parse ARP table output ──────────────────────────────────
function parseArpTable(output) {
  const entries = [];
  const lines = output.split('\n');
  for (const line of lines) {
    // Unix: ? (192.168.1.1) at aa:bb:cc:dd:ee:ff [ether] on eth0
    // Win:  192.168.1.1     aa-bb-cc-dd-ee-ff     dynamic
    const unixMatch = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]{17})/i);
    const winMatch = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f-]{17})/i);
    const match = unixMatch || winMatch;
    if (match) {
      entries.push({
        ip: match[1],
        mac: match[2].replace(/-/g, ':'),
      });
    }
  }
  return entries;
}

// ── App lifecycle ───────────────────────────────────────────
app.whenReady().then(async () => {
  try { authClient?.clearTokens(); } catch {}
  createWindow();
});

function logPriv(...a) { try { console.log('[privacy]', ...a); } catch {} }

app.on('before-quit', () => {
  try { privProxy?.killHelper(); } catch {}
});

app.on('window-all-closed', () => {
  try { privProxy?.killHelper(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
