import { useEffect } from 'react';
import {
  Copy,
  ExternalLink,
  EyeOff,
  FileCode,
  GitBranch,
  Globe,
  ListFilter,
  LocateFixed,
  PanelRightOpen,
  Waypoints,
} from 'lucide-react';
import ContextMenu, { copyToClipboard, type ContextMenuItem } from '../ContextMenu';
import { networkGraphStore, useNetworkGraphStore } from '../../graph/store';

interface NodeContextMenuProps {
  nodeId: string | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export default function NodeContextMenu({ nodeId, position, onClose }: NodeContextMenuProps) {
  const node = useNetworkGraphStore((s) =>
    nodeId ? s.graph.nodes.find((n) => n.id === nodeId) ?? null : null,
  );

  useEffect(() => {
    if (!nodeId || !position) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [nodeId, position, onClose]);

  if (!nodeId || !node || !position) return null;

  const url = node.request?.url ?? node.domain ?? '';
  const items: ContextMenuItem[] = [];

  if (node.kind === 'cluster') {
    items.push({
      id: 'focus',
      label: 'Focus',
      icon: <LocateFixed size={13} />,
      dividerAfter: true,
      onClick: () => networkGraphStore.focusNode(nodeId),
    });
    items.push({
      id: 'copy-url',
      label: 'Copy URL',
      icon: <Copy size={13} />,
      onClick: () => void copyToClipboard(url),
    });
    return <ContextMenu items={items} position={position} onClose={onClose} />;
  }

  items.push({
    id: 'open',
    label: 'Open',
    icon: <ExternalLink size={13} />,
    onClick: () => window.dispatchEvent(new CustomEvent('netgraph-open-url', { detail: { url } })),
  });
  items.push({
    id: 'focus',
    label: 'Focus',
    icon: <LocateFixed size={13} />,
    dividerAfter: true,
    onClick: () => networkGraphStore.focusNode(nodeId),
  });
  items.push({
    id: 'copy-url',
    label: 'Copy URL',
    icon: <Copy size={13} />,
    onClick: () => void copyToClipboard(url),
  });
  items.push({
    id: 'copy-request',
    label: 'Copy request',
    icon: <FileCode size={13} />,
    onClick: () =>
      void copyToClipboard(
        `${node.request?.method ?? 'GET'} ${url}\nHost: ${node.domain ?? ''}`,
      ),
  });
  items.push({
    id: 'initiators',
    label: 'Show initiator',
    icon: <GitBranch size={13} />,
    onClick: () => {
      networkGraphStore.selectNode(nodeId, { openInspector: false });
      networkGraphStore.setHighlight('initiators', nodeId);
    },
  });
  items.push({
    id: 'dependents',
    label: 'Show dependents',
    icon: <Waypoints size={13} />,
    onClick: () => networkGraphStore.setHighlight('dependents', nodeId),
  });
  items.push({
    id: 'domain',
    label: 'Show domain',
    icon: <Globe size={13} />,
    onClick: () => networkGraphStore.setHighlight('domain', nodeId),
  });

  if (node.kind === 'domain') {
    items.push({
      id: 'domain-requests',
      label: 'Show all requests',
      icon: <ListFilter size={13} />,
      onClick: () => networkGraphStore.setHighlight('domain', nodeId),
    });
  }
  if (node.kind === 'js') {
    items.push({
      id: 'js-initiated',
      label: 'Show initiated requests',
      icon: <GitBranch size={13} />,
      onClick: () => networkGraphStore.setHighlight('dependents', nodeId),
    });
  }

  items.push({
    id: 'inspector',
    label: 'Open in Request Inspector',
    icon: <PanelRightOpen size={13} />,
    dividerAfter: true,
    onClick: () => networkGraphStore.selectNode(nodeId, { openInspector: true }),
  });
  items.push({
    id: 'hide',
    label: 'Hide node',
    icon: <EyeOff size={13} />,
    danger: true,
    onClick: () => networkGraphStore.hideNode(nodeId),
  });

  return <ContextMenu items={items} position={position} onClose={onClose} />;
}
