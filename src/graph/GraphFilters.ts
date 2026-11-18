/**
 * GraphFilters — request filtering, node hiding, highlight collection and
 * graph statistics (spec §20–21).
 */
import type {
  GraphData,
  GraphFilterState,
  GraphStats,
  HighlightMode,
} from './types';
import type { NetworkRequest, RequestStoreStats } from '../network/types';
import { getHost, isThirdParty } from '../network/DomainResolver';

function isErrored(r: NetworkRequest): boolean {
  return r.state === 'failed' || r.state === 'canceled' || (r.status ?? 0) >= 400;
}

export function filterRequests(
  requests: NetworkRequest[],
  filters: GraphFilterState,
  pageUrl: string | null,
): NetworkRequest[] {
  const q = filters.search.trim().toLowerCase();
  return requests.filter((r) => {
    if (filters.types.length > 0 && !filters.types.includes(r.type)) return false;
    if (filters.errorsOnly && !isErrored(r)) return false;
    if (pageUrl) {
      const third = isThirdParty(pageUrl, r.url);
      if (filters.firstPartyOnly && third) return false;
      if (filters.thirdPartyOnly && !third) return false;
    } else if (filters.thirdPartyOnly) {
      return false;
    }
    if (q) {
      const hay = `${r.url} ${r.method} ${r.domain} ${r.status ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function hideNodes(graph: GraphData, hiddenIds: string[]): GraphData {
  if (hiddenIds.length === 0) return graph;
  const hidden = new Set(hiddenIds);
  return {
    nodes: graph.nodes.filter((n) => !hidden.has(n.id)),
    edges: graph.edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target)),
  };
}

export function collectRelatedNodes(
  graph: GraphData,
  id: string,
  mode: HighlightMode,
): string[] {
  const out = new Set<string>([id]);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }

  const walkUp = (start: string): void => {
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const prev of incoming.get(cur) ?? []) {
        if (!out.has(prev)) {
          out.add(prev);
          stack.push(prev);
        }
      }
    }
  };
  const walkDown = (start: string): void => {
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const next of outgoing.get(cur) ?? []) {
        if (!out.has(next)) {
          out.add(next);
          stack.push(next);
        }
      }
    }
  };

  switch (mode) {
    case 'neighbors': {
      for (const n of incoming.get(id) ?? []) out.add(n);
      for (const n of outgoing.get(id) ?? []) out.add(n);
      break;
    }
    case 'initiators':
      walkUp(id);
      break;
    case 'dependents':
      walkDown(id);
      break;
    case 'domain': {
      const self = graph.nodes.find((n) => n.id === id);
      const host = self?.domain ?? (self?.request ? getHost(self.request.url) : undefined);
      if (host) {
        for (const n of graph.nodes) {
          const h = n.domain ?? (n.request ? getHost(n.request.url) : undefined);
          if (h === host) out.add(n.id);
        }
      }
      break;
    }
    case 'search':
    case 'none':
      break;
  }
  return Array.from(out);
}

export function computeStats(
  graph: GraphData,
  filtered: NetworkRequest[],
  storeStats: RequestStoreStats,
): GraphStats {
  let errors = 0;
  let pending = 0;
  for (const r of filtered) {
    if (isErrored(r)) errors += 1;
    if (r.state === 'pending') pending += 1;
  }
  return {
    total: storeStats.total,
    shown: filtered.length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    errors,
    pending,
    thirdParty: storeStats.thirdParty,
    truncated: storeStats.truncated,
  };
}
