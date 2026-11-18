import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { GraphEdge } from '../../graph/types';

export type PulseEdgeData = GraphEdge & Record<string, unknown>;
export type PulseEdge = Edge<PulseEdgeData>;

function GraphEdgeView({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<PulseEdge>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  let stroke = 'rgba(245,245,247,0.28)';
  let strokeWidth = 1.5;
  let filter: string | undefined;
  let className: string | undefined;

  if (data?.error) {
    stroke = '#B97F70';
    strokeWidth = 2;
  }
  if (data?.pending) {
    stroke = 'rgba(245,245,247,0.65)';
    className = 'netgraph-edge-active';
  }
  if (selected) {
    stroke = '#F5F5F7';
    strokeWidth = 2.2;
    filter = 'drop-shadow(0 0 3px rgba(245,245,247,0.5))';
  }

  const label = data?.label;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={className} style={{ stroke, strokeWidth, filter }} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-none px-1 py-0.5 rounded bg-pulse-bg/90 border border-pulse-border text-pulse-muted text-[8px] font-mono whitespace-nowrap"
            style={{
              transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(GraphEdgeView);
