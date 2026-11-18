import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  Check,
  Download,
  Eye,
  LocateFixed,
  Pause,
  Play,
  RotateCw,
  Save,
  Search,
  Settings,
  Trash2,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { AUTO_CLUSTER_THRESHOLD, type ClusterMode } from '../../graph/types';
import { networkGraphStore, useNetworkGraphStore } from '../../graph/store';
import GraphFiltersBar from './GraphFiltersBar';

interface GraphToolbarProps {
  searchRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
}

const btn =
  'flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-pulse-border text-pulse-textMuted hover:text-pulse-text hover:bg-pulse-panel transition-colors duration-150 shrink-0';
const iconBtn =
  'flex items-center justify-center h-7 w-7 rounded-md border border-pulse-border text-pulse-textMuted hover:text-pulse-text hover:bg-pulse-panel transition-colors duration-150 shrink-0';

function nameOf(meta: unknown): string {
  const value = (meta as { name?: unknown } | null)?.name;
  return typeof value === 'string' && value ? value : 'Snapshot';
}

export default function GraphToolbar({ searchRef, onClose }: GraphToolbarProps) {
  const filters = useNetworkGraphStore((s) => s.filters);
  const isLive = useNetworkGraphStore((s) => s.isLive);
  const source = useNetworkGraphStore((s) => s.source);
  const hiddenCount = useNetworkGraphStore((s) => s.hiddenNodeIds.length);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<HTMLDivElement>(null);
  const loadBtnRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const focusSearch = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('netgraph-focus-search', focusSearch);
    return () => window.removeEventListener('netgraph-focus-search', focusSearch);
  }, [searchRef]);

  useEffect(() => {
    if (!settingsOpen && !loadOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (settingsOpen) {
        const insideBtn = settingsBtnRef.current?.contains(target);
        const insidePop = settingsRef.current?.contains(target);
        if (!insideBtn && !insidePop) setSettingsOpen(false);
      }
      if (loadOpen) {
        const insideBtn = loadBtnRef.current?.contains(target);
        const insidePop = loadRef.current?.contains(target);
        if (!insideBtn && !insidePop) setLoadOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setSettingsOpen(false);
      setLoadOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [settingsOpen, loadOpen]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const handleSave = () => {
    networkGraphStore.saveSnapshot();
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1600);
  };

  const handleImport = (file: File) => {
    void networkGraphStore.importSnapshotFile(file);
    setLoadOpen(false);
  };

  let snapshots: ReturnType<typeof networkGraphStore.listSnapshots> = [];
  if (loadOpen) {
    try {
      snapshots = networkGraphStore.listSnapshots().slice(0, 4);
    } catch {
      snapshots = [];
    }
  }

  let pill: { label: string; cls: string; dot: string };
  if (source === 'demo') {
    pill = {
      label: 'DEMO',
      cls: 'border-pulse-yellow/40 bg-pulse-yellow/10 text-pulse-yellow',
      dot: 'bg-pulse-yellow',
    };
  } else if (source === 'unavailable') {
    pill = {
      label: 'OFFLINE',
      cls: 'border-pulse-red/40 bg-pulse-red/10 text-pulse-red',
      dot: 'bg-pulse-red',
    };
  } else if (isLive) {
    pill = {
      label: 'LIVE',
      cls: 'border-pulse-green/40 bg-pulse-green/10 text-pulse-green',
      dot: 'bg-pulse-green animate-pulse',
    };
  } else {
    pill = {
      label: 'PAUSED',
      cls: 'border-pulse-border bg-pulse-panel text-pulse-muted',
      dot: 'bg-pulse-muted',
    };
  }

  return (
    <div className="relative h-11 shrink-0 border-b border-pulse-border/60 bg-pulse-surface/80 px-3 flex items-center gap-2">
      <span className="text-[13px] font-semibold text-pulse-text shrink-0">Network Graph</span>

      <button
        onClick={() => networkGraphStore.setLive(!isLive)}
        title={isLive ? 'Pause capture' : 'Resume capture'}
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono transition-colors duration-150 shrink-0 ${pill.cls}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} />
        {pill.label}
      </button>

      <button className={btn} onClick={() => networkGraphStore.setLive(!isLive)}>
        {isLive ? <Pause size={11} /> : <Play size={11} />}
        {isLive ? 'Pause' : 'Play'}
      </button>
      <button className={btn} onClick={() => networkGraphStore.clear()}>
        <Trash2 size={11} />
        Clear
      </button>
      <button className={btn} onClick={() => networkGraphStore.fitView()}>
        <LocateFixed size={11} />
        Fit
      </button>
      {hiddenCount > 0 && (
        <button className={btn} onClick={() => networkGraphStore.unhideAll()}>
          <Eye size={11} />
          Unhide ({hiddenCount})
        </button>
      )}
      <button className={btn} title="Reset graph (R)" onClick={() => networkGraphStore.resetView()}>
        <RotateCw size={11} />
        Reset
      </button>

      <div className="relative flex-1 min-w-[160px] max-w-[320px]">
        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-pulse-muted pointer-events-none" />
        <input
          ref={searchRef}
          type="text"
          value={filters.search}
          onChange={(e) => networkGraphStore.setFilters({ search: e.target.value })}
          placeholder="Search URL / domain / path"
          spellCheck={false}
          className="w-full h-7 bg-pulse-bg border border-pulse-border rounded-md pl-7 pr-2 text-[11px] font-mono text-pulse-text placeholder:text-pulse-muted/60 outline-none focus:border-pulse-accent/50 transition-colors duration-150"
        />
      </div>

      <select
        value={filters.clusterMode}
        onChange={(e) => networkGraphStore.setFilters({ clusterMode: e.target.value as ClusterMode })}
        title="Clustering"
        className="bg-pulse-bg border border-pulse-border rounded-md h-7 px-1.5 text-[11px] text-pulse-text outline-none focus:border-pulse-accent/50 transition-colors duration-150 cursor-pointer shrink-0"
      >
        <option value="auto">Auto</option>
        <option value="none">Off</option>
        <option value="domain">Domain</option>
        <option value="type">Type</option>
        <option value="thirdparty">Third-party</option>
      </select>

      <button
        className={btn}
        title="Layout direction"
        onClick={() => networkGraphStore.setFilters({ direction: filters.direction === 'TB' ? 'LR' : 'TB' })}
      >
        <Workflow size={11} />
        <span className="font-mono text-[10px]">{filters.direction}</span>
      </button>

      <div ref={settingsBtnRef}>
        <button
          className={iconBtn}
          title="Filters & settings"
          onClick={() => {
            setLoadOpen(false);
            setSettingsOpen((v) => !v);
          }}
        >
          <Settings size={12} />
        </button>
      </div>

      <button
        className={saved ? `${btn} text-pulse-green border-pulse-green/40` : iconBtn}
        title="Save snapshot"
        onClick={handleSave}
      >
        {saved ? (
          <>
            <Check size={11} />
            Saved
          </>
        ) : (
          <Save size={12} />
        )}
      </button>

      <div ref={loadBtnRef}>
        <button
          className={iconBtn}
          title="Load snapshot"
          onClick={() => {
            setSettingsOpen(false);
            setLoadOpen((v) => !v);
          }}
        >
          <Upload size={12} />
        </button>
      </div>

      <button className={iconBtn} title="Export snapshot" onClick={() => networkGraphStore.exportSnapshot()}>
        <Download size={12} />
      </button>
      <button className={iconBtn} title="Close (Esc)" onClick={onClose}>
        <X size={12} />
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImport(file);
          e.target.value = '';
        }}
      />

      {settingsOpen && (
        <div ref={settingsRef} className="absolute right-2 top-11 w-72 glass rounded-xl border border-pulse-border p-3 z-50 shadow-card">
          <GraphFiltersBar vertical />
          <div className="mt-3 pt-2 border-t border-pulse-border/40 flex items-center justify-between text-[10px]">
            <span className="text-pulse-muted">Auto-cluster threshold</span>
            <span className="font-mono text-pulse-textMuted tnum">{AUTO_CLUSTER_THRESHOLD} requests</span>
          </div>
        </div>
      )}

      {loadOpen && (
        <div ref={loadRef} className="absolute right-2 top-11 w-64 glass rounded-xl border border-pulse-border p-2 z-50 shadow-card">
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] rounded-md text-pulse-text hover:bg-pulse-panel transition-colors duration-150"
          >
            <Upload size={12} className="text-pulse-muted" />
            Import from file
          </button>
          <div className="h-px bg-pulse-border/40 my-1" />
          {snapshots.length === 0 ? (
            <div className="px-2 py-1 text-[10px] text-pulse-muted">No saved snapshots</div>
          ) : (
            snapshots.map((meta, index) => (
              <button
                key={index}
                onClick={() => {
                  networkGraphStore.loadSnapshot(meta);
                  setLoadOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] rounded-md text-pulse-textMuted hover:text-pulse-text hover:bg-pulse-panel transition-colors duration-150 text-left"
              >
                <span className="flex-1 min-w-0 font-mono truncate">{nameOf(meta)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
