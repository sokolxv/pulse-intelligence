import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Zap, Globe, Shield, Lock, ExternalLink, Copy, RotateCw, ChevronRight, Download, AlertTriangle, Search } from 'lucide-react';
import ContextMenu, { copyToClipboard } from '../components/ContextMenu';
import FindBar from '../components/FindBar';
import type { ContextMenuItem } from '../components/ContextMenu';
import type { BrowserTab, CredentialEntry } from '../types';
import pulseMarkUrl from '../assets/pulse-mark.svg';
import { loadSettings, type PulseSettings } from '../lib/settings-store';
import { bindWebview, unbindWebview } from '../network/NetworkCollector';

type NewtabSettings = PulseSettings['newtab'];

const MAX_LIVE_WEBVIEWS = 4;

interface BrowserPageProps {
  tabs: BrowserTab[];
  activeTabId: string;
  onUpdateTab: (id: string, patch: Partial<BrowserTab>) => void;
  onAddDownload: (url: string, filename: string) => string;
  onUpdateDownload: (id: string, patch: Partial<import('../types').DownloadItem>) => void;
  onAddHistory: (title: string, url: string, favicon: string | null) => void;
  credentials: CredentialEntry[];
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function matchCredential(url: string, credentials: CredentialEntry[]): { username: string; password: string; host: string } | null {
  const pageHost = hostOf(url);
  if (!pageHost) return null;
  for (const c of credentials) {
    let storedHost = '';
    try { storedHost = new URL(c.siteUrl).hostname.toLowerCase(); } catch { storedHost = (c.site || '').toLowerCase(); }
    if (!storedHost) continue;
    if (pageHost === storedHost || pageHost.endsWith('.' + storedHost)) {
      if (c.password) return { username: c.username || '', password: c.password, host: pageHost };
    }
  }
  return null;
}

function genFallbackUA() {
  const versions = ['120.0.0.0','121.0.0.0','122.0.0.0','123.0.0.0','124.0.0.0','125.0.0.0','126.0.0.0'];
  const plats = [
    (v: string) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`,
    (v: string) => `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`,
    (v: string) => `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`,
    (v: string) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36 Edg/${v}`,
  ];
  const v = versions[Math.floor(Math.random() * versions.length)];
  const fn = plats[Math.floor(Math.random() * plats.length)];
  return fn(v);
}

export default function BrowserPage({ tabs, activeTabId, onUpdateTab, onAddDownload, onUpdateDownload, onAddHistory, credentials }: BrowserPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewRefs = useRef<Map<string, any>>(new Map());
  const [userAgent] = useState(() => genFallbackUA());
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    linkUrl?: string;
    linkText?: string;
    selectionText?: string;
  } | null>(null);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findMatchCount, setFindMatchCount] = useState(0);
  const [findCurrentMatch, setFindCurrentMatch] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isNewTab = activeTab?.url === 'pulse://newtab';

  const tabIdsKey = tabs.map((t) => t.id).join(',');
  const [recentOrder, setRecentOrder] = useState<string[]>(() => {
    const init = tabs.map((t) => t.id);
    return [activeTabId, ...init.filter((id) => id !== activeTabId)];
  });

  useEffect(() => {
    setRecentOrder((prev) => {
      const currentIds = new Set(tabIdsKey.split(',').filter(Boolean));
      let next = prev.filter((id) => currentIds.has(id));
      next = [activeTabId, ...next.filter((id) => id !== activeTabId)];
      const missing = tabIdsKey.split(',').filter(Boolean).filter((id) => !next.includes(id));
      if (missing.length) next.splice(1, 0, ...missing);
      const deduped = [...new Set(next)];
      if (deduped.length === prev.length && deduped.every((v, i) => v === prev[i])) return prev;
      return deduped;
    });
  }, [activeTabId, tabIdsKey]);

  const liveIds = useMemo(() => {
    const nonNewTabIds = tabs.filter((t) => t.url !== 'pulse://newtab').map((t) => t.id);
    if (nonNewTabIds.length <= MAX_LIVE_WEBVIEWS) return new Set(tabs.map((t) => t.id));
    const orderedLive = recentOrder
      .filter((id) => {
        const tab = tabs.find((t) => t.id === id);
        return !!tab && tab.url !== 'pulse://newtab';
      })
      .slice(0, MAX_LIVE_WEBVIEWS);
    const activeIsWebview = tabs.find((t) => t.id === activeTabId)?.url !== 'pulse://newtab';
    if (activeIsWebview && !orderedLive.includes(activeTabId)) {
      orderedLive.pop();
      orderedLive.unshift(activeTabId);
    }
    const set = new Set(orderedLive);
    tabs.forEach((t) => { if (t.url === 'pulse://newtab') set.add(t.id); });
    return set;
  }, [recentOrder, tabs, activeTabId]);

  // Fetch real UA from main process and override fallback
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (api?.getUserAgent) {
      api.getUserAgent().then((ua: string) => {
        if (ua && ua !== userAgent) {
          // update all existing webviews
          webviewRefs.current.forEach((wv) => {
            try { wv.setUserAgent?.(ua); } catch {}
            try { wv.setAttribute?.('useragent', ua); } catch {}
          });
          // we keep userAgent state as fallback, but main process already set session UA,
          // child webviews will use session UA for future loads
        }
      }).catch(()=>{});
    }
  }, [userAgent]);

  const handleFind = useCallback((query: string, options: { caseSensitive: boolean; forward: boolean }) => {
    const wv = webviewRefs.current.get(activeTabId) as any;
    if (!wv || !query) return;
    try {
      wv.findInPage(query, { forward: options.forward, matchCase: options.caseSensitive });
    } catch {}
  }, [activeTabId]);

  useEffect(() => {
    const wv = webviewRefs.current.get(activeTabId) as any;
    if (!wv) return;
    const handleFoundInPage = (e: any) => {
      const r = e?.result;
      if (!r) return;
      if (typeof r.matches === 'number') setFindMatchCount(r.matches);
      if (typeof r.activeMatchOrdinal === 'number') setFindCurrentMatch(r.activeMatchOrdinal);
    };
    wv.addEventListener('found-in-page', handleFoundInPage);
    return () => {
      wv.removeEventListener('found-in-page', handleFoundInPage);
    };
  }, [activeTabId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        setFindBarOpen((prev) => !prev);
      }
    };
    // toggled from webview-forwarded shortcuts (focus inside guest page)
    const external = () => setFindBarOpen((prev) => !prev);
    window.addEventListener('keydown', handler);
    window.addEventListener('pulse-toggle-find', external);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('pulse-toggle-find', external);
    };
  }, []);

  // Global navigation events from TitleBar
  useEffect(() => {
    const handleReload = () => {
      const wv = webviewRefs.current.get(activeTabId) as any;
      if (!wv) return;
      setErrors((prev) => { const n={...prev}; delete n[activeTabId]; return n; });
      try { wv.reload(); } catch {}
    };
    const handleGoBack = () => {
      const wv = webviewRefs.current.get(activeTabId) as any;
      try { if (wv?.canGoBack()) wv.goBack(); } catch {}
    };
    const handleGoForward = () => {
      const wv = webviewRefs.current.get(activeTabId) as any;
      try { if (wv?.canGoForward()) wv.goForward(); } catch {}
    };
    const handleToggleDevTools = () => {
      const wv = webviewRefs.current.get(activeTabId) as any;
      try {
        if (wv?.isDevToolsOpened()) wv.closeDevTools();
        else wv.openDevTools();
      } catch {}
    };
    window.addEventListener('webview-reload', handleReload);
    window.addEventListener('webview-go-back', handleGoBack);
    window.addEventListener('webview-go-forward', handleGoForward);
    window.addEventListener('webview-toggle-devtools', handleToggleDevTools);
    return () => {
      window.removeEventListener('webview-reload', handleReload);
      window.removeEventListener('webview-go-back', handleGoBack);
      window.removeEventListener('webview-go-forward', handleGoForward);
      window.removeEventListener('webview-toggle-devtools', handleToggleDevTools);
    };
  }, [activeTabId]);

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const items: ContextMenuItem[] = [];
    if (contextMenu.linkUrl) {
      items.push(
        { id: 'open-link', label: 'Open link in new tab', icon: <ExternalLink size={14} />, onClick: () => { window.dispatchEvent(new CustomEvent('newtab-navigate', { detail: { url: contextMenu.linkUrl } })); } },
        { id: 'copy-link', label: 'Copy link address', icon: <Copy size={14} />, shortcut: '⌘C', onClick: () => copyToClipboard(contextMenu.linkUrl!) },
        { id: 'copy-link-text', label: 'Copy link text', icon: <Copy size={14} />, onClick: () => copyToClipboard(contextMenu.linkText || contextMenu.linkUrl!) },
        { id: 'download-link', label: 'Save link as…', icon: <Download size={14} />, onClick: () => { const wv = webviewRefs.current.get(activeTabId) as any; if (wv) wv.downloadURL(contextMenu.linkUrl!); } },
        { id: 'divider1', label: '', dividerAfter: true, icon: null },
      );
    }
    if (contextMenu.selectionText) {
      items.push({ id: 'copy-selection', label: 'Copy', icon: <Copy size={14} />, shortcut: '⌘C', onClick: () => copyToClipboard(contextMenu.selectionText!) });
    }
    items.push(
      { id: 'reload', label: 'Reload', icon: <RotateCw size={14} />, shortcut: '⌘R', onClick: () => { const wv = webviewRefs.current.get(activeTabId) as any; wv?.reload(); } },
      { id: 'go-back', label: 'Back', icon: <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />, disabled: !(webviewRefs.current.get(activeTabId) as any)?.canGoBack?.(), onClick: () => (webviewRefs.current.get(activeTabId) as any)?.goBack() },
      { id: 'go-forward', label: 'Forward', icon: <ChevronRight size={14} />, disabled: !(webviewRefs.current.get(activeTabId) as any)?.canGoForward?.(), onClick: () => (webviewRefs.current.get(activeTabId) as any)?.goForward() },
    );
    return items;
  }, [contextMenu, activeTabId]);

  const activeError = activeTab ? errors[activeTab.id] : null;

  const handleRetry = useCallback(() => {
    if (!activeTab) return;
    setErrors((prev) => { const n={...prev}; delete n[activeTab.id]; return n; });
    const wv = webviewRefs.current.get(activeTab.id) as any;
    if (wv && activeTab.url !== 'pulse://newtab') {
      try { wv.loadURL(activeTab.url); } catch { try { wv.reload(); } catch {} }
    }
  }, [activeTab]);

  return (
    <div ref={containerRef} className="relative h-full w-full bg-white overflow-hidden">
      {findBarOpen && !isNewTab && (
        <FindBar
          onClose={() => {
            setFindBarOpen(false);
            (webviewRefs.current.get(activeTabId) as any)?.stopFindInPage('clearSelection');
          }}
          onFind={handleFind}
          matchCount={findMatchCount}
          currentMatch={findCurrentMatch}
        />
      )}
      {isNewTab && (
        <div className="absolute inset-0 z-10 bg-pulse-bg animate-page-in">
          <NewTabPage />
        </div>
      )}
      {tabs.map((tab) => {
        if (tab.url === 'pulse://newtab') return null;
        const isActive = tab.id === activeTabId && !isNewTab;
        const isLive = liveIds.has(tab.id);
        if (!isLive) {
          return (
            <SuspendedTab
              key={tab.id}
              tab={tab}
              isActive={isActive}
              onRestore={() => setRecentOrder((prev) => [tab.id, ...prev.filter((id) => id !== tab.id)])}
            />
          );
        }
        return (
          <TabWebView
            key={tab.id}
            tab={tab}
            isActive={isActive}
            userAgent={userAgent}
            autofillCred={tab.session === 'private' ? null : matchCredential(tab.url, credentials)}
            onUpdateTab={onUpdateTab}
            onAddDownload={onAddDownload}
            onUpdateDownload={onUpdateDownload}
            onAddHistory={onAddHistory}
            onContextMenu={setContextMenu}
            onError={(id, msg) => setErrors((prev)=> ({...prev, [id]: msg}))}
            onClearError={(id) => setErrors((prev)=> { const n={...prev}; delete n[id]; return n; })}
            registerRef={(id, el) => {
              if (el) webviewRefs.current.set(id, el);
              else webviewRefs.current.delete(id);
            }}
          />
        );
      })}

      {activeError && !isNewTab && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-pulse-bg z-20">
          <div className="w-20 h-20 rounded-2xl bg-pulse-yellow/10 border border-pulse-yellow/20 flex items-center justify-center mb-6">
            <AlertTriangle size={36} className="text-pulse-yellow" />
          </div>
          <h2 className="text-lg font-semibold text-pulse-text mb-2">{activeError.includes('crashed') ? 'Page Crashed' : 'Failed to Load Page'}</h2>
          <div className="text-sm text-pulse-muted font-mono mb-2 max-w-lg text-center break-all">{activeError}</div>
          <div className="flex items-center gap-2 px-4 py-2 bg-pulse-surface border border-pulse-border rounded-lg mb-6">
            <span className="text-[10px] text-pulse-muted uppercase tracking-wider">URL</span>
            <span className="text-xs text-pulse-text font-mono truncate max-w-md">{activeTab?.url}</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleRetry} className="flex items-center gap-2 px-5 py-2.5 bg-pulse-accent text-pulse-bg rounded-lg text-sm font-semibold hover:bg-pulse-accent/90 transition-colors">
              <RotateCw size={14} /> Retry
            </button>
            <button onClick={() => window.dispatchEvent(new CustomEvent('newtab-navigate', { detail: { url: 'pulse://newtab' } }))} className="flex items-center gap-2 px-5 py-2.5 bg-pulse-surface border border-pulse-border text-pulse-text rounded-lg text-sm font-medium hover:bg-pulse-panel transition-colors">
              Home
            </button>
          </div>
        </div>
      )}

      <ContextMenu items={getContextMenuItems()} position={contextMenu?.position ?? null} onClose={() => setContextMenu(null)} />
    </div>
  );
}

function TabWebView({ tab, isActive, userAgent, autofillCred, onUpdateTab, onAddDownload, onUpdateDownload, onAddHistory, onContextMenu, onError, onClearError, registerRef }: {
  tab: BrowserTab;
  isActive: boolean;
  userAgent: string;
  autofillCred: { username: string; password: string; host: string } | null;
  onUpdateTab: (id: string, patch: Partial<BrowserTab>) => void;
  onAddDownload: (url: string, filename: string) => string;
  onUpdateDownload: (id: string, patch: Partial<import('../types').DownloadItem>) => void;
  onAddHistory: (title: string, url: string, favicon: string | null) => void;
  onContextMenu: (v: { position: { x: number; y: number }; linkUrl?: string; linkText?: string; selectionText?: string } | null) => void;
  onError: (id: string, msg: string) => void;
  onClearError: (id: string) => void;
  registerRef: (id: string, el: any) => void;
}) {
  const ref = useRef<any>(null);
  const titleRef = useRef(tab.title);
  const faviconRef = useRef<string | null>(tab.favicon);
  const lastCaptureRef = useRef<number>(0);

  useEffect(() => {
    titleRef.current = tab.title;
  }, [tab.title]);
  useEffect(() => { faviconRef.current = tab.favicon; }, [tab.favicon]);

  // register for parent global actions
  useEffect(() => {
    const el = ref.current;
    if (el) registerRef(tab.id, el);
    return () => registerRef(tab.id, null as any);
  }, [tab.id, registerRef]);

  // Network Graph capture: bind the guest webContents to the tab id.
  // In dev (no Electron guest) wcId stays null and the bus falls back to demo data.
  useEffect(() => {
    const wv = ref.current as any;
    if (!wv) return;
    let wcId: number | null = null;
    let cancelled = false;
    const doBind = () => {
      if (cancelled) return;
      try {
        const id = wv.getWebContentsId?.();
        if (typeof id === 'number') wcId = id;
      } catch {}
      bindWebview(tab.id, wcId).catch(() => {});
    };
    try { wv.addEventListener('did-attach', doBind); } catch {}
    try { wv.addEventListener('dom-ready', doBind); } catch {}
    return () => {
      cancelled = true;
      try { wv.removeEventListener('did-attach', doBind); } catch {}
      try { wv.removeEventListener('dom-ready', doBind); } catch {}
      unbindWebview(tab.id, wcId);
    };
  }, [tab.id]);

  // Keep src in sync if tab.url changes externally (address bar)
  useEffect(() => {
    const wv = ref.current as any;
    if (!wv) return;
    try {
      const cur = wv.getURL?.() || wv.src || '';
      if (cur && cur !== tab.url && tab.url !== 'pulse://newtab' && !cur.startsWith('about:')) {
        // only load if different and not initial about:blank
        if (cur !== tab.url) {
          // src prop already handles, but as fallback use loadURL
          // Avoid reload loop: only if tab.url was changed externally
        }
      }
    } catch {}
  }, [tab.url]);

  useEffect(() => {
    const wv = ref.current as any;
    if (!wv) return;

    const handleDomReady = () => {
      onClearError(tab.id);
      try { if (userAgent && wv.setUserAgent) wv.setUserAgent(userAgent); } catch {}
    };
    wv.addEventListener('dom-ready', handleDomReady);

    const handleDidStartLoading = () => {
      onClearError(tab.id);
      onUpdateTab(tab.id, { loading: true });
    };
    const handleDidStopLoading = () => {
      onUpdateTab(tab.id, { loading: false });
      const now = Date.now();
      if (now - lastCaptureRef.current < 5000) return;
      lastCaptureRef.current = now;
      try {
        wv.capturePage({ x: 0, y: 0, width: 320, height: 200 }).then((image: any) => {
          const dataUrl = image.toDataURL();
          if (dataUrl && dataUrl !== 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==') {
            onUpdateTab(tab.id, { previewImage: dataUrl });
          }
        }).catch(()=>{});
      } catch {}
    };
    const handleDidNavigate = (e: any) => {
      if (!e.url || e.url === 'about:blank') return;
      onUpdateTab(tab.id, { url: e.url, displayUrl: e.url, canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward() });
    };
    const handlePageTitleUpdated = (e: any) => {
      if (e.title) {
        titleRef.current = e.title;
        onUpdateTab(tab.id, { title: e.title });
      }
    };
    const handlePageFaviconUpdated = (e: any) => {
      if (e.favicons && e.favicons.length > 0) {
        faviconRef.current = e.favicons[0];
        onUpdateTab(tab.id, { favicon: e.favicons[0] });
      }
    };
    const handleDidFinishLoad = () => {
      const url = wv.getURL?.() || tab.url;
      const title = titleRef.current || url;
      const favicon = faviconRef.current;
      if (url && url !== 'pulse://newtab' && !url.startsWith('devtools://') && url !== 'about:blank') {
        onAddHistory(title, url, favicon);
      }
      // Autofill saved credentials (host already matched by parent; preload re-verifies)
      if (autofillCred) {
        try { wv.send?.('autofill-credentials', autofillCred); } catch {}
      }
    };
    const handleDidNavigateInPage = (e: any) => {
      if (e.isMainFrame) {
        if (!e.url || e.url === 'about:blank') return;
        onUpdateTab(tab.id, { url: e.url, displayUrl: e.url, canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward() });
      }
    };
    const handleNewWindow = (e: any) => {
      e.preventDefault();
      // open in same tab
      onUpdateTab(tab.id, { url: e.url, displayUrl: e.url, loading: true });
      wv.loadURL(e.url).catch(()=>{});
    };
    const handleDidFailLoad = (e: any) => {
      if (e.isMainFrame && e.errorCode !== -3) {
        onError(tab.id, `Failed to load: ${e.errorDescription || e.errorCode}`);
        onUpdateTab(tab.id, { loading: false });
      }
    };
    const handleCrashed = (_e: any, details: any) => {
      if (details.reason === 'crashed' || details.reason === 'oom') {
        onError(tab.id, 'Webview crashed. Click retry to reload.');
        onUpdateTab(tab.id, { loading: false });
      }
    };
    const handleContextMenuEv = (e: any) => {
      e.preventDefault();
      onContextMenu({ position: { x: e.params.x, y: e.params.y }, linkUrl: e.params.linkURL || undefined, linkText: e.params.linkText || undefined, selectionText: e.params.selectionText || undefined });
    };
    const handleIpcMessage = (e: any) => {
      if (!e || e.channel !== 'save-credentials') return;
      const d = e.args?.[0];
      if (!d || typeof d.password !== 'string' || !d.password || d.password.length > 512) return;
      if (d.isTopFrame === false) return;
      if (typeof d.url !== 'string' || !d.url) return;
      try {
        window.dispatchEvent(new CustomEvent('pulse-save-credentials', {
          detail: {
            username: String(d.username || ''),
            password: d.password,
            url: d.url,
            title: String(d.title || ''),
          },
        }));
      } catch {}
    };
    let currentDlId: string | null = null;
    const handleWillDownload = (_event: any, item: any) => {
      const filename = item.getFilename();
      const url = item.getURL();
      const totalBytes = item.getTotalBytes();
      currentDlId = onAddDownload(url, filename);
      onUpdateDownload(currentDlId, { totalBytes });
      item.on('updated', (_e: any, state: string) => {
        if (state === 'progressing' && currentDlId) {
          if (!item.isPaused()) {
            onUpdateDownload(currentDlId, { receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(), progress: item.getTotalBytes()>0 ? (item.getReceivedBytes()/item.getTotalBytes())*100 : 0 });
          }
        }
      });
      item.once('done', (_e: any, state: string) => {
        if (currentDlId) onUpdateDownload(currentDlId, { state: state==='completed'?'completed':'cancelled', receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(), progress: 100 });
      });
    };

    wv.addEventListener('did-start-loading', handleDidStartLoading);
    wv.addEventListener('did-stop-loading', handleDidStopLoading);
    wv.addEventListener('did-navigate', handleDidNavigate);
    wv.addEventListener('page-title-updated', handlePageTitleUpdated);
    wv.addEventListener('page-favicon-updated', handlePageFaviconUpdated);
    wv.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
    wv.addEventListener('new-window', handleNewWindow);
    wv.addEventListener('did-fail-load', handleDidFailLoad);
    wv.addEventListener('render-process-gone', handleCrashed);
    wv.addEventListener('context-menu', handleContextMenuEv);
    wv.addEventListener('will-download', handleWillDownload);
    wv.addEventListener('did-finish-load', handleDidFinishLoad);
    wv.addEventListener('ipc-message', handleIpcMessage);

    return () => {
      wv.removeEventListener('dom-ready', handleDomReady);
      wv.removeEventListener('did-start-loading', handleDidStartLoading);
      wv.removeEventListener('did-stop-loading', handleDidStopLoading);
      wv.removeEventListener('did-navigate', handleDidNavigate);
      wv.removeEventListener('page-title-updated', handlePageTitleUpdated);
      wv.removeEventListener('page-favicon-updated', handlePageFaviconUpdated);
      wv.removeEventListener('did-navigate-in-page', handleDidNavigateInPage);
      wv.removeEventListener('new-window', handleNewWindow);
      wv.removeEventListener('did-fail-load', handleDidFailLoad);
      wv.removeEventListener('render-process-gone', handleCrashed);
      wv.removeEventListener('context-menu', handleContextMenuEv);
      wv.removeEventListener('will-download', handleWillDownload);
      wv.removeEventListener('did-finish-load', handleDidFinishLoad);
      wv.removeEventListener('ipc-message', handleIpcMessage);
    };
  }, [tab.id, userAgent, onUpdateTab, onAddDownload, onUpdateDownload, onAddHistory, onContextMenu, onError, onClearError]);

  // Keep webview src in sync when tab.url changes via address bar
  // React will update src attr automatically, but we also ensure loadURL for edge cases
  const prevUrlRef = useRef(tab.url);
  const webviewPreload = useMemo(() => {
    try {
      const p = (window as any).electronAPI?.webviewPreloadPath;
      return typeof p === 'string' && p ? p : undefined;
    } catch { return undefined; }
  }, []);
  useEffect(() => {
    if (prevUrlRef.current !== tab.url && tab.url !== 'pulse://newtab') {
      const wv = ref.current as any;
      if (wv && wv.getURL) {
        const cur = wv.getURL();
        if (cur !== tab.url) {
          try { wv.loadURL(tab.url, userAgent ? { userAgent } : undefined); } catch {}
        }
      }
    }
    prevUrlRef.current = tab.url;
  }, [tab.url, userAgent]);

  return (
    // @ts-ignore — webview is Electron-specific
    <webview
      ref={ref}
      className="h-full w-full"
      style={{
        position: 'absolute',
        inset: '0',
        height: '100%',
        width: '100%',
        visibility: isActive ? ('visible' as const) : ('hidden' as const),
        // @ts-ignore
        pointerEvents: isActive ? 'auto' : 'none',
      }}
      src={tab.url}
      // @ts-ignore
      useragent={userAgent || undefined}
      // @ts-ignore
      preload={webviewPreload}
      // @ts-ignore
      partition={tab.session === 'private' ? 'persist:private' : 'persist:main'}
      allowpopups
      webpreferences="contextIsolation=yes,nodeIntegration=no,backgroundThrottling=yes"
    />
  );
}

function SuspendedTab({ tab, isActive, onRestore }: { tab: BrowserTab; isActive: boolean; onRestore: () => void }) {
  const domain = (() => {
    try { return new URL(tab.url).hostname.replace(/^www\./, ''); } catch { return tab.url.replace(/^https?:\/\//, '').split('/')[0]; }
  })();
  return (
    <div
      className="h-full w-full"
      style={{
        position: 'absolute',
        inset: '0',
        height: '100%',
        width: '100%',
        visibility: isActive ? ('visible' as const) : ('hidden' as const),
        pointerEvents: isActive ? 'auto' : 'none',
      }}
    >
      <div className="h-full w-full flex flex-col items-center justify-center bg-pulse-bg p-6 text-center overflow-hidden">
        {tab.previewImage ? (
          <img src={tab.previewImage} alt="" className="w-[420px] max-w-[90%] h-[260px] object-cover rounded-2xl border border-pulse-border/50 shadow-card mb-5 opacity-90" draggable={false} />
        ) : (
          <div className="w-[420px] max-w-[90%] h-[260px] rounded-2xl border border-dashed border-pulse-border/40 bg-pulse-surface/50 shadow-soft backdrop-blur-sm flex flex-col items-center justify-center mb-5">
            <Globe size={32} className="text-pulse-muted/40 mb-2" />
            <span className="text-xs text-pulse-muted/60 font-mono tracking-wide">No preview</span>
          </div>
        )}
        <div className="flex items-center gap-2 mb-2">
          {tab.favicon ? <img src={tab.favicon} alt="" className="w-4 h-4 rounded-sm" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <Globe size={14} className="text-pulse-muted" />}
          <span className="text-sm font-medium text-pulse-text truncate max-w-[320px]">{tab.title || domain}</span>
        </div>
        <div className="text-xs text-pulse-muted/80 font-mono tracking-wide truncate max-w-[420px] mb-1">{tab.url}</div>
        <div className="text-[11px] text-pulse-muted/60 font-mono tracking-wide mb-5">{domain} · suspended to save memory</div>
        <button onClick={onRestore} className="flex items-center gap-2 px-5 py-2.5 bg-pulse-accent text-pulse-bg rounded-xl text-sm font-semibold hover:bg-pulse-accentSoft shadow-glow transition-all">
          <RotateCw size={14} /> Restore
        </button>
        <div className="mt-3 text-[10px] text-pulse-muted/50 font-mono tracking-wide">LRU pool keeps {MAX_LIVE_WEBVIEWS} live webviews · background throttling on</div>
      </div>
    </div>
  );
}

const NT_DEFAULTS: NewtabSettings = {
  wallpaper: 'obsidian',
  customWallpaper: '',
  searchPosition: 'center',
  searchSize: 'md',
  showLogo: true,
  showShortcuts: true,
};

const SHORTCUTS: [string, string][] = [
  ['⌘K', 'Command Palette'],
  ['⌘T', 'New Tab'],
  ['⌘L', 'Focus URL'],
  ['F12', 'DevTools'],
  ['⌘F', 'Find in Page'],
];

function NewTabPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [nt, setNt] = useState<NewtabSettings>(() => ({ ...NT_DEFAULTS, ...(loadSettings().newtab ?? {}) }));

  useEffect(() => {
    const onSettings = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setNt({ ...NT_DEFAULTS, ...(detail?.newtab ?? {}) });
    };
    window.addEventListener('pulse-settings-changed', onSettings);
    return () => window.removeEventListener('pulse-settings-changed', onSettings);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      let url = searchQuery.trim();
      const lower = url.toLowerCase();
      if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file:') || lower.startsWith('vbscript:') || lower.startsWith('blob:')) return;
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.includes('://')) {
        if (/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(url)) {
          url = `https://${url}`;
        } else {
          url = `https://duckduckgo.com/?q=${encodeURIComponent(url)}`;
        }
      }
      window.dispatchEvent(new CustomEvent('newtab-navigate', { detail: { url } }));
    }
  };

  const justify = nt.searchPosition === 'top' ? 'justify-start pt-24' : nt.searchPosition === 'bottom' ? 'justify-end pb-24' : 'justify-center';
  const formMaxW = nt.searchSize === 'sm' ? 'max-w-md' : nt.searchSize === 'lg' ? 'max-w-2xl' : 'max-w-xl';
  const inputSize = nt.searchSize === 'sm' ? 'h-12 text-[13px]' : nt.searchSize === 'lg' ? 'h-16 text-base' : 'h-14 text-sm';
  const btnSize = nt.searchSize === 'sm' ? 'h-9 px-4 text-xs' : nt.searchSize === 'lg' ? 'h-12 px-7 text-sm' : 'h-10 px-5 text-[13px]';
  const isCustomBg = nt.wallpaper === 'custom' && !!nt.customWallpaper;

  return (
    <div className={`h-full flex flex-col items-center ${justify} bg-pulse-bg relative overflow-hidden`}>
      <div key={`${nt.wallpaper}-${nt.customWallpaper}`} className={`nt-wallpaper nt-wallpaper-${nt.wallpaper} nt-wallpaper-fade`} style={isCustomBg ? { backgroundImage: `url("${nt.customWallpaper}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} />
      <div className="absolute inset-0 bg-gradient-to-b from-pulse-accent/[0.04] via-transparent to-transparent pointer-events-none" />
      <div className="absolute w-[600px] h-[600px] bg-pulse-accent/[0.03] blur-[80px] rounded-full -top-32 pointer-events-none nt-orb" />
      {nt.showLogo && (
      <div className="flex items-center gap-4 mb-7 relative rise-in">
        <div className="relative">
          <img src={pulseMarkUrl} alt="Pulse" className="w-14 h-14 rounded-2xl relative z-10 shadow-glow" />
          <div className="absolute inset-0 blur-2xl bg-pulse-accent/20 rounded-full" />
        </div>
        <div>
          <h1 className="text-[32px] font-light tracking-tight leading-none [text-wrap:balance]" style={{ textWrap: 'balance' }}>
            <span className="text-pulse-cream font-medium">PULSE</span> <span className="text-pulse-muted font-light">Browser</span>
          </h1>
          <p className="text-[11px] tracking-[0.18em] text-pulse-muted font-mono mt-1">OSINT & PENTEST</p>
        </div>
      </div>
      )}
      <form onSubmit={handleSearch} className={`w-full ${formMaxW} px-4 mb-6 rise-in`} style={{ animationDelay: '80ms' }}>
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-pulse-muted" />
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search DuckDuckGo or enter URL..." className={`w-full ${inputSize} pl-12 pr-24 bg-pulse-surface border border-pulse-border rounded-2xl font-mono text-pulse-text placeholder-pulse-muted/70 outline-none focus:border-pulse-accent/60 focus:ring-2 focus:ring-pulse-accent/20 focus:shadow-glow transition-all shadow-soft`} autoFocus />
          <button type="submit" className={`absolute right-2 top-1/2 -translate-y-1/2 ${btnSize} bg-pulse-accent text-pulse-bg font-semibold rounded-xl hover:bg-pulse-accentSoft shadow-glow transition-all`}>Go</button>
        </div>
      </form>
      {nt.showShortcuts && (
      <div className="mt-8 flex flex-wrap justify-center gap-4 px-4 text-[11px] text-pulse-muted font-mono rise-in" style={{ animationDelay: '160ms' }}>
        {SHORTCUTS.map(([keys, label], i) => (
          <span key={keys} className="rise-in" style={{ animationDelay: `${200 + i * 45}ms` }}><kbd className="bg-pulse-panel/80 px-2 py-0.5 rounded-full border border-pulse-border/60 text-pulse-textMuted">{keys}</kbd> {label}</span>
        ))}
      </div>
      )}
    </div>
  );
}
