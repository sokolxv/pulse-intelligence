/**
 * Snapshot — save / list / load Network Graph snapshots (spec §23).
 *
 * Snapshots are versioned (`version: 1`) JSON documents persisted in
 * localStorage under `pulse:netgraph:snapshots:<name>`. Export/import via
 * plain files reuses the same schema.
 */
import type { NetworkGraphSnapshot, NetworkGraphState } from './types';

export interface SnapshotMeta {
  name: string;
  timestamp: number;
}

const PREFIX = 'pulse:netgraph:snapshots:';

function isSnapshot(value: unknown): value is NetworkGraphSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && typeof v.timestamp === 'number' && Array.isArray(v.requests);
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function buildSnapshot(state: NetworkGraphState, name?: string): NetworkGraphSnapshot {
  return {
    version: 1,
    timestamp: Date.now(),
    page: state.page?.url ?? '',
    nodes: state.graph.nodes,
    edges: state.graph.edges,
    requests: state.requests,
  };
}

export function saveSnapshotMeta(snapshot: NetworkGraphSnapshot, name?: string): void {
  const store = storage();
  if (!store) return;
  const metaName = name ?? `snapshot-${new Date(snapshot.timestamp).toISOString().replace(/[:.]/g, '-')}`;
  try {
    store.setItem(PREFIX + metaName, JSON.stringify(snapshot));
  } catch {
    // Quota or serialization errors are non-fatal for the panel.
  }
}

export function listSnapshots(): SnapshotMeta[] {
  const store = storage();
  if (!store) return [];
  const out: SnapshotMeta[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const name = key.slice(PREFIX.length);
    try {
      const raw = store.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      out.push({
        name,
        timestamp:
          parsed && typeof parsed === 'object' && typeof (parsed as { timestamp?: unknown }).timestamp === 'number'
            ? (parsed as { timestamp: number }).timestamp
            : 0,
      });
    } catch {
      out.push({ name, timestamp: 0 });
    }
  }
  out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
}

export function loadSnapshotData(meta: SnapshotMeta): NetworkGraphSnapshot | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + meta.name);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readSnapshotFile(file: File): Promise<NetworkGraphSnapshot | null> {
  try {
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
