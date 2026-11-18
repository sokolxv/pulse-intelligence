/**
 * Shared network-layer types.
 *
 * Produced by the Electron main process (CDP Network domain) and consumed by
 * the renderer network store / graph model. Keep this file dependency-free:
 * it is the contract between electron/network-collector.js, src/network/*,
 * src/graph/* and the Network Graph UI.
 */

export type NetworkResourceType =
  | 'document'
  | 'script'
  | 'stylesheet'
  | 'image'
  | 'font'
  | 'media'
  | 'xhr'
  | 'fetch'
  | 'websocket'
  | 'other';

export type NetworkRequestState = 'pending' | 'finished' | 'failed' | 'canceled';

/** Raw CDP resource type (`Network.requestWillBeSent.type`). */
export type CdpResourceType =
  | 'Document'
  | 'Stylesheet'
  | 'Image'
  | 'Media'
  | 'Font'
  | 'Script'
  | 'TextTrack'
  | 'XHR'
  | 'Fetch'
  | 'Prefetch'
  | 'EventSource'
  | 'WebSocket'
  | 'Manifest'
  | 'SignedExchange'
  | 'Ping'
  | 'CSPViolationReport'
  | 'Preflight'
  | 'Other';

/** One frame of the initiator stack (CDP `Runtime.StackTrace.callFrame`). */
export interface InitiatorFrame {
  /** Script URL that contains the call site. */
  url: string;
  /** Function name; `""` for top-level code, `"(anonymous)"` when unknown. */
  functionName?: string;
  /** 0-based line number as reported by CDP. */
  lineNumber?: number;
  /** 0-based column number as reported by CDP. */
  columnNumber?: number;
}

export type InitiatorKind = 'parser' | 'script' | 'preload' | 'preflight' | 'redirect' | 'other';

export interface InitiatorInfo {
  kind: InitiatorKind;
  /** Primary initiator URL (script or document that triggered the request). */
  url?: string;
  /** URL of the document that owned the initiator script. */
  documentURL?: string;
  /** Call frames, innermost first, capped by the collector. */
  frames: InitiatorFrame[];
}

/** Timing breakdown in milliseconds relative to `startTime` (epoch ms). */
export interface NetworkTiming {
  dnsStart?: number;
  dnsEnd?: number;
  connectStart?: number;
  connectEnd?: number;
  sslStart?: number;
  sslEnd?: number;
  sendStart?: number;
  sendEnd?: number;
  receiveHeadersEnd?: number;
}

export interface NetworkRequest {
  /** Unique record id: `${wcId}:${seq}`. */
  id: string;
  /** Tab the request belongs to (set once the webview is bound). */
  tabId?: string;
  /** WebContents id of the owning webview. */
  wcId?: number;
  /** CDP `Network.requestId` — needed for on-demand body lookup. */
  cdpRequestId?: string;
  /** Monotonic id of the page load that produced the request. */
  pageLoadId?: number;

  url: string;
  method: string;

  status?: number;
  statusText?: string;

  type: NetworkResourceType;
  /** Raw CDP resource type before classification. */
  cdpType?: CdpResourceType;

  /** Primary initiator URL (short form of `initiatorInfo`). */
  initiator?: string;
  initiatorInfo?: InitiatorInfo;

  /** Hostname of the request URL. */
  domain: string;
  /** Origin of the page at request time. */
  origin?: string;

  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;

  requestSize?: number;
  responseSize?: number;

  /** Epoch ms when the request started. */
  startTime: number;
  /** Epoch ms when the request finished (finished/failed). */
  endTime?: number;
  /** Total duration in ms. */
  duration?: number;

  mimeType?: string;
  /** Wire protocol: `h2`, `http/1.1`, `ws`, … */
  protocol?: string;
  remoteIPAddress?: string;
  cache?: boolean;

  state: NetworkRequestState;
  /** `net::ERR_*` / CDP error text for failed or canceled requests. */
  errorText?: string;
  priority?: string;
  fromServiceWorker?: boolean;

  /** Set when this record is a redirect hop of `redirectedFrom`. */
  redirectedFrom?: string;
  redirectedTo?: string;

  timing?: NetworkTiming;
}

/** Batched upsert of request records pushed from the main process. */
export interface NetworkBatchPayload {
  tabId?: string;
  wcId: number;
  pageLoadId: number;
  requests: NetworkRequest[];
}

/** Emitted when a main-frame navigation starts a new page load. */
export interface NetworkPagePayload {
  tabId?: string;
  wcId: number;
  pageLoadId: number;
  url: string;
  ts: number;
}

export type NetworkSourceKind = 'live' | 'demo' | 'unavailable';

export interface NetworkCollectorStatusPayload {
  /** True when at least one webview has an attached CDP session. */
  available: boolean;
  /** Whether the main process is streaming batches to the renderer. */
  streaming: boolean;
  /** Number of bound webviews. */
  boundTabs: number;
  /** Number of webviews currently tracked (attached or retrying). */
  trackedTabs: number;
  source: NetworkSourceKind;
  message?: string;
}

export interface NetworkBodyResult {
  ok: boolean;
  body?: string;
  base64Encoded?: boolean;
  mimeType?: string;
  truncated?: boolean;
  error?: string;
}

export type NetworkBodyKind = 'response' | 'request';

/** Snapshot of the current page load for a tab. */
export interface NetworkPageInfo {
  url: string;
  loadId: number;
}

/**
 * Renderer-side request store contract. Implemented by
 * `src/network/RequestStore.ts`.
 */
export interface IRequestStore {
  /** Upsert records for a tab (records are replaced by `id`). */
  ingestBatch(tabId: string, pageLoadId: number, requests: NetworkRequest[]): void;
  /** Start a new page load: clears stored requests for the tab. */
  startPage(tabId: string, pageLoadId: number, url: string): void;
  /** Drop data for one tab (or all tabs when omitted). */
  clear(tabId?: string): void;
  /** Requests for a tab, oldest first. Empty array when unknown. */
  getRequests(tabId: string): NetworkRequest[];
  getPage(tabId: string): NetworkPageInfo | null;
  getStats(tabId: string): RequestStoreStats;
  listTabs(): string[];
  /** Subscribe to any change affecting `tabId` (or any tab when omitted). */
  subscribe(listener: (tabId?: string) => void): () => void;
}

export interface RequestStoreStats {
  total: number;
  pending: number;
  errors: number;
  thirdParty: number;
  truncated: boolean;
}

/** Well-known IPC channel names shared with electron/network-collector.js. */
export const NETGRAPH_CHANNELS = {
  bind: 'netgraph:bind',
  unbind: 'netgraph:unbind',
  streaming: 'netgraph:streaming',
  clear: 'netgraph:clear',
  status: 'netgraph:status',
  body: 'netgraph:body',
  batch: 'netgraph:batch',
  page: 'netgraph:page',
  statusEvent: 'netgraph:status-event',
} as const;

/** API exposed by electron/preload.js as `window.electronAPI.netgraph`. */
export interface NetGraphBridge {
  bind(tabId: string, wcId: number): Promise<{ ok: boolean; error?: string; replay?: NetworkRequest[]; page?: NetworkPagePayload }>;
  unbind(tabId: string, wcId: number): Promise<void>;
  setStreaming(on: boolean): Promise<void>;
  clear(tabId?: string): Promise<void>;
  status(): Promise<NetworkCollectorStatusPayload>;
  getBody(wcId: number, cdpRequestId: string, kind: NetworkBodyKind): Promise<NetworkBodyResult>;
  onBatch(cb: (payload: NetworkBatchPayload) => void): () => void;
  onPage(cb: (payload: NetworkPagePayload) => void): () => void;
  onStatus(cb: (payload: NetworkCollectorStatusPayload) => void): () => void;
}

/**
 * Renderer event bus contract — implemented by `src/network/NetworkEventBus.ts`.
 * Bridges the preload bridge (or the dev-only demo source) into the store.
 */
export interface INetworkEventBus {
  /** Start listening (idempotent). Returns a disposer. */
  start(): () => void;
  /** Live capture toggle — when false incoming batches are dropped. */
  setLive(live: boolean): void;
  isLive(): boolean;
  /** Which data source is active. */
  source(): NetworkSourceKind;
  /** Bind a webview to a tab id and begin receiving its batches. */
  bindTab(tabId: string, wcId: number): Promise<{ ok: boolean; error?: string }>;
  unbindTab(tabId: string, wcId: number): void;
  /** Ask the main process to (un)stream batches to this window. */
  setStreaming(on: boolean): void;
  clear(tabId?: string): void;
  getStatus(): Promise<NetworkCollectorStatusPayload>;
  getBody(wcId: number, cdpRequestId: string, kind: NetworkBodyKind): Promise<NetworkBodyResult>;
  /** Subscribe to collector status changes (live/demo/unavailable). */
  onStatusChange(cb: (status: NetworkCollectorStatusPayload) => void): () => void;
}
