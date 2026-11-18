import { useState, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, FolderOpen, Globe, ExternalLink, Copy, Edit3, Trash2 } from 'lucide-react';
import ContextMenu, { copyToClipboard } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import type { BookmarkItem } from '../types';

interface BookmarksBarProps {
  bookmarks: BookmarkItem[];
  onAdd: (title: string, url: string) => void;
  onRemove: (id: string) => void;
  onNavigate: (url: string) => void;
  onNewTab?: (url: string) => void;
  currentUrl: string;
}

function getFaviconUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=16`;
  } catch {
    return '';
  }
}

function getDomainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const BookmarksBar = memo(function BookmarksBar({
  bookmarks,
  onAdd,
  onRemove,
  onNavigate,
  onNewTab,
  currentUrl,
}: BookmarksBarProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    bookmark: BookmarkItem;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, bm: BookmarkItem) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ position: { x: e.clientX, y: e.clientY }, bookmark: bm });
    },
    [],
  );

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const bm = contextMenu.bookmark;
    return [
      {
        id: 'open',
        label: 'Open in current tab',
        icon: <Globe size={14} />,
        onClick: () => onNavigate(bm.url),
      },
      {
        id: 'open-new',
        label: 'Open in new tab',
        icon: <ExternalLink size={14} />,
        shortcut: '⌘Click',
        onClick: () => onNewTab?.(bm.url),
      },
      { id: 'divider1', label: '', dividerAfter: true, icon: null },
      {
        id: 'copy-url',
        label: 'Copy URL',
        icon: <Copy size={14} />,
        shortcut: '⌘C',
        onClick: () => copyToClipboard(bm.url),
      },
      {
        id: 'copy-name',
        label: 'Copy name',
        icon: <Copy size={14} />,
        onClick: () => copyToClipboard(bm.title),
      },
      { id: 'divider2', label: '', dividerAfter: true, icon: null },
      {
        id: 'remove',
        label: 'Remove bookmark',
        icon: <Trash2 size={14} />,
        danger: true,
        shortcut: 'Del',
        onClick: () => onRemove(bm.id),
      },
    ];
  }, [contextMenu, onNavigate, onNewTab, onRemove]);

  const handleAdd = () => {
    if (newTitle.trim() && newUrl.trim()) {
      let url = newUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }
      onAdd(newTitle.trim(), url);
      setNewTitle('');
      setNewUrl('');
      setShowAddDialog(false);
    }
  };

  return (
    <div className="relative flex items-center h-8 px-3 bg-pulse-bgSoft/80 backdrop-blur-sm border-b border-pulse-border/40 gap-1 overflow-x-auto group liquid-bar">
      {/* Folder icon */}
      <button
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-pulse-muted hover:text-pulse-accentSoft hover:bg-pulse-panel/70 transition-colors"
        title="Bookmark manager"
      >
        <FolderOpen size={14} />
      </button>

      {/* Separator */}
      <div className="w-px h-4 bg-pulse-border/40 flex-shrink-0 mx-0.5" />

      {/* Bookmarks */}
      <AnimatePresence initial={false}>
        {bookmarks.map((bm) => (
          <motion.button
            key={bm.id}
            initial={{ opacity: 0, scale: 0.8, width: 0 }}
            animate={{ opacity: 1, scale: 1, width: 'auto' }}
            exit={{ opacity: 0, scale: 0.8, width: 0 }}
            transition={{ duration: 0.15 }}
            className="relative flex-shrink-0 group/bm"
            onMouseEnter={() => setHoveredId(bm.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <button
              onClick={() => onNavigate(bm.url)}
              onContextMenu={(e) => handleContextMenu(e, bm)}
              className="flex items-center gap-2 px-2.5 h-6 rounded-full border border-transparent text-xs text-pulse-textMuted hover:text-pulse-text hover:border-pulse-border/40 hover:bg-pulse-panel/60 active:scale-95 transition-all"
              title={`${bm.title}\n${bm.url}`}
            >
              {bm.favicon ? (
                <img
                  src={bm.favicon}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-3 h-3 flex-shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <Globe size={12} className="flex-shrink-0 text-pulse-muted" />
              )}
              <span className="truncate max-w-[120px]">
                {bm.title || getDomainLabel(bm.url)}
              </span>
            </button>

            {/* Remove button */}
            {hoveredId === bm.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(bm.id);
                }}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-pulse-surface/90 backdrop-blur-sm border border-pulse-border/60 text-pulse-muted/70 flex items-center justify-center hover:text-pulse-red hover:border-pulse-red/30 hover:bg-pulse-red/10 transition-colors shadow-soft z-10"
              >
                <X size={8} />
              </button>
            )}
          </motion.button>
        ))}
      </AnimatePresence>

      {/* Add bookmark button */}
      <button
        onClick={() => {
          setNewTitle('');
          setNewUrl(currentUrl || '');
          setShowAddDialog(!showAddDialog);
        }}
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-pulse-muted hover:text-pulse-accentSoft hover:bg-pulse-panel/70 transition-colors"
        title="Add bookmark"
      >
        <Plus size={14} />
      </button>

      {/* ── Context Menu ──────────────────────────────── */}
      <ContextMenu
        items={getContextMenuItems()}
        position={contextMenu?.position ?? null}
        onClose={() => setContextMenu(null)}
      />

      {/* Add Bookmark Dialog */}
      <AnimatePresence>
        {showAddDialog && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full left-3 mt-1 w-72 glass rounded-xl shadow-card z-50 p-3 rise-in"
          >
            <div className="text-[11px] font-semibold text-pulse-muted mb-2 uppercase tracking-widest">
              Add Bookmark
            </div>
            <div className="space-y-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Title"
                className="w-full px-3 py-1.5 bg-pulse-bg/70 border border-pulse-border/60 rounded-lg text-xs font-mono text-pulse-text placeholder-pulse-muted/50 focus:border-pulse-accent/40 outline-none"
                autoFocus
              />
              <input
                type="text"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="URL"
                className="w-full px-3 py-1.5 bg-pulse-bg/70 border border-pulse-border/60 rounded-lg text-xs font-mono text-pulse-text placeholder-pulse-muted/50 focus:border-pulse-accent/40 outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddDialog(false)}
                  className="flex-1 py-1.5 text-xs text-pulse-muted hover:text-pulse-text border border-pulse-border/60 rounded-lg hover:bg-pulse-panel/60 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  className="flex-1 py-1.5 text-xs font-semibold bg-pulse-accent/90 text-[#0A0A0C] rounded-lg hover:bg-pulse-accentSoft transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default BookmarksBar;
