/**
 * GraphLayout — deterministic layered layout (spec §20).
 *
 * BFS layers from page/cluster roots; main axis = layer × layerGap,
 * cross axis centered with nodeGap. Drag overrides are applied by the store
 * on top of these positions.
 */
import type { GraphData, GraphLayoutOptions, LayoutDirection, LayoutResult } from './types';

const DEFAULTS = { layerGap: 260, nodeGap: 232, nodeWidth: 200, nodeHeight: 72 };

export function layoutGraph(
  graph: GraphData,
  opts: { direction: LayoutDirection } & Partial<GraphLayoutOptions>,
): LayoutResult {
  const layerGap = opts.layerGap ?? DEFAULTS.layerGap;
  const nodeGap = opts.nodeGap ?? DEFAULTS.nodeGap;
  const nodeWidth = opts.nodeWidth ?? DEFAULTS.nodeWidth;
  const nodeHeight = opts.nodeHeight ?? DEFAULTS.nodeHeight;
  const horizontal = opts.direction === 'LR';

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }

  const depth = new Map<string, number>();
  const roots = graph.nodes.filter(
    (n) => n.kind === 'page' || n.kind === 'cluster' || !(incoming.get(n.id)?.length),
  );
  const queue: Array<{ id: string; d: number }> = (roots.length > 0 ? roots : graph.nodes).map((n) => ({
    id: n.id,
    d: 0,
  }));
  for (const q of queue) {
    if (depth.has(q.id)) continue;
    depth.set(q.id, q.d);
    for (const next of outgoing.get(q.id) ?? []) {
      if (!depth.has(next)) queue.push({ id: next, d: q.d + 1 });
    }
  }
  for (const n of graph.nodes) {
    if (!depth.has(n.id)) depth.set(n.id, 0);
  }

  const layers = new Map<number, string[]>();
  for (const [id, d] of depth) {
    const list = layers.get(d) ?? [];
    list.push(id);
    layers.set(d, list);
  }

  const positions: Record<string, { x: number; y: number }> = {};
  let width = nodeWidth;
  let height = nodeHeight;
  const sortedLayers = Array.from(layers.entries()).sort((a, b) => a[0] - b[0]);
  for (const [layer, ids] of sortedLayers) {
    ids.sort();
    const span = (ids.length - 1) * nodeGap;
    ids.forEach((id, i) => {
      const cross = ids.length > 1 ? i * nodeGap - span / 2 : 0;
      const main = layer * layerGap;
      const x = horizontal ? main : cross;
      const y = horizontal ? cross : main;
      positions[id] = { x, y };
      width = Math.max(width, x + nodeWidth);
      height = Math.max(height, y + nodeHeight);
    });
  }

  return { positions, width, height };
}
