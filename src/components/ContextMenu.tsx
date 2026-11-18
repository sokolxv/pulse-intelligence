import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ExternalLink,
  Copy,
  Trash2,
  Edit3,
  Bookmark,
  RotateCw,
  Globe,
  Lock,
  Eye,
  Download,
} from 'lucide-react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  dividerAfter?: boolean;
  onClick?: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export default function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null);

  // Adjust position to keep menu within viewport
  // First render is hidden at the requested position (never 0,0);
  // after measuring we show it at the adjusted position.
  useEffect(() => {
    if (!position) {
      setAdjustedPos(null);
      return;
    }
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    let x = position.x;
    let y = position.y;
    if (x + rect.width > viewW) x = viewW - rect.width - 8;
    if (y + rect.height > viewH) y = viewH - rect.height - 8;
    if (x < 0) x = 8;
    if (y < 0) y = 8;
    setAdjustedPos({ x, y });
  }, [position]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!position) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Delay to avoid the same click that opened the menu from closing it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
      window.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [position, onClose]);

  if (!position) return null;
  const visiblePos = adjustedPos ?? position;

  return (
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.95, y: -4 }}
        animate={{ opacity: adjustedPos ? 1 : 0, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -4 }}
        transition={{ duration: 0.1 }}
        className="fixed z-[100] min-w-[220px] glass rounded-xl shadow-card py-1.5 px-1.5 overflow-hidden rise-in"
        style={{ left: visiblePos.x, top: visiblePos.y, visibility: adjustedPos ? 'visible' : 'hidden' }}
      >
        {items.map((item) => {
          if (!item.label || !item.label.trim()) {
            return <div key={item.id} className="my-1 mx-3 h-px bg-pulse-border/40" />;
          }
          return (
          <div key={item.id}>
            <button
              onClick={() => {
                if (!item.disabled) {
                  item.onClick?.();
                  onClose();
                }
              }}
              disabled={item.disabled}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] rounded-lg transition-colors text-left ${
                item.disabled
                  ? 'text-pulse-muted/40 cursor-not-allowed'
                  : item.danger
                  ? 'text-pulse-red/90 hover:bg-pulse-red/10'
                  : 'text-pulse-text/90 hover:bg-pulse-panel/70 hover:text-pulse-text'
              }`}
            >
              <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-70">
                {item.icon}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut && (
                <kbd className="text-[10px] text-pulse-muted/60 font-mono tnum">{item.shortcut}</kbd>
              )}
            </button>
            {item.dividerAfter && (
              <div className="my-1 mx-3 h-px bg-pulse-border/40" />
            )}
          </div>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}

// ── Copy to clipboard helper ─────────────────────────────
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}
