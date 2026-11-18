import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { networkGraphStore, useNetworkGraphStore } from '../../graph/store';
import type { GraphData } from '../../graph/types';
import GraphNodeView, { type PulseNode, type PulseNodeData } from './GraphNodeView';
import GraphEdgeView, { type PulseEdge } from './GraphEdgeView';
import GraphMinimap from './GraphMinimap';
import NodeContextMenu from './NodeContextMenu';

const nodeTypes = { pulse: GraphNodeView };
const edgeTypes = { pulse: GraphEdgeView };

function GraphCanvasInner() {
  const graph = useNetworkGraphStore((s) => s.graph);
  const positions = useNetworkGraphStore((s) => s.positions);
  const selectedNodeId = useNetworkGraphStore((s) => s.selectedNodeId);
  const highlightMode = useNetworkGraphStore((s) => s.highlightMode);
  const highlightedNodeIds = useNetworkGraphStore((s) => s.highlightedNodeIds);
  const focusNonce = useNetworkGraphStore((s) => s.focusNonce);
  const focusedNodeId = useNetworkGraphStore((s) => s.focusedNodeId);
  const direction = useNetworkGraphStore((s) => s.filters.direction);

  const { fitView } = useReactFlow();

  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const menuPosition = useRef<{ x: number; y: number } | null>(null);

  const highlightKey =
    highlightMode === 'none' || highlightedNodeIds.length === 0
      ? ''
      : JSON.stringify(highlightedNodeIds);
  const highlightSet = useMemo(
    () => (highlightKey ? new Set(JSON.parse(highlightKey) as string[]) : null),
    [highlightKey],
  );

  const dataCache = useRef<{ graph: GraphData; key: string; map: Map<string, PulseNodeData> } | null>(null);

  const nodes = useMemo<PulseNode[]>(() => {
    let dataMap = dataCache.current?.map;
    if (!dataMap || dataCache.current?.graph !== graph || dataCache.current.key !== highlightKey) {
      dataMap = new Map<string, PulseNodeData>();
      for (const n of graph.nodes) {
        dataMap.set(n.id, highlightSet ? { ...n, dimmed: !highlightSet.has(n.id) } : { ...n });
      }
      dataCache.current = { graph, key: highlightKey, map: dataMap };
    }
    const map = dataMap;
    return graph.nodes.map((n) => ({
      id: n.id,
      type: 'pulse',
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: map.get(n.id) ?? { ...n },
      selected: n.id === selectedNodeId,
      draggable: true,
    }));
  }, [graph, positions, selectedNodeId, highlightKey, highlightSet]);

  const edges = useMemo<PulseEdge[]>(
    () =>
      // Dense graphs: hide edge labels to avoid a wall of overlapping
      // POST/OPTIONS pills — labels return when the graph is small or selected.
      graph.edges.map((e) => {
        const selected = e.source === selectedNodeId || e.target === selectedNodeId;
        const hideLabel = !selected && graph.edges.length > 40;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'pulse',
          data: hideLabel ? { ...e, label: undefined } : { ...e },
          selected,
          sourceHandle: direction === 'TB' ? 'bottom' : 'right',
          targetHandle: direction === 'TB' ? 'top' : 'left',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#A8A8B3' },
        };
      }),
    [graph, selectedNodeId, direction],
  );

  useEffect(() => {
    if (focusedNodeId) {
      void fitView({
        nodes: [{ id: focusedNodeId }],
        duration: 400,
        padding: 0.5,
        maxZoom: 1.2,
      });
    } else {
      void fitView({ duration: 300, padding: 0.18 });
    }
  }, [focusNonce]);

  const closeMenu = () => {
    menuPosition.current = null;
    setMenuNodeId(null);
  };

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onlyRenderVisibleElements
        minZoom={0.05}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        panOnDrag
        zoomOnPinch
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        onNodeClick={(_, n) => networkGraphStore.selectNode(n.id)}
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          menuPosition.current = { x: e.clientX, y: e.clientY };
          setMenuNodeId(n.id);
        }}
        onPaneClick={() => networkGraphStore.selectNode(null)}
        onNodeDragStop={(_, n) => networkGraphStore.setNodePosition(n.id, n.position)}
        onEdgeClick={(_, e) => {
          if (e.target) networkGraphStore.selectNode(e.target);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(245,245,247,0.07)" />
        <Controls position="bottom-left" showInteractive={false} />
        <GraphMinimap />
      </ReactFlow>
      <NodeContextMenu nodeId={menuNodeId} position={menuPosition.current} onClose={closeMenu} />
    </>
  );
}

export default function GraphCanvas() {
  return (
    <div className="h-full w-full netgraph-canvas">
      <ReactFlowProvider>
        <GraphCanvasInner />
      </ReactFlowProvider>
    </div>
  );
}
