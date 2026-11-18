import { memo, useRef } from 'react';
import { RefreshCw, Plus, Copy, X, EyeOff } from 'lucide-react';
import ContextMenu from './ContextMenu';
import type { BrowserTab } from '../types';

export interface TabContextMenuState {
  position: { x: number; y: number };
  tab: BrowserTab;
}

export interface TabBarProps {
  tabs: BrowserTab[];
  activeTabId: string;
  dragOverTabId: string | null;
  hoveredTabId: string | null;
  showPreview: boolean;
  previewPos: { x: number; y: number };
  incognitoMode: boolean;
  tabContextMenu: TabContextMenuState | null;
  onSelectTab: (tab: BrowserTab) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseTabsToRight: (id: string) => void;
  onReloadTab: (id: string) => void;
  onDuplicateTab: (tab: BrowserTab) => void;
  onCopyText: (text: string) => void;
  onAddTab: () => void;
  onToggleIncognito: () => void;
  onDragStart: (e: React.DragEvent, tabId: string) => void;
  onDragOver: (e: React.DragEvent, tabId: string) => void;
  onDrop: (tabId: string) => void;
  onDragEnd: () => void;
  onHoverChange: (tabId: string | null, pos: { x: number; y: number }) => void;
  onPreviewVisibility: (show: boolean) => void;
  onContextMenu: (state: TabContextMenuState) => void;
  onCloseContextMenu: () => void;
}

function TabBar({
  tabs,
  activeTabId,
  dragOverTabId,
  hoveredTabId,
  showPreview,
  previewPos,
  incognitoMode,
  tabContextMenu,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onReloadTab,
  onDuplicateTab,
  onCopyText,
  onAddTab,
  onToggleIncognito,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onHoverChange,
  onPreviewVisibility,
  onContextMenu,
  onCloseContextMenu,
}: TabBarProps) {
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <>
      <div
        className={`tabbar-fade flex items-center h-8 border-b border-pulse-border/40 px-1 gap-0.5 overflow-x-auto ${tabs.some(t => t.session === 'private') ? 'bg-[#14141A]' : 'bg-pulse-bg'}`}
        onWheel={(e) => {
          e.currentTarget.scrollLeft += e.deltaY > 0 ? 40 : -40;
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const display =
            tab.page !== 'browser'
              ? tab.title
              : tab.title === 'New Tab'
              ? 'New Tab'
              : tab.displayUrl
                  .replace(/^https?:\/\//, '')
                  .split('/')[0];
          return (
            <div key={tab.id} className="relative">
            <button
              draggable
              onDragStart={(e) => onDragStart(e, tab.id)}
              onDragOver={(e) => onDragOver(e, tab.id)}
              onDrop={() => onDrop(tab.id)}
              onDragEnd={onDragEnd}
              onClick={() => onSelectTab(tab)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu({ position: { x: e.clientX, y: e.clientY }, tab });
              }}
              onMouseEnter={(e) => {
                if (tab.previewImage && !isActive) {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  onHoverChange(tab.id, { x: rect.left + rect.width / 2, y: rect.bottom });
                  hoverTimerRef.current = setTimeout(() => onPreviewVisibility(true), 400);
                }
              }}
              onMouseLeave={() => {
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                onHoverChange(null, { x: 0, y: 0 });
                onPreviewVisibility(false);
              }}
              className={`group animate-tab-in flex items-center gap-2 px-3 py-1 text-xs rounded-t max-w-[200px] min-w-[100px] transition-colors ${
                isActive
                  ? tab.session === 'private'
                    ? 'bg-[#14141A] text-pulse-cream border-t border-x border-pulse-accent/20 liquid-bar'
                    : 'bg-pulse-surface text-pulse-cream border-t border-x border-pulse-border/60 shadow-sm liquid-bar'
                  : 'text-pulse-muted/70 hover:text-pulse-muted hover:bg-pulse-surface/60'
              } ${dragOverTabId === tab.id ? 'border-l-2 border-l-pulse-accent' : ''}`}
            >
              {tab.session === 'private' && (
                <span className="flex-shrink-0 text-pulse-accent" title="Private tab"><EyeOff size={10} /></span>
              )}
              {tab.loading ? (
                <div className="w-3 h-3 rounded-full border-2 border-pulse-accent border-t-transparent animate-spin flex-shrink-0" />
              ) : tab.favicon ? (
                <img src={tab.favicon} className="w-3 h-3 flex-shrink-0" alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    isActive ? 'bg-pulse-accent' : 'bg-pulse-muted/40'
                  }`}
                />
              )}
              <span className="truncate flex-1 text-left">{display}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded text-pulse-muted hover:text-pulse-red hover:bg-pulse-red/10 transition-all flex-shrink-0"
              >
                <X size={10} />
              </button>
              {tab.loading && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-pulse-accent via-pulse-green to-pulse-accent animate-[loading_1.5s_ease-in-out_infinite]" style={{ width: '60%' }} />
                </div>
              )}
            </button>
            {hoveredTabId === tab.id && showPreview && tab.previewImage && (
              <div
                className="absolute z-[200] pointer-events-none"
                style={{
                  left: Math.max(10, Math.min(previewPos.x - 160, window.innerWidth - 330)),
                  top: previewPos.y + 4,
                }}
              >
                <div className="bg-pulse-surface border border-pulse-border rounded-xl shadow-2xl p-2">
                  <div className="text-[10px] font-mono text-pulse-muted truncate max-w-[300px] mb-1.5 px-1">
                    {tab.displayUrl}
                  </div>
                  <img
                    src={tab.previewImage}
                    alt=""
                    className="w-[300px] h-[188px] object-cover rounded-lg border border-pulse-border/50"
                    draggable={false}
                  />
                  <div className="flex items-center justify-between mt-1.5 px-1">
                    <span className="text-[9px] text-pulse-muted truncate max-w-[220px]">
                      {tab.title}
                    </span>
                    <span className="text-[9px] text-pulse-muted/60 flex-shrink-0">
                      #{tabs.indexOf(tab) + 1}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          );
        })}
        <button
          onClick={onToggleIncognito}
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors text-xs flex-shrink-0 ml-1 ${
            incognitoMode
              ? 'text-pulse-accent bg-pulse-accent/15 border border-pulse-accent/20'
              : 'text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel'
          }`}
          title={incognitoMode ? 'Exit private mode' : 'Open private tab'}
        >
          {incognitoMode ? <EyeOff size={14} /> : <Plus size={14} />}
        </button>
      </div>

      <ContextMenu
        items={tabContextMenu ? [
          { id: 'reload', label: 'Reload', icon: <RefreshCw size={14} />, shortcut: '⌘R', onClick: () => {
            if (tabContextMenu.tab.id === activeTabId) window.dispatchEvent(new CustomEvent('webview-reload'));
            onReloadTab(tabContextMenu.tab.id);
          }},
          { id: 'new-tab-after', label: 'New Tab to the Right', icon: <Plus size={14} />, onClick: () => onAddTab() },
          { id: 'duplicate', label: 'Duplicate Tab', icon: <Copy size={14} />, onClick: () => onDuplicateTab(tabContextMenu.tab) },
          { id: 'divider1', label: '', dividerAfter: true, icon: null },
          { id: 'copy-url', label: 'Copy URL', icon: <Copy size={14} />, shortcut: '⌘C', onClick: () => { onCopyText(tabContextMenu.tab.url); } },
          { id: 'copy-title', label: 'Copy Title', icon: <Copy size={14} />, onClick: () => { onCopyText(tabContextMenu.tab.title); } },
          { id: 'divider2', label: '', dividerAfter: true, icon: null },
          { id: 'close', label: 'Close Tab', icon: <X size={14} />, shortcut: '⌘W', danger: true, onClick: () => onCloseTab(tabContextMenu.tab.id) },
          { id: 'close-others', label: 'Close Other Tabs', icon: <X size={14} />, danger: true, onClick: () => onCloseOtherTabs(tabContextMenu.tab.id) },
          { id: 'close-right', label: 'Close Tabs to the Right', icon: <X size={14} />, danger: true, onClick: () => onCloseTabsToRight(tabContextMenu.tab.id) },
        ] : []}
        position={tabContextMenu?.position ?? null}
        onClose={onCloseContextMenu}
      />
    </>
  );
}

export default memo(TabBar);
