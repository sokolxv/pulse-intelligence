import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { motion } from 'framer-motion';
import { Network, X } from 'lucide-react';
import { networkGraphStore, useNetworkGraphStore } from '../../graph/store';
import GraphToolbar from './GraphToolbar';
import GraphFiltersBar from './GraphFiltersBar';
import GraphCanvas from './GraphCanvas';

interface NetworkGraphPanelProps {
  activeTabId: string | null;
  pageUrl: string;
  pageTitle?: string;
  onClose: () => void;
  inspector?: ReactNode;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
};

export default function NetworkGraphPanel({
  activeTabId,
  pageUrl,
  pageTitle,
  onClose,
  inspector,
}: NetworkGraphPanelProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const graph = useNetworkGraphStore((s) => s.graph);
  const source = useNetworkGraphStore((s) => s.source);
  const isLive = useNetworkGraphStore((s) => s.isLive);
  const stats = useNetworkGraphStore((s) => s.stats);
  const inspectorOpen = useNetworkGraphStore((s) => s.inspectorOpen);

  const [inspectorWidth, setInspectorWidth] = useState(400);
  const bodyRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    networkGraphStore.open();
  }, []);

  useEffect(() => {
    networkGraphStore.setActiveTab(activeTabId, pageUrl, pageTitle);
  }, [activeTabId, pageUrl, pageTitle]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('netgraph-focus-search'));
        return;
      }

      if (e.key === 'Escape') {
        const state = networkGraphStore.getState();
        if (state.inspectorOpen) networkGraphStore.closeInspector();
        else onCloseRef.current();
        return;
      }

      if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;

      const state = networkGraphStore.getState();
      if (e.key === 'f' || e.key === 'F') {
        if (state.selectedNodeId) networkGraphStore.focusNode(state.selectedNodeId);
      } else if (e.key === 'r' || e.key === 'R') {
        networkGraphStore.resetView();
      } else if (e.key === 'l' || e.key === 'L') {
        networkGraphStore.setLive(!state.isLive);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedNodeId) networkGraphStore.hideNode(state.selectedNodeId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onSplitPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
  };

  const onSplitPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.round(rect.right - e.clientX);
    setInspectorWidth(Math.min(640, Math.max(320, width)));
  };

  const onSplitPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const showInspector = Boolean(inspector) && inspectorOpen;
  const empty = graph.nodes.length === 0;

  const sourceBadge =
    source === 'demo'
      ? { label: 'DEMO', cls: 'text-pulse-yellow border-pulse-yellow/40 bg-pulse-yellow/10' }
      : source === 'unavailable'
      ? { label: 'OFFLINE', cls: 'text-pulse-red border-pulse-red/40 bg-pulse-red/10' }
      : isLive
      ? { label: 'LIVE', cls: 'text-pulse-green border-pulse-green/40 bg-pulse-green/10' }
      : { label: 'PAUSED', cls: 'text-pulse-muted border-pulse-border bg-pulse-panel' };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={() => onCloseRef.current()}
        className="absolute inset-0 z-20 bg-black/55 backdrop-blur-[2px]"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        transition={{ duration: 0.2, ease: [0.22, 0.9, 0.3, 1] }}
        className="absolute inset-3 z-30 flex flex-col overflow-hidden rounded-2xl border border-pulse-border/70 bg-pulse-bg/92 shadow-card ring-1 ring-black/40 backdrop-blur-md"
      >
      <GraphToolbar searchRef={searchRef} onClose={onClose} />

      <div className="shrink-0 border-b border-pulse-border/60 bg-pulse-surface/60 px-3 py-1.5 overflow-x-auto">
        <GraphFiltersBar />
      </div>

      <div ref={bodyRef} className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 relative flex flex-col">
          <div className="flex-1 min-h-0 relative">
            <GraphCanvas />
            {empty && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-4">
                <div className="flex flex-col items-center gap-3 text-center max-w-sm">
                  <Network size={32} className="text-pulse-accent/50" />
                  <div className="text-[13px] font-semibold text-pulse-text">No network activity yet</div>
                  <div className="text-[11px] text-pulse-muted leading-relaxed">
                    Open or refresh a page — requests appear here in real time.
                  </div>
                  {source === 'unavailable' && (
                    <div className="text-[11px] text-pulse-red/80">
                      Network capture requires the Electron runtime.
                    </div>
                  )}
                  {source === 'demo' && (
                    <span className="px-2 py-0.5 rounded-full border border-pulse-yellow/40 bg-pulse-yellow/10 text-pulse-yellow text-[10px] font-mono">
                      DEMO DATA
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {showInspector && (
          <>
            <div
              onPointerDown={onSplitPointerDown}
              onPointerMove={onSplitPointerMove}
              onPointerUp={onSplitPointerUp}
              onPointerCancel={onSplitPointerUp}
              className="w-1 shrink-0 cursor-col-resize bg-pulse-border/60 hover:bg-pulse-accent/40 active:bg-pulse-accent/60 transition-colors duration-150"
            />
            <div
              style={{ width: inspectorWidth }}
              className="flex flex-col min-w-[320px] max-w-[640px] shrink-0 border-l border-pulse-border/60 bg-pulse-surface/95"
            >
              <div className="h-8 shrink-0 flex items-center justify-between px-2.5 border-b border-pulse-border/60 bg-pulse-surface/80">
                <span className="text-[11px] font-semibold text-pulse-text">Request Inspector</span>
                <button
                  onClick={() => networkGraphStore.setInspectorOpen(false)}
                  title="Collapse inspector"
                  className="flex items-center justify-center h-5 w-5 rounded text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel transition-colors duration-150"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">{inspector}</div>
            </div>
          </>
        )}
      </div>

      <div className="h-8 shrink-0 border-t border-pulse-border/60 bg-pulse-surface/80 px-3 flex items-center gap-3 text-[12px] font-mono text-pulse-muted overflow-x-auto">
        <span
          className={`px-1.5 py-0.5 rounded border text-[10px] leading-none shrink-0 ${sourceBadge.cls}`}
        >
          {sourceBadge.label}
        </span>
        <span className="tnum shrink-0">
          {stats.total} requests · {stats.nodes} nodes · {stats.edges} edges · {stats.errors} errors · {stats.thirdParty} 3P
        </span>
        <span className="tnum shrink-0 text-pulse-muted/70">
          {stats.shown}/{stats.total} shown
        </span>
        {stats.truncated && <span className="shrink-0 text-pulse-yellow">…truncated</span>}
        <span className="ml-auto shrink-0 text-pulse-muted/70">⌘⇧G / Esc</span>
      </div>
      </motion.div>
    </>
  );
}
