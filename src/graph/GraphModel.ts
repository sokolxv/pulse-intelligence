/**
 * GraphModel — turns `NetworkRequest[]` into `GraphData` (spec §20).
 *
 * Node ids: `page:<origin>`, `domain:<host>`, `req:<requestId>`,
 * `cluster:<key>`. Edges: `page-load` from the page node, `initiator`
 * (script → request), `host` (req → domain, only when the host differs from
 * the page host), `redirect` chains, `aggregated` for clusters.
 */
import type { ClusterMode, GraphData, GraphEdge, GraphNode } from './types';
import { AUTO_CLUSTER_THRESHOLD } from './types';
import type { NetworkRequest } from '../network/types';
import { getHost, getOrigin, isThirdParty, shortLabel } from '../network/DomainResolver';

export interface BuildGraphOptions {
  clusterMode?: ClusterMode;
}

function isErrored(r: NetworkRequest): boolean {
  return r.state === 'failed' || r.state === 'canceled' || (r.status ?? 0) >= 400;
}

function nodeKindFor(r: NetworkRequest): GraphNode['kind'] {
  if (r.type === 'script') return 'js';
  if (r.type === 'xhr' || r.type === 'fetch') return 'api';
  if (r.type === 'websocket') return 'websocket';
  return 'resource';
}

function initiatorLabel(r: NetworkRequest): string {
  const frames = r.initiatorInfo?.frames;
  if (frames && frames.length > 0) {
    const f = frames[0];
    const base = shortLabel(f.url);
    const line = (f.lineNumber ?? 0) + 1;
    return `${base}:${line}`;
  }
  if (r.initiator) return shortLabel(r.initiator);
  return r.method || 'GET';
}

function clusterKeyFor(r: NetworkRequest, mode: Exclude<ClusterMode, 'auto' | 'none'>, pageUrl: string | null): string | null {
  if (mode === 'domain') return `domain:${r.domain || 'unknown'}`;
  if (mode === 'type') return `type:${r.type}`;
  if (mode === 'thirdparty') {
    if (!pageUrl || !isThirdParty(pageUrl, r.url)) return null;
    return 'thirdparty';
  }
  return null;
}

export function buildGraph(
  requests: NetworkRequest[],
  pageUrl: string | null,
  opts: BuildGraphOptions = {},
): GraphData {
  const clusterMode = opts.clusterMode ?? 'auto';
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byId = new Map<string, GraphNode>();

  const pageOrigin = pageUrl ? getOrigin(pageUrl) : '';
  const pageHost = pageUrl ? getHost(pageUrl) : '';
  const pageId = `page:${pageOrigin || 'unknown'}`;
  const pageNode: GraphNode = {
    id: pageId,
    kind: 'page',
    label: pageHost || pageUrl || 'page',
    sublabel: pageUrl ?? undefined,
    requestIds: [],
    thirdParty: false,
    error: false,
  };
  nodes.push(pageNode);
  byId.set(pageId, pageNode);

  // Main-document requests merge into the page node.
  const mainDocs: NetworkRequest[] = [];
  const rest: NetworkRequest[] = [];
  for (const r of requests) {
    if (r.type === 'document' && pageUrl && r.url === pageUrl) mainDocs.push(r);
    else rest.push(r);
  }
  for (const r of mainDocs) {
    pageNode.requestIds.push(r.id);
    if (!pageNode.request) pageNode.request = r;
    if (r.status !== undefined) pageNode.status = r.status;
    pageNode.state = r.state;
    if (isErrored(r)) pageNode.error = true;
  }

  // Request nodes + domain nodes.
  const domainNodes = new Map<string, GraphNode>();
  const ensureDomain = (host: string): GraphNode => {
    const id = `domain:${host || 'unknown'}`;
    let n = byId.get(id);
    if (!n) {
      n = {
        id,
        kind: 'domain',
        label: host || 'unknown',
        requestIds: [],
        domain: host,
        thirdParty: pageUrl ? isThirdParty(pageUrl, host) : false,
        error: false,
      };
      byId.set(id, n);
      nodes.push(n);
      domainNodes.set(id, n);
    }
    return n;
  };

  const urlToNodeId = new Map<string, string>();
  for (const r of rest) {
    const host = r.domain || getHost(r.url);
    const thirdParty = pageUrl ? isThirdParty(pageUrl, r.url) : false;
    const node: GraphNode = {
      id: `req:${r.id}`,
      kind: nodeKindFor(r),
      label: shortLabel(r.url),
      sublabel: host,
      requestIds: [r.id],
      request: r,
      resourceType: r.type,
      domain: host,
      thirdParty,
      status: r.status,
      state: r.state,
      error: isErrored(r),
    };
    byId.set(node.id, node);
    nodes.push(node);
    if (!urlToNodeId.has(r.url)) urlToNodeId.set(r.url, node.id);
  }

  // Host edges: req → domain, only when the host differs from the page host.
  for (const r of rest) {
    const host = r.domain || getHost(r.url);
    if (host && host !== pageHost) {
      const d = ensureDomain(host);
      d.requestIds.push(r.id);
      edges.push({
        id: `host:${r.id}`,
        source: `req:${r.id}`,
        target: d.id,
        kind: 'host',
        label: host,
        reason: `hosted on ${host}`,
        requestIds: [r.id],
        pending: r.state === 'pending',
        error: isErrored(r),
      });
    }
  }

  // Redirect chains.
  const reqById = new Map(rest.map((r) => [r.id, r]));
  for (const r of rest) {
    if (r.redirectedFrom && reqById.has(r.redirectedFrom)) {
      edges.push({
        id: `redirect:${r.redirectedFrom}->${r.id}`,
        source: `req:${r.redirectedFrom}`,
        target: `req:${r.id}`,
        kind: 'redirect',
        label: r.status ? String(r.status) : 'redirect',
        reason: 'redirect chain',
        requestIds: [r.id],
        error: isErrored(r),
      });
    }
  }

  // Initiator edges (script → request) or page-load fallback.
  for (const r of rest) {
    if (r.redirectedFrom && reqById.has(r.redirectedFrom)) continue;
    const initiatorUrl = r.initiatorInfo?.url ?? r.initiator;
    const sourceId = initiatorUrl ? urlToNodeId.get(initiatorUrl) : undefined;
    if (sourceId && sourceId !== `req:${r.id}`) {
      edges.push({
        id: `initiator:${r.id}`,
        source: sourceId,
        target: `req:${r.id}`,
        kind: 'initiator',
        label: initiatorLabel(r),
        reason: `initiated by ${initiatorUrl}`,
        requestIds: [r.id],
        pending: r.state === 'pending',
        error: isErrored(r),
      });
    } else {
      edges.push({
        id: `pageload:${r.id}`,
        source: pageId,
        target: `req:${r.id}`,
        kind: 'page-load',
        label: r.method || 'GET',
        reason: 'loaded by page',
        requestIds: [r.id],
        pending: r.state === 'pending',
        error: isErrored(r),
      });
    }
  }

  // Clustering.
  let effectiveMode = clusterMode;
  if (clusterMode === 'auto') {
    const reqNodeCount = nodes.filter((n) => n.id.startsWith('req:')).length;
    effectiveMode = reqNodeCount > AUTO_CLUSTER_THRESHOLD ? 'domain' : 'none';
  }
  if (effectiveMode !== 'none') {
    const mode = effectiveMode as Exclude<ClusterMode, 'auto' | 'none'>;
    const groups = new Map<string, NetworkRequest[]>();
    for (const r of rest) {
      const key = clusterKeyFor(r, mode, pageUrl);
      if (!key) continue;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    const clusteredIds = new Set<string>();
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      const id = `cluster:${key}`;
      const first = list[0];
      const thirdParty = pageUrl ? list.some((r) => isThirdParty(pageUrl, r.url)) : false;
      const cluster: GraphNode = {
        id,
        kind: 'cluster',
        label: key,
        sublabel: `${list.length} requests`,
        requestIds: list.map((r) => r.id),
        children: list.map((r) => r.id),
        domain: mode === 'domain' ? first.domain : undefined,
        resourceType: mode === 'type' ? first.type : undefined,
        thirdParty,
        error: list.some(isErrored),
        count: list.length,
      };
      byId.set(id, cluster);
      nodes.push(cluster);
      for (const r of list) clusteredIds.add(`req:${r.id}`);
      edges.push({
        id: `aggregated:${key}`,
        source: pageId,
        target: id,
        kind: 'aggregated',
        label: `${list.length}`,
        reason: `clustered by ${mode}`,
        requestIds: cluster.requestIds,
        error: cluster.error,
      });
    }
    if (clusteredIds.size > 0) {
      const keptNodes = nodes.filter((n) => !clusteredIds.has(n.id));
      const keptEdges = edges.filter((e) => {
        if (clusteredIds.has(e.source) || clusteredIds.has(e.target)) {
          return e.kind === 'host';
        }
        return true;
      });
      // Re-point host edges of clustered members to their cluster node.
      const memberToCluster = new Map<string, string>();
      for (const n of keptNodes) {
        if (n.kind === 'cluster' && n.children) {
          for (const rid of n.children) memberToCluster.set(`req:${rid}`, n.id);
        }
      }
      for (const e of keptEdges) {
        if (e.kind === 'host') {
          const c = memberToCluster.get(e.source);
          if (c) e.source = c;
        }
      }
      return { nodes: keptNodes, edges: keptEdges };
    }
  }

  return { nodes, edges };
}
