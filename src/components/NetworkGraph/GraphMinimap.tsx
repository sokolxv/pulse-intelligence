import { MiniMap } from '@xyflow/react';
import type { GraphNodeKind } from '../../graph/types';

const KIND_COLORS: Record<GraphNodeKind, string> = {
  page: '#F5F5F7',
  domain: '#A79BB2',
  js: '#C8A87E',
  api: '#8CA58A',
  resource: '#71717B',
  websocket: '#B99776',
  cluster: '#A8A8B3',
};

export default function GraphMinimap() {
  return (
    <div className="pointer-events-auto">
      <MiniMap
        position="bottom-right"
        maskColor="rgba(10,10,12,0.82)"
        pannable
        zoomable
        nodeStrokeWidth={2}
        nodeColor={(node) =>
          KIND_COLORS[(node.data as { kind?: GraphNodeKind }).kind ?? 'resource'] ?? '#71717B'
        }
      />
    </div>
  );
}
