import type {
  INetworkEventBus,
  NetGraphBridge,
  NetworkBatchPayload,
  NetworkBodyKind,
  NetworkBodyResult,
  NetworkCollectorStatusPayload,
  NetworkPagePayload,
  NetworkRequest,
  NetworkResourceType,
  NetworkSourceKind,
} from './types';
import { requestStore } from './RequestStore';
import { getHost } from './DomainResolver';

const DEMO_ORIGIN = 'https://demo.pulse.local';
const DEMO_PAGE_URL = `${DEMO_ORIGIN}/app`;
const DEMO_SCRIPT_URL = `${DEMO_ORIGIN}/static/js/app.js`;
const DEMO_MAX_REQUESTS = 60;
const DEMO_TICK_MS = 600;

interface DemoTabState {
  tabId: string;
  wcId: number;
  seq: number;
  emitted: number;
  tick: number;
  timer: ReturnType<typeof setInterval> | null;
}

interface StatusSubscriber {
  cb: (status: NetworkCollectorStatusPayload) => void;
  sent?: NetworkCollectorStatusPayload;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class NetworkEventBus implements INetworkEventBus {
  private bridge?: NetGraphBridge;
  private started = false;
  private live = true;
  private disposers: Array<() => void> = [];
  private wcToTab = new Map<number, string>();
  private statusCache?: NetworkCollectorStatusPayload;
  private statusSubs = new Set<StatusSubscriber>();
  private demoTabs = new Map<string, DemoTabState>();
  private demoStreaming = true;

  start(): () => void {
    this.ensureStarted();
    return () => this.teardown();
  }

  setLive(live: boolean): void {
    this.ensureStarted();
    this.live = live;
  }

  isLive(): boolean {
    this.ensureStarted();
    return this.live;
  }

  source(): NetworkSourceKind {
    this.ensureStarted();
    if (this.bridge) return 'live';
    return import.meta.env.DEV ? 'demo' : 'unavailable';
  }

  async bindTab(tabId: string, wcId: number): Promise<{ ok: boolean; error?: string }> {
    this.ensureStarted();
    if (this.bridge) {
      try {
        const result = await this.bridge.bind(tabId, wcId);
        if (!result.ok) return { ok: false, error: result.error };
        this.wcToTab.set(wcId, tabId);
        if (result.page) requestStore.startPage(tabId, result.page.pageLoadId, result.page.url);
        const replay = result.replay;
        if (replay && replay.length) {
          const loadId = result.page?.pageLoadId ?? replay[0].pageLoadId ?? 0;
          requestStore.ingestBatch(tabId, loadId, replay);
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
    }
    if (import.meta.env.DEV) {
      this.wcToTab.set(wcId, tabId);
      this.startDemo(tabId, wcId);
      this.refreshStatus();
      return { ok: true };
    }
    return { ok: false, error: 'Network capture requires Electron' };
  }

  unbindTab(tabId: string, wcId: number): void {
    this.ensureStarted();
    this.wcToTab.delete(wcId);
    for (const [id, mappedTab] of Array.from(this.wcToTab.entries())) {
      if (mappedTab === tabId) this.wcToTab.delete(id);
    }
    const demo = this.demoTabs.get(tabId);
    if (demo) {
      this.stopDemo(demo);
      this.demoTabs.delete(tabId);
      this.refreshStatus();
    }
    if (this.bridge) {
      try {
        Promise.resolve(this.bridge.unbind(tabId, wcId)).catch(() => {});
      } catch {}
    }
  }

  setStreaming(on: boolean): void {
    this.ensureStarted();
    this.demoStreaming = on;
    if (this.bridge) {
      try {
        Promise.resolve(this.bridge.setStreaming(on)).catch(() => {});
      } catch {}
    } else {
      this.refreshStatus();
    }
  }

  clear(tabId?: string): void {
    this.ensureStarted();
    if (this.bridge) {
      try {
        Promise.resolve(this.bridge.clear(tabId)).catch(() => {});
      } catch {}
    }
    requestStore.clear(tabId);
    this.refreshStatus();
  }

  async getStatus(): Promise<NetworkCollectorStatusPayload> {
    this.ensureStarted();
    if (this.bridge) {
      try {
        const status = await this.bridge.status();
        this.setStatus(status);
        return status;
      } catch (err) {
        const status: NetworkCollectorStatusPayload = {
          available: false,
          streaming: false,
          boundTabs: 0,
          trackedTabs: 0,
          source: 'live',
          message: errText(err),
        };
        this.setStatus(status);
        return status;
      }
    }
    const fallback = this.fallbackStatus();
    this.setStatus(fallback);
    return fallback;
  }

  async getBody(wcId: number, cdpRequestId: string, kind: NetworkBodyKind): Promise<NetworkBodyResult> {
    this.ensureStarted();
    if (this.bridge) {
      try {
        return await this.bridge.getBody(wcId, cdpRequestId, kind);
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
    }
    if (import.meta.env.DEV) return { ok: false, error: 'Not available in demo mode' };
    return { ok: false, error: 'Network capture requires Electron' };
  }

  onStatusChange(cb: (status: NetworkCollectorStatusPayload) => void): () => void {
    this.ensureStarted();
    const sub: StatusSubscriber = { cb };
    this.statusSubs.add(sub);
    if (this.bridge && !this.statusCache) {
      try {
        Promise.resolve(this.bridge.status())
          .then((status) => this.setStatus(status))
          .catch(() => {});
      } catch {}
    }
    queueMicrotask(() => {
      if (!this.statusSubs.has(sub)) return;
      const status = this.statusCache ?? this.fallbackStatus();
      this.setStatus(status);
      if (!sub.sent) {
        sub.sent = status;
        try {
          sub.cb(status);
        } catch {}
      }
    });
    return () => {
      this.statusSubs.delete(sub);
    };
  }

  private ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    const bridge = this.readBridge();
    if (!bridge) return;
    this.bridge = bridge;
    try {
      this.disposers.push(
        bridge.onBatch((payload) => this.handleBatch(payload)),
        bridge.onPage((payload) => this.handlePage(payload)),
        bridge.onStatus((payload) => this.setStatus(payload)),
      );
      Promise.resolve(bridge.status())
        .then((status) => this.setStatus(status))
        .catch(() => {});
    } catch {}
  }

  private teardown(): void {
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch {}
    }
    this.disposers = [];
    for (const demo of Array.from(this.demoTabs.values())) this.stopDemo(demo);
    this.demoTabs.clear();
    this.wcToTab.clear();
    this.bridge = undefined;
    this.started = false;
  }

  private readBridge(): NetGraphBridge | undefined {
    if (typeof window === 'undefined') return undefined;
    const api = (window as unknown as { electronAPI?: { netgraph?: NetGraphBridge } }).electronAPI;
    return api?.netgraph;
  }

  private handleBatch(payload: NetworkBatchPayload): void {
    if (!this.live) return;
    const tabId = payload.tabId ?? this.wcToTab.get(payload.wcId);
    if (!tabId) return;
    requestStore.ingestBatch(tabId, payload.pageLoadId, payload.requests);
  }

  private handlePage(payload: NetworkPagePayload): void {
    if (!this.live) return;
    const tabId = payload.tabId ?? this.wcToTab.get(payload.wcId);
    if (!tabId) return;
    requestStore.startPage(tabId, payload.pageLoadId, payload.url);
  }

  private setStatus(status: NetworkCollectorStatusPayload): void {
    const prev = this.statusCache;
    const same = prev !== undefined
      && prev.available === status.available
      && prev.streaming === status.streaming
      && prev.boundTabs === status.boundTabs
      && prev.trackedTabs === status.trackedTabs
      && prev.source === status.source
      && prev.message === status.message;
    this.statusCache = status;
    if (same) return;
    for (const sub of Array.from(this.statusSubs)) {
      if (sub.sent === status) continue;
      sub.sent = status;
      try {
        sub.cb(status);
      } catch {}
    }
  }

  private fallbackStatus(): NetworkCollectorStatusPayload {
    if (import.meta.env.DEV) {
      return {
        available: true,
        streaming: this.demoStreaming,
        boundTabs: this.demoTabs.size,
        trackedTabs: this.demoTabs.size,
        source: 'demo',
        message: 'Demo data — running outside Electron',
      };
    }
    return {
      available: false,
      streaming: false,
      boundTabs: 0,
      trackedTabs: 0,
      source: 'unavailable',
      message: 'Network capture requires Electron',
    };
  }

  private refreshStatus(): void {
    if (!this.bridge) this.setStatus(this.fallbackStatus());
  }

  private startDemo(tabId: string, wcId: number): void {
    const existing = this.demoTabs.get(tabId);
    if (existing) this.stopDemo(existing);
    const demo: DemoTabState = { tabId, wcId, seq: 0, emitted: 0, tick: 0, timer: null };
    this.demoTabs.set(tabId, demo);
    requestStore.startPage(tabId, 1, DEMO_PAGE_URL);
    demo.timer = setInterval(() => this.demoTick(demo), DEMO_TICK_MS);
  }

  private stopDemo(demo: DemoTabState): void {
    if (demo.timer !== null) {
      clearInterval(demo.timer);
      demo.timer = null;
    }
  }

  private demoTick(demo: DemoTabState): void {
    if (!this.demoTabs.has(demo.tabId)) {
      this.stopDemo(demo);
      return;
    }
    if (!this.live) return;
    const count = (demo.tick % 3) + 1;
    demo.tick += 1;
    const batch: NetworkRequest[] = [];
    for (let i = 0; i < count && demo.emitted < DEMO_MAX_REQUESTS; i += 1) {
      const template = this.demoTemplates[demo.emitted % this.demoTemplates.length];
      if (!template) break;
      batch.push(template(demo));
    }
    if (batch.length) requestStore.ingestBatch(demo.tabId, 1, batch);
    if (demo.emitted >= DEMO_MAX_REQUESTS) this.stopDemo(demo);
  }

  private buildDemoRequest(
    demo: DemoTabState,
    init: Partial<NetworkRequest> & { url: string; type: NetworkResourceType },
  ): NetworkRequest {
    const startTime = Date.now();
    const id = `${demo.wcId}:${demo.seq}`;
    demo.seq += 1;
    demo.emitted += 1;
    const state = init.state ?? 'finished';
    const duration = init.duration ?? 60;
    const pending = state === 'pending';
    return {
      ...init,
      id,
      tabId: demo.tabId,
      wcId: demo.wcId,
      cdpRequestId: `${demo.wcId}:cdp:${demo.seq}`,
      pageLoadId: 1,
      method: init.method ?? 'GET',
      domain: init.domain ?? getHost(init.url),
      startTime,
      state,
      status: init.status ?? (state === 'finished' ? 200 : undefined),
      statusText: init.statusText,
      duration: pending ? undefined : duration,
      endTime: pending ? undefined : init.endTime ?? startTime + duration,
    };
  }

  private readonly demoTemplates: ReadonlyArray<(demo: DemoTabState) => NetworkRequest> = [
    (demo) => this.buildDemoRequest(demo, {
      url: DEMO_PAGE_URL,
      type: 'document',
      cdpType: 'Document',
      mimeType: 'text/html',
      status: 200,
      statusText: 'OK',
      duration: 210,
      responseSize: 18432,
      protocol: 'h2',
      responseHeaders: { 'content-type': 'text/html; charset=utf-8' },
    }),
    (demo) => this.buildDemoRequest(demo, {
      url: DEMO_SCRIPT_URL,
      type: 'script',
      cdpType: 'Script',
      mimeType: 'application/javascript',
      initiator: DEMO_PAGE_URL,
      initiatorInfo: { kind: 'parser', url: DEMO_PAGE_URL, frames: [] },
      duration: 45,
      responseSize: 65536,
      protocol: 'h2',
      responseHeaders: { 'content-type': 'application/javascript' },
    }),
    (demo) => this.buildDemoRequest(demo, {
      url: `${DEMO_ORIGIN}/api/users`,
      type: 'fetch',
      cdpType: 'Fetch',
      mimeType: 'application/json',
      status: 200,
      statusText: 'OK',
      duration: 96,
      responseSize: 4096,
      initiator: DEMO_SCRIPT_URL,
      initiatorInfo: {
        kind: 'script',
        url: DEMO_SCRIPT_URL,
        frames: [{ url: DEMO_SCRIPT_URL, functionName: 'loadUsers', lineNumber: 2840, columnNumber: 3 }],
      },
      protocol: 'h2',
      responseHeaders: { 'content-type': 'application/json' },
    }),
    (demo) => this.buildDemoRequest(demo, {
      url: 'https://analytics.example.net/collect?src=pulse',
      type: 'fetch',
      cdpType: 'Fetch',
      status: 204,
      statusText: 'No Content',
      duration: 132,
      responseSize: 0,
      initiator: DEMO_SCRIPT_URL,
      initiatorInfo: {
        kind: 'script',
        url: DEMO_SCRIPT_URL,
        frames: [{ url: DEMO_SCRIPT_URL, functionName: 'track', lineNumber: 1120, columnNumber: 7 }],
      },
      protocol: 'h2',
      responseHeaders: { 'content-type': 'application/json' },
    }),
    (demo) => this.buildDemoRequest(demo, {
      url: `${DEMO_ORIGIN}/assets/logo.png`,
      type: 'image',
      cdpType: 'Image',
      mimeType: 'image/png',
      initiator: DEMO_PAGE_URL,
      initiatorInfo: { kind: 'parser', url: DEMO_PAGE_URL, frames: [] },
      duration: 62,
      responseSize: 8192,
      protocol: 'h2',
      responseHeaders: { 'content-type': 'image/png' },
    }),
    (demo) => this.buildDemoRequest(demo, {
      url: `${DEMO_ORIGIN}/static/css/app.css`,
      type: 'stylesheet',
      cdpType: 'Stylesheet',
      mimeType: 'text/css',
      initiator: DEMO_PAGE_URL,
      initiatorInfo: { kind: 'parser', url: DEMO_PAGE_URL, frames: [] },
      duration: 34,
      responseSize: 12288,
      protocol: 'h2',
      responseHeaders: { 'content-type': 'text/css' },
    }),
    (demo) => this.buildDemoRequest(demo, {
      url: `${DEMO_ORIGIN}/static/fonts/inter.woff2`,
      type: 'font',
      cdpType: 'Font',
      mimeType: 'font/woff2',
      initiator: DEMO_PAGE_URL,
      initiatorInfo: { kind: 'preload', url: DEMO_PAGE_URL, frames: [] },
      duration: 28,
      responseSize: 48120,
      protocol: 'h2',
      responseHeaders: { 'content-type': 'font/woff2' },
    }),
    (demo) => this.buildDemoRequest(demo, {
      url: `${DEMO_ORIGIN}/api/config`,
      type: 'xhr',
      cdpType: 'XHR',
      mimeType: 'application/json',
      status: 200,
      statusText: 'OK',
      duration: 74,
      responseSize: 1536,
      initiator: DEMO_SCRIPT_URL,
      initiatorInfo: {
        kind: 'script',
        url: DEMO_SCRIPT_URL,
        frames: [{ url: DEMO_SCRIPT_URL, functionName: 'init', lineNumber: 88, columnNumber: 1 }],
      },
      protocol: 'h2',
      responseHeaders: { 'content-type': 'application/json' },
    }),
    (demo) => this.buildDemoRequest(demo, {
      url: `${DEMO_ORIGIN}/api/admin`,
      type: 'fetch',
      cdpType: 'Fetch',
      mimeType: 'application/json',
      status: 403,
      statusText: 'Forbidden',
      duration: 57,
      responseSize: 128,
      initiator: DEMO_SCRIPT_URL,
      initiatorInfo: {
        kind: 'script',
        url: DEMO_SCRIPT_URL,
        frames: [{ url: DEMO_SCRIPT_URL, functionName: 'loadUsers', lineNumber: 2852, columnNumber: 5 }],
      },
      protocol: 'h2',
      responseHeaders: { 'content-type': 'application/json' },
    }),
    (demo) => this.buildDemoRequest(demo, {
      url: 'https://cdn.broken.invalid/vendor.js',
      type: 'script',
      cdpType: 'Script',
      state: 'failed',
      errorText: 'net::ERR_NAME_NOT_RESOLVED',
      duration: 300,
      initiator: DEMO_PAGE_URL,
      initiatorInfo: { kind: 'parser', url: DEMO_PAGE_URL, frames: [] },
    }),
    (demo) => this.buildDemoRequest(demo, {
      url: 'wss://demo.pulse.local/socket',
      type: 'websocket',
      cdpType: 'WebSocket',
      method: 'GET',
      state: 'pending',
      protocol: 'ws',
      initiator: DEMO_SCRIPT_URL,
      initiatorInfo: {
        kind: 'script',
        url: DEMO_SCRIPT_URL,
        frames: [{ url: DEMO_SCRIPT_URL, functionName: 'connect', lineNumber: 56, columnNumber: 9 }],
      },
      responseHeaders: { 'content-type': 'application/json' },
    }),
  ];
}

export const networkEventBus: INetworkEventBus = new NetworkEventBus();
