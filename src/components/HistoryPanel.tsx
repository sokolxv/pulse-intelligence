import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Clock,
  Search,
  Trash2,
  Globe,
  ExternalLink,
  Calendar,
  X,
  Copy,
} from 'lucide-react';
import ContextMenu, { copyToClipboard } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import type { HistoryEntry } from '../types';

interface HistoryPanelProps {
  history: HistoryEntry[];
  onNavigate: (url: string) => void;
  onNewTab?: (url: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateGroup(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const entryDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (entryDate.getTime() === today.getTime()) return 'Today';
  if (entryDate.getTime() === yesterday.getTime()) return 'Yesterday';

  const daysDiff = Math.floor((today.getTime() - entryDate.getTime()) / 86400000);
  if (daysDiff < 7) return 'This week';

  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getFaviconUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=16`;
  } catch {
    return '';
  }
}

export default function HistoryPanel({
  history,
  onNavigate,
  onNewTab,
  onRemove,
  onClear,
  onClose,
}: HistoryPanelProps) {
  const [query, setQuery] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    entry: HistoryEntry;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: HistoryEntry) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ position: { x: e.clientX, y: e.clientY }, entry });
    },
    [],
  );

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const entry = contextMenu.entry;
    return [
      {
        id: 'open',
        label: 'Open in current tab',
        icon: <Globe size={14} />,
        onClick: () => {
          onNavigate(entry.url);
          onClose();
        },
      },
      {
        id: 'open-new',
        label: 'Open in new tab',
        icon: <ExternalLink size={14} />,
        onClick: () => onNewTab?.(entry.url),
      },
      { id: 'divider1', label: '', dividerAfter: true, icon: null },
      {
        id: 'copy-url',
        label: 'Copy URL',
        icon: <Copy size={14} />,
        shortcut: '⌘C',
        onClick: () => copyToClipboard(entry.url),
      },
      {
        id: 'copy-title',
        label: 'Copy title',
        icon: <Copy size={14} />,
        onClick: () => copyToClipboard(entry.title),
      },
      { id: 'divider2', label: '', dividerAfter: true, icon: null },
      {
        id: 'remove',
        label: 'Remove from history',
        icon: <Trash2 size={14} />,
        danger: true,
        shortcut: 'Del',
        onClick: () => onRemove(entry.id),
      },
    ];
  }, [contextMenu, onNavigate, onNewTab, onRemove, onClose]);

  // Filter and group by date
  const groupedHistory = useMemo(() => {
    const filtered = history.filter((entry) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.url.toLowerCase().includes(q)
      );
    });

    // Group by date
    const groups: { label: string; entries: HistoryEntry[] }[] = [];
    let currentGroup: { label: string; entries: HistoryEntry[] } | null = null;

    for (const entry of filtered) {
      const label = formatDateGroup(entry.timestamp);
      if (!currentGroup || currentGroup.label !== label) {
        currentGroup = { label, entries: [] };
        groups.push(currentGroup);
      }
      currentGroup.entries.push(entry);
    }

    return groups;
  }, [history, query]);

  const totalCount = history.length;
  const filteredCount = groupedHistory.reduce((sum, g) => sum + g.entries.length, 0);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-[700px] max-w-[92vw] max-h-[80vh] glass rounded-2xl shadow-card flex flex-col overflow-hidden rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-pulse-border/60">
          <div className="flex items-center gap-2.5">
            <Clock size={18} className="text-pulse-accentDim" />
            <span className="text-sm font-semibold tracking-wide">History</span>
            <span className="text-[10px] font-mono tnum text-pulse-muted bg-pulse-panel border border-pulse-border/50 px-2 py-0.5 rounded-full">
              {totalCount} pages
            </span>
          </div>
          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <button
                onClick={onClear}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-pulse-muted hover:text-pulse-red hover:bg-pulse-red/10 rounded-lg transition-colors"
              >
                <Trash2 size={11} />
                Clear all
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel/70 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-pulse-border/40">
          <div className="flex items-center gap-2 px-3 py-2 bg-pulse-bg/60 border border-pulse-border/60 rounded-xl focus-within:border-pulse-accent/40 transition-colors">
            <Search size={14} className="text-pulse-muted/60 flex-shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search history by title or URL..."
              className="flex-1 bg-transparent text-sm font-mono text-pulse-text placeholder-pulse-muted/50 outline-none"
              autoFocus
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="w-5 h-5 flex items-center justify-center rounded-md text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel/70 transition-colors"
              >
                <X size={12} />
              </button>
            )}
            <span className="text-[10px] text-pulse-muted/70 font-mono tnum">
              {filteredCount}/{totalCount}
            </span>
          </div>
        </div>

        {/* History list */}
        <div className="flex-1 overflow-auto">
          {groupedHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-pulse-muted">
              <Clock size={32} className="mb-3 opacity-30" />
              <div className="text-sm">
                {query ? 'No matching history' : 'No history yet'}
              </div>
              <div className="text-xs mt-1 opacity-60">
                {query ? 'Try a different search' : 'Start browsing to build history'}
              </div>
            </div>
          ) : (
            <div className="py-2">
              {groupedHistory.map((group) => (
                <div key={group.label}>
                  {/* Date group header */}
                  <div className="flex items-center gap-2 mx-2 px-3 py-2 sticky top-0 bg-pulse-surface/80 backdrop-blur-md z-10 rounded-lg">
                    <Calendar size={12} className="text-pulse-muted/60" />
                    <span className="text-[11px] font-semibold text-pulse-muted uppercase tracking-widest">
                      {group.label}
                    </span>
                    <div className="flex-1 h-px bg-pulse-border/40" />
                    <span className="text-[10px] text-pulse-muted/60 font-mono tnum">
                      {group.entries.length}
                    </span>
                  </div>

                  {/* Entries */}
                  {group.entries.map((entry) => {
                    const domain = (() => {
                      try { return new URL(entry.url).hostname; } catch { return ''; }
                    })();
                    return (
                      <div
                        key={entry.id}
                        className="cv-item flex items-center gap-3 mx-2 px-3 py-2 rounded-lg hover:bg-pulse-panel/60 transition-colors group cursor-pointer"
                        onMouseEnter={() => setHoveredId(entry.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onContextMenu={(e) => handleContextMenu(e, entry)}
                        onClick={() => {
                          onNavigate(entry.url);
                          onClose();
                        }}
                      >
                        {/* Favicon */}
                        {entry.favicon ? (
                          <img src={entry.favicon} alt="" loading="lazy" decoding="async" className="w-4 h-4 flex-shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                        ) : (
                          <Globe size={14} className="flex-shrink-0 text-pulse-muted/40" />
                        )}

                        {/* Title + URL */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-pulse-text truncate">{entry.title || entry.url}</div>
                          <div className="text-[11px] text-pulse-muted/70 truncate font-mono">
                            {entry.url}
                          </div>
                        </div>

                        {/* Domain badge */}
                        {domain && (
                          <span className="text-[10px] font-mono tnum text-pulse-muted bg-pulse-panel border border-pulse-border/40 px-2 py-0.5 rounded-full flex-shrink-0 hidden sm:inline">
                            {domain}
                          </span>
                        )}

                        {/* Time */}
                        <span className="text-[10px] text-pulse-muted/60 font-mono tnum flex-shrink-0 w-16 text-right">
                          {formatRelativeTime(entry.timestamp)}
                        </span>

                        {/* Actions (on hover) */}
                        {hoveredId === entry.id && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemove(entry.id);
                              }}
                              className="w-5 h-5 flex items-center justify-center rounded-md text-pulse-muted/70 hover:text-pulse-red hover:bg-pulse-red/10 transition-colors"
                              title="Remove"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Context Menu ──────────────────────────────── */}
      <ContextMenu
        items={getContextMenuItems()}
        position={contextMenu?.position ?? null}
        onClose={() => setContextMenu(null)}
      />
    </motion.div>
  );
}
