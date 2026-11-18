import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  Box,
  Code2,
  FileText,
  FileType2,
  Globe,
  Image,
  Layers,
  Monitor,
  Network,
  Radio,
  Type,
  Video,
} from 'lucide-react';
import type { GraphNode, GraphNodeKind } from '../../graph/types';
import type { NetworkResourceType } from '../../network/types';

export type PulseNodeData = GraphNode & { dimmed?: boolean } & Record<string, unknown>;
export type PulseNode = Node<PulseNodeData>;

const KIND_STYLE: Record<GraphNodeKind, string> = {
  page: 'border-pulse-accent/60 shadow-glow rounded-xl',
  domain: 'border-dashed border-pulse-purple/50',
  js: 'border-pulse-yellow/40',
  api: 'border-pulse-green/50',
  resource: 'border-pulse-borderStrong',
  websocket: 'border-pulse-orange/60',
  cluster: 'border-dashed border-pulse-accentDim/60 bg-pulse-panel/95',
};

function resourceIcon(resourceType?: NetworkResourceType) {
  const cls = 'text-pulse-muted shrink-0';
  switch (resourceType) {
    case 'image':
      return <Image size={14} className={cls} />;
    case 'stylesheet':
      return <FileType2 size={14} className={cls} />;
    case 'font':
      return <Type size={14} className={cls} />;
    case 'media':
      return <Video size={14} className={cls} />;
    case 'document':
      return <FileText size={14} className={cls} />;
    default:
      return <Box size={14} className={cls} />;
  }
}

function kindIcon(data: PulseNodeData) {
  switch (data.kind) {
    case 'page':
      return <Monitor size={14} className="text-pulse-accent shrink-0" />;
    case 'domain':
      return <Globe size={14} className="text-pulse-purple shrink-0" />;
    case 'js':
      return <Code2 size={14} className="text-pulse-yellow shrink-0" />;
    case 'api':
      return <Network size={14} className="text-pulse-green shrink-0" />;
    case 'websocket':
      return <Radio size={14} className="text-pulse-orange shrink-0" />;
    case 'cluster':
      return <Layers size={14} className="text-pulse-accentDim shrink-0" />;
    default:
      return resourceIcon(data.resourceType);
  }
}

const PILL = 'px-1 py-0.5 rounded text-[9px] font-mono leading-none tnum shrink-0';

function statusBadge(data: PulseNodeData) {
  if (data.kind === 'cluster') {
    if (data.count == null) return null;
    return <span className={`${PILL} bg-pulse-accent/15 text-pulse-accent`}>{data.count}</span>;
  }
  if (data.state === 'pending') {
    return <span className={`${PILL} text-pulse-yellow animate-pulse-soft`}>…</span>;
  }
  if (data.state === 'failed') {
    return <span className={`${PILL} bg-pulse-red/15 text-pulse-red`}>ERR</span>;
  }
  if (data.status != null) {
    const cls =
      data.status >= 400
        ? 'bg-pulse-red/15 text-pulse-red'
        : data.status >= 300
        ? 'bg-pulse-accent/15 text-pulse-accent'
        : 'bg-pulse-green/15 text-pulse-green';
    return <span className={`${PILL} ${cls}`}>{data.status}</span>;
  }
  return null;
}

const GraphNodeView = memo(function GraphNodeView({ data, selected }: NodeProps<PulseNode>) {
  const badge = statusBadge(data);
  const showSubRow = Boolean(data.sublabel) || data.thirdParty;

  return (
    <div
      className={`w-[200px] min-h-[56px] rounded-lg border px-2.5 py-2 backdrop-blur bg-pulse-surface/95 transition-all duration-150 ${
        KIND_STYLE[data.kind]
      } ${data.dimmed ? 'opacity-25' : ''} ${data.error ? '!border-pulse-red/60' : ''} ${
        selected ? 'ring-2 ring-pulse-accent' : ''
      }`}
    >
      <Handle id="top" type="target" position={Position.Top} isConnectable={false} className="w-2 h-2 !bg-transparent !border-0" />
      <Handle id="bottom" type="source" position={Position.Bottom} isConnectable={false} className="w-2 h-2 !bg-transparent !border-0" />
      <Handle id="left" type="target" position={Position.Left} isConnectable={false} className="w-2 h-2 !bg-transparent !border-0" />
      <Handle id="right" type="source" position={Position.Right} isConnectable={false} className="w-2 h-2 !bg-transparent !border-0" />

      <div className="flex items-center gap-1.5">
        {kindIcon(data)}
        <span
          className={`flex-1 min-w-0 font-mono text-[11px] text-pulse-text truncate ${
            data.kind === 'page' ? 'font-semibold' : ''
          }`}
        >
          {data.label}
        </span>
        {data.error && <AlertTriangle size={11} className="text-pulse-red shrink-0" />}
        {badge}
      </div>

      {showSubRow && (
        <div className="flex items-center gap-1.5 mt-1">
          {data.sublabel && (
            <span className="flex-1 min-w-0 text-[9px] text-pulse-muted truncate font-mono">{data.sublabel}</span>
          )}
          {!data.sublabel && <span className="flex-1" />}
          {data.thirdParty && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-pulse-purple/15 text-pulse-purple leading-none shrink-0">3P</span>
          )}
        </div>
      )}
    </div>
  );
});

export default GraphNodeView;
