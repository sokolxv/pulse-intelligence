/**
 * Central Network Graph state (spec §20).
 *
 * Single mutable source of truth behind a `useSyncExternalStore` hook.
 * Data flows: IPC → NetworkEventBus → RequestStore → (debounced) rebuild →
 * GraphModel/GraphLayout/GraphFilters → state → panel UI.
 */
import { useCallback, useSyncExternalStore, useRef } from 'react';
import type {
  GraphData,
  GraphFilterState,
  GraphPageInfo,
  GraphStats,
  HighlightMode,
  InspectorSection,
  NetworkGraphSnapshot,
  NetworkGraphState,
} from './types';
import { DEFAULT_GRAPH_FILTERS } from './types';
import { requestStore } from '../network/RequestStore';
import { networkEventBus } from '../network/NetworkEventBus';
import type { NetworkBodyKind, NetworkBodyResult, NetworkResourceType, RequestStoreStats } from '../network/types';
import { buildGraph } from './GraphModel';
import { layoutGraph } from './GraphLayout';
import {
  collectRelatedNodes,
  computeStats,
  filterRequests,
  hideNodes,
} from './GraphFilters';
import { buildSnapshot, listSnapshots, loadSnapshotData, readSnapshotFile, saveSnapshotMeta, type SnapshotMeta } from './Snapshot';

const EMPTY_STATS: GraphStats = {
  total: 0, shown: 0, nodes: 0, edges: 0, errors: 0, pending: 0, thirdParty: 0, truncated: false,
};

const EMPTY_STORE_STATS: RequestStoreStats = {
  total: 0, pending: 0, errors: 0, thirdParty: 0, truncated: false,
};

const INITIAL_STATE: NetworkGraphState = {
  isOpen: false,
  activeTabId: null,
  source: 'unavailable',
  isLive: true,
  page: null,
  requests: [],
  graph: { nodes: [], edges: [] },
  positions: {},
  selectedNodeId: null,
  focusedNodeId: null,
  hiddenNodeIds: [],
  highlightMode: 'none',
  highlightedNodeIds: [],
  filters: { ...DEFAULT_GRAPH_FILTERS },
  stats: { ...EMPTY_STATS },
  storeStats: { ...EMPTY_STORE_STATS },
  inspectorOpen: false,
  inspectorSection: 'auto',
  snapshotMode: false,
  snapshotName: null,
  focusNonce: 0,
  status: { available: false },
  version: 0,
};

type Listener = () => void;

class NetworkGraphStore {
  private state: NetworkGraphState = INITIAL_STATE;
  private listeners = new Set<Listener>();
  private started = false;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  /** User drag overrides, kept across rebuilds until reset. */
  private positionOverrides: Record<string, { x: number; y: number }> = {};

  getState = (): NetworkGraphState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private patch(partial: Partial<NetworkGraphState>): void {
    this.state = { ...this.state, ...partial, version: this.state.version + 1 };
    this.listeners.forEach((l) => l());
  }

  /** Idempotent: wires the event bus + store subscriptions. */
  ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    networkEventBus.start();
    networkEventBus.onStatusChange((status) => {
      this.patch({
        status: { available: status.available, message: status.message },
        source: status.source,
      });
    });
    requestStore.subscribe((tabId) => {
      const s = this.state;
      if (!s.isOpen || s.snapshotMode || !s.isLive) return;
      if (tabId && s.activeTabId && tabId !== s.activeTabId) return;
      this.scheduleRebuild(120);
    });
    void networkEventBus.getStatus().then((status) => {
      this.patch({
        status: { available: status.available, message: status.message },
        source: status.source,
      });
    }).catch(() => {});
  }

  // ── data rebuild ────────────────────────────────────────────────────────

  private scheduleRebuild(delay: number): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild();
    }, delay);
  }

  private rebuild(): void {
    if (this.state.snapshotMode) return;
    const { activeTabId, filters, hiddenNodeIds } = this.state;
    const requests = activeTabId ? requestStore.getRequests(activeTabId) : [];
    const storeStats = activeTabId ? requestStore.getStats(activeTabId) : EMPTY_STORE_STATS;
    const pageInfo = activeTabId ? requestStore.getPage(activeTabId) : null;
    const page: GraphPageInfo | null = pageInfo
      ? { url: pageInfo.url, loadId: pageInfo.loadId }
      : null;

    const filtered = filterRequests(requests, filters, page?.url ?? null);
    let graph: GraphData = buildGraph(filtered, page?.url ?? null, { clusterMode: filters.clusterMode });
    graph = hideNodes(graph, hiddenNodeIds);

    const layout = layoutGraph(graph, { direction: filters.direction });
    const positions: Record<string, { x: number; y: number }> = { ...layout.positions };
    for (const [id, pos] of Object.entries(this.positionOverrides)) {
      if (positions[id]) positions[id] = pos;
    }

    const stats = computeStats(graph, filtered, storeStats);
    this.patch({
      requests,
      page,
      graph,
      positions,
      stats,
      storeStats,
      selectedNodeId: this.state.selectedNodeId && !graph.nodes.some((n) => n.id === this.state.selectedNodeId)
        ? null
        : this.state.selectedNodeId,
      inspectorOpen: this.state.selectedNodeId
        ? this.state.inspectorOpen && graph.nodes.some((n) => n.id === this.state.selectedNodeId)
        : this.state.inspectorOpen,
    });
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  open = (): void => {
    this.ensureStarted();
    if (this.state.isOpen) return;
    networkEventBus.setStreaming(true);
    networkEventBus.setLive(this.state.isLive);
    this.patch({ isOpen: true });
    this.rebuild();
  };

  close = (): void => {
    if (!this.state.isOpen) return;
    networkEventBus.setStreaming(false);
    this.patch({ isOpen: false, selectedNodeId: null, inspectorOpen: false, highlightMode: 'none', highlightedNodeIds: [] });
  };

  toggle = (): void => { if (this.state.isOpen) this.close(); else this.open(); };

  setActiveTab = (tabId: string | null, url?: string, title?: string): void => {
    if (tabId === this.state.activeTabId) {
      if (url !== undefined && this.state.page && this.state.page.url !== url) {
        this.patch({ page: { ...this.state.page, url, ...(title ? { title } : {}) } });
      }
      return;
    }
    this.positionOverrides = {};
    this.patch({
      activeTabId: tabId,
      page: tabId && url ? { url, loadId: requestStore.getPage(tabId)?.loadId ?? 0, ...(title ? { title } : {}) } : null,
      selectedNodeId: null,
      inspectorOpen: false,
      highlightMode: 'none',
      highlightedNodeIds: [],
      hiddenNodeIds: [],
      snapshotMode: false,
      snapshotName: null,
    });
    this.rebuild();
  };

  setPageTitle = (title: string): void => {
    if (!this.state.page || this.state.page.title === title) return;
    this.patch({ page: { ...this.state.page, title } });
  };

  setLive = (live: boolean): void => {
    networkEventBus.setLive(live);
    this.patch({ isLive: live });
    if (live) this.rebuild();
  };

  clear = (): void => {
    const tabId = this.state.activeTabId;
    if (tabId) requestStore.clear(tabId);
    networkEventBus.clear(tabId ?? undefined);
    this.positionOverrides = {};
    this.patch({
      graph: { nodes: [], edges: [] },
      positions: {},
      requests: [],
      stats: { ...EMPTY_STATS },
      storeStats: { ...EMPTY_STORE_STATS },
      selectedNodeId: null,
      focusedNodeId: null,
      inspectorOpen: false,
      hiddenNodeIds: [],
      highlightMode: 'none',
      highlightedNodeIds: [],
      snapshotMode: false,
      snapshotName: null,
    });
  };

  // ── selection / highlight ───────────────────────────────────────────────

  selectNode = (id: string | null, opts?: { openInspector?: boolean; section?: InspectorSection }): void => {
    if (!id) {
      this.patch({ selectedNodeId: null, inspectorOpen: false, highlightMode: 'none', highlightedNodeIds: [] });
      return;
    }
    const mode: HighlightMode = 'neighbors';
    const highlighted = collectRelatedNodes(this.state.graph, id, mode);
    this.patch({
      selectedNodeId: id,
      highlightMode: mode,
      highlightedNodeIds: highlighted,
      inspectorOpen: opts?.openInspector ?? true,
      inspectorSection: opts?.section ?? this.state.inspectorSection,
    });
  };

  setHighlight = (mode: HighlightMode, nodeId?: string): void => {
    const target = nodeId ?? this.state.selectedNodeId;
    if (mode === 'none' || !target) {
      this.patch({ highlightMode: 'none', highlightedNodeIds: [] });
      return;
    }
    this.patch({ highlightMode: mode, highlightedNodeIds: collectRelatedNodes(this.state.graph, target, mode) });
  };

  focusNode = (id: string): void => {
    this.patch({ focusedNodeId: id, focusNonce: this.state.focusNonce + 1 });
  };

  setNodePosition = (id: string, pos: { x: number; y: number }): void => {
    this.positionOverrides[id] = pos;
    this.patch({ positions: { ...this.state.positions, [id]: pos } });
  };

  hideNode = (id: string): void => {
    if (this.state.hiddenNodeIds.includes(id)) return;
    this.patch({
      hiddenNodeIds: [...this.state.hiddenNodeIds, id],
      selectedNodeId: this.state.selectedNodeId === id ? null : this.state.selectedNodeId,
      inspectorOpen: this.state.selectedNodeId === id ? false : this.state.inspectorOpen,
    });
    this.rebuild();
  };

  hideNodes = (ids: string[]): void => {
    const next = new Set([...this.state.hiddenNodeIds, ...ids]);
    this.patch({ hiddenNodeIds: [...next] });
    this.rebuild();
  };

  unhideAll = (): void => {
    if (!this.state.hiddenNodeIds.length) return;
    this.patch({ hiddenNodeIds: [] });
    this.rebuild();
  };

  /** R — reset layout overrides, hidden nodes and highlight. */
  resetView = (): void => {
    this.positionOverrides = {};
    this.patch({
      hiddenNodeIds: [],
      highlightMode: 'none',
      highlightedNodeIds: [],
      focusedNodeId: null,
      focusNonce: this.state.focusNonce + 1,
    });
    this.rebuild();
  };

  fitView = (): void => {
    this.patch({ focusNonce: this.state.focusNonce + 1 });
  };

  // ── filters ─────────────────────────────────────────────────────────────

  setFilters = (patch: Partial<GraphFilterState>): void => {
    const filters = { ...this.state.filters, ...patch };
    this.patch({ filters });
    this.scheduleRebuild(patch.search !== undefined ? 150 : 0);
  };

  toggleTypeFilter = (type: NetworkResourceType): void => {
    const current = this.state.filters.types;
    const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
    this.setFilters({ types: next });
  };

  // ── inspector ───────────────────────────────────────────────────────────

  setInspectorOpen = (open: boolean): void => this.patch({ inspectorOpen: open });
  setInspectorSection = (section: InspectorSection): void => this.patch({ inspectorSection: section });

  closeInspector = (): void => {
    this.patch({ inspectorOpen: false, selectedNodeId: null, highlightMode: 'none', highlightedNodeIds: [] });
  };

  // ── bodies ──────────────────────────────────────────────────────────────

  fetchBody = (wcId: number, cdpRequestId: string, kind: NetworkBodyKind): Promise<NetworkBodyResult> =>
    networkEventBus.getBody(wcId, cdpRequestId, kind);

  // ── snapshots ───────────────────────────────────────────────────────────

  saveSnapshot = (name?: string): NetworkGraphSnapshot => {
    const snapshot = buildSnapshot(this.state, name);
    saveSnapshotMeta(snapshot, name);
    return snapshot;
  };

  listSnapshots = (): SnapshotMeta[] => listSnapshots();

  loadSnapshot = (meta: SnapshotMeta): boolean => {
    const snapshot = loadSnapshotData(meta);
    if (!snapshot) return false;
    this.applySnapshot(snapshot, meta.name ?? null);
    return true;
  };

  importSnapshotFile = async (file: File): Promise<boolean> => {
    const snapshot = await readSnapshotFile(file);
    if (!snapshot) return false;
    this.applySnapshot(snapshot, file.name.replace(/\.json$/i, ''));
    return true;
  };

  private applySnapshot(snapshot: NetworkGraphSnapshot, name: string | null): void {
    this.positionOverrides = {};
    const filtered = filterRequests(snapshot.requests, this.state.filters, snapshot.page || null);
    let graph = buildGraph(filtered, snapshot.page || null, { clusterMode: this.state.filters.clusterMode });
    graph = hideNodes(graph, []);
    const layout = layoutGraph(graph, { direction: this.state.filters.direction });
    const storeStats: RequestStoreStats = {
      total: snapshot.requests.length,
      pending: snapshot.requests.filter((r) => r.state === 'pending').length,
      errors: snapshot.requests.filter((r) => r.state === 'failed' || (r.status ?? 0) >= 400).length,
      thirdParty: 0,
      truncated: false,
    };
    this.patch({
      snapshotMode: true,
      snapshotName: name,
      isLive: false,
      requests: snapshot.requests,
      page: snapshot.page ? { url: snapshot.page, loadId: 0 } : null,
      graph,
      positions: layout.positions,
      stats: computeStats(graph, filtered, storeStats),
      storeStats,
      selectedNodeId: null,
      inspectorOpen: false,
      focusedNodeId: null,
      focusNonce: this.state.focusNonce + 1,
      highlightMode: 'none',
      highlightedNodeIds: [],
    });
  }

  exportSnapshot = (): void => {
    const snapshot = buildSnapshot(this.state, this.state.snapshotName ?? undefined);
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `network-graph-snapshot-${new Date(snapshot.timestamp).toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
}

export const networkGraphStore = new NetworkGraphStore();

/** Selector hook — re-renders only when the selected value changes (Object.is). */
export function useNetworkGraphStore<T>(selector: (state: NetworkGraphState) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cacheRef = useRef<{ state: NetworkGraphState; value: T } | null>(null);

  const getSnapshot = useCallback((): T => {
    const state = networkGraphStore.getState();
    const cache = cacheRef.current;
    if (cache && cache.state === state) return cache.value;
    const value = selectorRef.current(state);
    if (cache && Object.is(cache.value, value)) {
      cacheRef.current = { state, value: cache.value };
      return cache.value;
    }
    cacheRef.current = { state, value };
    return value;
  }, []);

  return useSyncExternalStore(networkGraphStore.subscribe, getSnapshot, getSnapshot);
}

export type { NetworkGraphState };
