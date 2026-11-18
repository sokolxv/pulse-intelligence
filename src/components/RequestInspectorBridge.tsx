import { useCallback } from 'react';
import RequestInspector from './RequestInspector';
import { networkGraphStore, useNetworkGraphStore } from '../graph/store';
import type { NetworkBodyKind, NetworkBodyResult } from '../network/types';

/** Bridges the singleton graph store into the `RequestInspector` props. */
export default function RequestInspectorBridge() {
  const graph = useNetworkGraphStore((s) => s.graph);
  const requests = useNetworkGraphStore((s) => s.requests);
  const page = useNetworkGraphStore((s) => s.page);
  const section = useNetworkGraphStore((s) => s.inspectorSection);
  const selectedNodeId = useNetworkGraphStore((s) => s.selectedNodeId);

  const node = selectedNodeId ? graph.nodes.find((n) => n.id === selectedNodeId) ?? null : null;

  const onSectionChange = useCallback(
    (s: typeof section) => networkGraphStore.setInspectorSection(s),
    [],
  );

  const onRequestSelect = useCallback(
    (requestId: string) => {
      const state = networkGraphStore.getState();
      const target = state.graph.nodes.find((n) => n.requestIds.includes(requestId));
      if (target) networkGraphStore.selectNode(target.id);
    },
    [],
  );

  const onClose = useCallback(() => networkGraphStore.closeInspector(), []);

  const onFetchBody = useCallback(
    (kind: NetworkBodyKind): Promise<NetworkBodyResult> => {
      const state = networkGraphStore.getState();
      const current = selectedNodeId
        ? state.graph.nodes.find((n) => n.id === selectedNodeId)
        : null;
      const req =
        current?.request ??
        state.requests.find((r) => current?.requestIds.includes(r.id));
      if (!req?.cdpRequestId || req.wcId === undefined || req.wcId === null) {
        return Promise.resolve({ ok: false, error: 'Body unavailable for this request' });
      }
      return networkGraphStore.fetchBody(req.wcId, req.cdpRequestId, kind);
    },
    [selectedNodeId],
  );

  return (
    <RequestInspector
      node={node}
      requests={requests}
      pageUrl={page?.url ?? null}
      section={section}
      onSectionChange={onSectionChange}
      onRequestSelect={onRequestSelect}
      onClose={onClose}
      onFetchBody={onFetchBody}
    />
  );
}
