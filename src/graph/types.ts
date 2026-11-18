/**
 * Network Graph model types + central state shape.
 *
 * `src/graph/*` turns `NetworkRequest[]` into `GraphData`, lays it out and
 * applies filters/clustering. `src/graph/store.ts` owns `NetworkGraphState`
 * and is the single source of truth for the panel UI.
 */
import type {
  NetworkRequest,
  NetworkResourceType,
  NetworkSourceKind,
  RequestStoreStats,
} from '../network/types';

export type GraphNodeKind = 'page' | 'domain' | 'js' | 'api' | 'resource' | 'websocket' | 'cluster';

export type GraphEdgeKind = 'page-load' | 'initiator' | 'host' | 'redirect' | 'aggregated';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  /** Primary label shown on the node. */
  label: string;
  /** Secondary line (host, path, count…). */
  sublabel?: string;
  /** Requests represented by this node (more than one for clusters). */
  requestIds: string[];
  /** Representative request (single-request nodes and merged page node). */
  request?: NetworkRequest;
  /** Resource subtype for icon selection on `resource` nodes. */
  resourceType?: NetworkResourceType;
  domain?: string;
  thirdParty: boolean;
  /** HTTP status when known. */
  status?: number;
  state?: NetworkRequest['state'];
  /** True when the underlying request failed or returned >= 400. */
  error: boolean;
  /** Number of aggregated requests (clusters). */
  count?: number;
  /** Request ids aggregated by an auto-cluster (expanded on click). */
  children?: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  /** Short label: `fetch`, `GET`, `app.js:2841`. */
  label?: string;
  /** Human readable reason why this edge exists. */
  reason: string;
  requestIds: string[];
  /** Request is still in flight — render animated. */
  pending?: boolean;
  /** Underlying request errored — render as error edge. */
  error?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type ClusterMode = 'auto' | 'none' | 'domain' | 'type' | 'thirdparty';
export type LayoutDirection = 'TB' | 'LR';

export interface GraphFilterState {
  /** Empty array = all types. */
  types: NetworkResourceType[];
  firstPartyOnly: boolean;
  thirdPartyOnly: boolean;
  errorsOnly: boolean;
  /** Raw search input (applied debounced). */
  search: string;
  clusterMode: ClusterMode;
  direction: LayoutDirection;
}

export type HighlightMode = 'none' | 'neighbors' | 'initiators' | 'dependents' | 'domain' | 'search';

export interface GraphStats {
  total: number;
  shown: number;
  nodes: number;
  edges: number;
  errors: number;
  pending: number;
  thirdParty: number;
  truncated: boolean;
}

export interface GraphPageInfo {
  url: string;
  title?: string;
  loadId: number;
}

export interface NetworkGraphState {
  isOpen: boolean;
  activeTabId: string | null;
  source: NetworkSourceKind;
  /** Live capture: new batches are ingested and the graph rebuilds. */
  isLive: boolean;

  page: GraphPageInfo | null;
  /** Requests of the active tab after live-ingest (raw). */
  requests: NetworkRequest[];
  /** Filtered + clustered graph ready for rendering. */
  graph: GraphData;
  /** Laid-out positions keyed by node id. */
  positions: Record<string, { x: number; y: number }>;

  selectedNodeId: string | null;
  /** Node to bring into view (consumed by the canvas). */
  focusedNodeId: string | null;
  hiddenNodeIds: string[];
  highlightMode: HighlightMode;
  highlightedNodeIds: string[];

  filters: GraphFilterState;
  stats: GraphStats;
  storeStats: RequestStoreStats;

  /** Request inspector visibility + active section. */
  inspectorOpen: boolean;
  inspectorSection: InspectorSection;

  /** Set when a snapshot is loaded instead of live data. */
  snapshotMode: boolean;
  snapshotName: string | null;
  /** Bumped to request a `fitView` from the canvas. */
  focusNonce: number;

  status: { available: boolean; message?: string };
  /** Monotonic version — bumped on every state change. */
  version: number;
}

export type InspectorSection = 'auto' | 'overview' | 'request' | 'response' | 'initiator' | 'timeline' | 'raw';

export interface GraphLayoutOptions {
  direction: LayoutDirection;
  /** Gap between layers (main axis). */
  layerGap?: number;
  /** Gap between nodes inside a layer (cross axis). */
  nodeGap?: number;
  nodeWidth?: number;
  nodeHeight?: number;
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
}

/** Serialized snapshot format (spec §23). */
export interface NetworkGraphSnapshot {
  version: 1;
  timestamp: number;
  page: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  requests: NetworkRequest[];
}

export const DEFAULT_GRAPH_FILTERS: GraphFilterState = {
  types: [],
  firstPartyOnly: false,
  thirdPartyOnly: false,
  errorsOnly: false,
  search: '',
  clusterMode: 'auto',
  direction: 'TB',
};

/** Above this many visible request nodes, `auto` clusters by domain. */
export const AUTO_CLUSTER_THRESHOLD = 350;
/** Requests kept per tab before the oldest are dropped. */
export const MAX_REQUESTS_PER_TAB = 3000;
