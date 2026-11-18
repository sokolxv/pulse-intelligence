import { useState, useCallback, useEffect, useRef, useMemo, startTransition, ViewTransition, addTransitionType, lazy, Suspense } from 'react';
import { AnimatePresence } from 'framer-motion';
import TitleBar from './components/TitleBar';
import BookmarksBar from './components/BookmarksBar';
import BrowserSidebar from './components/BrowserSidebar';
import TabBar from './components/TabBar';
import SavePasswordPrompt from './components/SavePasswordPrompt';
import StartupSplash from './components/StartupSplash';
import BrowserPage from './pages/BrowserPage';
// Heavy sidebar pages load on demand to keep initial bundle and startup fast.
const Recon = lazy(() => import('./pages/Recon'));
const Network = lazy(() => import('./pages/Network'));
const DomainIntel = lazy(() => import('./pages/DomainIntel'));
const OSINTLookupPage = lazy(() => import('./pages/OSINTLookup'));
const OSINTModulesPage = lazy(() => import('./pages/OSINTModules'));
const PersonIntel = lazy(() => import('./pages/PersonIntel'));
const IpIntel = lazy(() => import('./pages/IpIntel'));
const WebIntel = lazy(() => import('./pages/WebIntel'));
const CyberToolsPage = lazy(() => import('./pages/CyberTools'));
const SubdomainEnumPage = lazy(() => import('./pages/SubdomainEnum'));
const VulnScannerPage = lazy(() => import('./pages/VulnScanner'));
const HttpClientPage = lazy(() => import('./pages/HttpClient'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const PasswordManagerPage = lazy(() => import('./pages/PasswordManager'));
const PrivacyDashboard = lazy(() => import('./pages/PrivacyDashboard'));
const BookmarksManager = lazy(() => import('./pages/BookmarksManager'));
const CanvasBoard = lazy(() => import('./pages/CanvasBoard'));
import StatusBar from './components/StatusBar';
import DownloadsBar from './components/DownloadsBar';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import HistoryPanel from './components/HistoryPanel';
import CommandPalette from './components/CommandPalette';
import NetworkGraphPanel from './components/NetworkGraph/NetworkGraphPanel';
import RequestInspectorBridge from './components/RequestInspectorBridge';
import { networkGraphStore, useNetworkGraphStore } from './graph/store';
import type { Page, BrowserTab, BookmarkItem, DownloadItem, HistoryEntry, CredentialEntry, TabSession } from './types';
import { loadSettings } from './lib/settings-store';

let tabIdCounter = 0;
function newTabId(): string {
  return `tab-${++tabIdCounter}-${Date.now()}`;
}

function createTab(url = 'pulse://newtab', session: TabSession = 'normal'): BrowserTab {
  return {
    id: newTabId(),
    title: 'New Tab',
    url,
    displayUrl: url,
    favicon: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    page: 'browser',
    session,
    previewImage: null,
  };
}

function loadBookmarks(): BookmarkItem[] {
  try {
    const raw = localStorage.getItem('pulse-bookmarks');
    if (raw) {
      const arr = JSON.parse(raw).map((b: any) => ({ ...b, createdAt: new Date(b.createdAt) }));
      if (arr.length > 0 && arr[0].url === 'https://google.com' && !arr.some((b: BookmarkItem) => b.url.includes('duckduckgo.com'))) {
        arr[0] = { id: 'bm-1', title: 'DuckDuckGo', url: 'https://duckduckgo.com', favicon: 'https://www.google.com/s2/favicons?domain=duckduckgo.com&sz=16', createdAt: new Date() };
        try { localStorage.setItem('pulse-bookmarks', JSON.stringify(arr)); } catch {}
      }
      return arr;
    }
  } catch {}
  return [
    { id: 'bm-1', title: 'DuckDuckGo', url: 'https://duckduckgo.com', favicon: 'https://www.google.com/s2/favicons?domain=duckduckgo.com&sz=16', createdAt: new Date() },
    { id: 'bm-2', title: 'GitHub', url: 'https://github.com', favicon: 'https://www.google.com/s2/favicons?domain=github.com&sz=16', createdAt: new Date() },
    { id: 'bm-3', title: 'Shodan', url: 'https://shodan.io', favicon: 'https://www.google.com/s2/favicons?domain=shodan.io&sz=16', createdAt: new Date() },
    { id: 'bm-4', title: 'crt.sh', url: 'https://crt.sh', favicon: 'https://www.google.com/s2/favicons?domain=crt.sh&sz=16', createdAt: new Date() },
    { id: 'bm-5', title: 'Exploit-DB', url: 'https://exploit-db.com', favicon: 'https://www.google.com/s2/favicons?domain=exploit-db.com&sz=16', createdAt: new Date() },
    { id: 'bm-6', title: 'Nmap', url: 'https://nmap.org', favicon: 'https://www.google.com/s2/favicons?domain=nmap.org&sz=16', createdAt: new Date() },
  ];
}

function saveSessionTabs(tabs: BrowserTab[]) {
  try {
    const serializable = tabs.map(t => ({
      ...t,
      previewImage: null,
    }));
    localStorage.setItem('pulse-tabs', JSON.stringify(serializable));
  } catch {}
}

function loadSessionTabs(): BrowserTab[] | null {
  try {
    const raw = localStorage.getItem('pulse-tabs');
    if (raw) {
      const parsed = JSON.parse(raw) as BrowserTab[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        tabIdCounter = parsed.reduce((max, t) => {
          const num = parseInt(t.id.split('-')[1] || '0', 10);
          return num > max ? num : max;
        }, tabIdCounter);
        return parsed.map(t => ({ ...t, previewImage: null }));
      }
    }
  } catch {}
  return null;
}

function PageFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-pulse-accent border-t-transparent animate-spin" />
    </div>
  );
}

export default function App() {
  const restoredTabs = loadSessionTabs();
  const [tabs, setTabs] = useState<BrowserTab[]>(() => restoredTabs || [createTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => restoredTabs ? restoredTabs[0].id : tabs[0].id);
  const [sidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [sidebarPage, setSidebarPageState] = useState<Page | null>(null);
  const sidebarPageRef = useRef<Page | null>(null);
  // Все переключения разделов — как Transition: нужно для <ViewTransition>-анимаций.
  // Направление (вниз/вверх по меню) едет типом перехода — CSS слайдит соответственно.
  const setSidebarPage = useCallback((page: Page | null) => {
    const order: (Page | null)[] = [null, 'bookmarks', 'privacy-dashboard', 'network', 'domain-intel', 'person-intel', 'ip-intel', 'web-intel', 'recon', 'osint-lookup', 'osint-modules', 'subdomain-enum', 'vuln-scanner', 'http-client', 'cyber-tools', 'settings', 'passwords', 'canvas'];
    const d = order.indexOf(page) - order.indexOf(sidebarPageRef.current);
    startTransition(() => {
      try { if (d !== 0) addTransitionType(d > 0 ? 'sec-fwd' : 'sec-back'); } catch {}
      sidebarPageRef.current = page;
      setSidebarPageState(page);
    });
  }, []);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(loadBookmarks);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [incognitoMode, setIncognitoMode] = useState(false);
  const [closedTabs, setClosedTabs] = useState<BrowserTab[]>([]);
  const [tabContextMenu, setTabContextMenu] = useState<{ position: { x: number; y: number }; tab: BrowserTab } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem('pulse-history');
      if (raw) {
        return JSON.parse(raw).map((h: any) => ({ ...h, timestamp: new Date(h.timestamp) }));
      }
    } catch {}
    return [];
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);
  const [credentialsHydrated, setCredentialsHydrated] = useState(false);
  // Глобальный тумблер анимаций (Settings → Appearance → Animations)
  const [animationsOn, setAnimationsOn] = useState(() => {
    try { return loadSettings().appearance.animations !== false; } catch { return true; }
  });
  useEffect(() => {
    const onSettings = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail;
        if (detail?.appearance) setAnimationsOn(detail.appearance.animations !== false);
      } catch {}
    };
    window.addEventListener('pulse-settings-changed', onSettings);
    return () => window.removeEventListener('pulse-settings-changed', onSettings);
  }, []);

  // ── Boot splash (hides after first paint settles) ────
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 1700);
    return () => clearTimeout(t);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const netgraphOpen = useNetworkGraphStore((s) => s.isOpen);

  // ── Privacy: New Identity — reset tabs/history ──
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (!api?.onPrivacyIdentityChanged) return;
    const off = api.onPrivacyIdentityChanged(() => {
      const fresh = createTab();
      setTabs([fresh]);
      setActiveTabId(fresh.id);
      setSidebarPage(null);
      setHistory([]);
      setClosedTabs([]);
      try {
        localStorage.removeItem('pulse-history');
        localStorage.removeItem('pulse-tabs');
        localStorage.setItem('pulse-tabs', JSON.stringify([{ ...fresh, previewImage: null }]));
      } catch {}
      window.dispatchEvent(new CustomEvent('webview-reload'));
    });
    return () => { try { off?.(); } catch {} };
  }, []);

  // ── Show shortcuts on first launch ─────────────────────
  useEffect(() => {
    const hasSeenShortcuts = localStorage.getItem('pulse-seen-shortcuts');
    if (!hasSeenShortcuts) {
      setShortcutsOpen(true);
      localStorage.setItem('pulse-seen-shortcuts', '1');
    }
  }, []);

  // ── Debounced persist (не дёргаем localStorage на каждый чих таба) ──
  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const persistQueue = useRef<Record<string, () => void>>({});
  const debouncedPersist = (key: string, fn: () => void, delay = 600) => {
    persistQueue.current[key] = fn;
    if (persistTimers.current[key]) clearTimeout(persistTimers.current[key]);
    persistTimers.current[key] = setTimeout(() => {
      delete persistTimers.current[key];
      const f = persistQueue.current[key];
      delete persistQueue.current[key];
      try { f(); } catch {}
    }, delay);
  };
  // Сброс очереди при размонтировании (не теряем последние изменения)
  useEffect(() => () => {
    Object.values(persistTimers.current).forEach(clearTimeout);
    Object.values(persistQueue.current).forEach((f) => { try { f(); } catch {} });
  }, []);

  // ── Persist session tabs ─────────────────────────────────
  useEffect(() => {
    debouncedPersist('tabs', () => saveSessionTabs(tabs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  // ── Persist bookmarks ────────────────────────────────────
  useEffect(() => {
    debouncedPersist('bookmarks', () => localStorage.setItem('pulse-bookmarks', JSON.stringify(bookmarks)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarks]);

  // ── Persist history (keep last 500) ──────────────────────
  useEffect(() => {
    debouncedPersist('history', () => localStorage.setItem('pulse-history', JSON.stringify(history.slice(0, 500))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  // ── Load and migrate encrypted credentials ───────────────
  useEffect(() => {
    (async () => {
      const api: any = (window as any).electronAPI;
      try {
        if (api?.credentialsRead) {
          const stored = await api.credentialsRead();
          if (stored?.ok) {
            setCredentials((stored.credentials || []).map((c: any) => ({
              ...c,
              createdAt: new Date(c.createdAt),
              updatedAt: new Date(c.updatedAt),
            })));
          } else {
            const legacy = localStorage.getItem('pulse-credentials');
            if (legacy) {
              const parsed = JSON.parse(legacy).map((c: any) => ({
                ...c,
                createdAt: new Date(c.createdAt),
                updatedAt: new Date(c.updatedAt),
              }));
              const saved = await api.credentialsSave(parsed);
              if (saved?.ok) {
                setCredentials(parsed);
                localStorage.removeItem('pulse-credentials');
              }
            }
          }
        }
      } catch (error) {
        console.error('[Pulse] encrypted credentials load failed', error);
      } finally {
        setCredentialsHydrated(true);
      }
    })();
  }, []);

  // ── Persist encrypted credentials ────────────────────────
  useEffect(() => {
    if (!credentialsHydrated) return;
    try {
      const api: any = (window as any).electronAPI;
      if (!api?.credentialsSave) return;
      api.credentialsSave(credentials).then((result: any) => {
        if (!result?.ok) console.error('[Pulse] encrypted credentials save failed', result?.error);
      }).catch((error: any) => console.error('[Pulse] encrypted credentials save failed', error));
    } catch (error) {
      console.error('[Pulse] encrypted credentials save failed', error);
    }
  }, [credentials, credentialsHydrated]);

  // ── Credential CRUD ──────────────────────────────────────
  const addCredential = useCallback((entry: Omit<CredentialEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    const cred: CredentialEntry = {
      ...entry,
      id: `cred-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setCredentials((prev) => [cred, ...prev]);
  }, []);

  const updateCredential = useCallback((id: string, patch: Partial<CredentialEntry>) => {
    setCredentials((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date() } : c))
    );
  }, []);

  const removeCredential = useCallback((id: string) => {
    setCredentials((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // ── Save-password prompt (from webview autofill bridge) ────
  const [pendingSave, setPendingSave] = useState<null | { username: string; password: string; url: string; title: string; host: string; origin: string }>(null);
  const [neverSaveHosts, setNeverSaveHosts] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('pulse-never-save');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.filter((h: any) => typeof h === 'string');
      }
    } catch {}
    return [];
  });
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try { localStorage.setItem('pulse-never-save', JSON.stringify(neverSaveHosts)); } catch {}
  }, [neverSaveHosts]);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { username: string; password: string; url: string; title: string; isTopFrame?: boolean };
      if (!d || typeof d.password !== 'string' || !d.password || d.isTopFrame === false) return;
      if (incognitoMode) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab?.session === 'private') return;
      let host = '';
      let origin = '';
      try {
        const u = new URL(d.url);
        if (!['http:', 'https:'].includes(u.protocol)) return;
        host = u.hostname.toLowerCase();
        origin = u.origin;
      } catch { return; }
      if (!host || neverSaveHosts.includes(host)) return;
      const dupe = credentials.some((c) => {
        let ch = '';
        try { ch = new URL(c.siteUrl).hostname.toLowerCase(); } catch { ch = (c.site || '').toLowerCase(); }
        return ch === host && c.username === (d.username || '') && c.password === d.password;
      });
      if (dupe) return;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      setPendingSave({ username: d.username || '', password: d.password, url: d.url, title: d.title || host, host, origin });
      pendingTimer.current = setTimeout(() => setPendingSave(null), 15000);
    };
    window.addEventListener('pulse-save-credentials', handler as EventListener);
    return () => window.removeEventListener('pulse-save-credentials', handler as EventListener);
  }, [incognitoMode, tabs, activeTabId, credentials, neverSaveHosts]);

  useEffect(() => () => { if (pendingTimer.current) clearTimeout(pendingTimer.current); }, []);

  const dismissSavePrompt = useCallback(() => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    setPendingSave(null);
  }, []);

  const savePendingPassword = useCallback(() => {
    if (!pendingSave) return;
    const { username, password, host, origin, title } = pendingSave;
    const site = title && title !== host ? title : host;
    const favicon = `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
    const existing = credentials.find((c) => {
      let ch = '';
      try { ch = new URL(c.siteUrl).hostname.toLowerCase(); } catch { ch = (c.site || '').toLowerCase(); }
      return ch === host && c.username === username;
    });
    if (existing) {
      updateCredential(existing.id, { password, siteUrl: origin || existing.siteUrl });
    } else {
      addCredential({ site, siteUrl: origin || `https://${host}`, username, password, favicon, notes: '' });
    }
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    setPendingSave(null);
  }, [pendingSave, credentials, addCredential, updateCredential]);

  const neverSavePassword = useCallback(() => {
    if (!pendingSave) return;
    setNeverSaveHosts((prev) => (prev.includes(pendingSave.host) ? prev : [...prev, pendingSave.host]));
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    setPendingSave(null);
  }, [pendingSave]);

  // ── History CRUD ──────────────────────────────────────────
  const addHistory = useCallback((title: string, url: string, favicon: string | null) => {
    // Skip duplicates (same URL within last 5 seconds, check last 5 entries)
    setHistory((prev) => {
      const now = Date.now();
      const isDupe = prev.slice(0, 5).some((h) => h.url === url && now - h.timestamp.getTime() < 5000);
      if (isDupe) {
        return prev;
      }
      const entry: HistoryEntry = {
        id: `hist-${Date.now()}`,
        title,
        url,
        favicon,
        timestamp: new Date(),
      };
      return [entry, ...prev];
    });
  }, []);

  const removeHistoryEntry = useCallback((id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  // ── Bookmark CRUD ─────────────────────────────────────────
  const addBookmark = useCallback((title: string, url: string) => {
    const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    const bm: BookmarkItem = {
      id: `bm-${Date.now()}`,
      title,
      url,
      favicon: host ? `https://www.google.com/s2/favicons?domain=${host}&sz=16` : null,
      createdAt: new Date(),
    };
    const normalizeUrl = (u: string) => u.replace(/[/#]+$/, '');
    const normalized = normalizeUrl(url);
    setBookmarks((prev) => {
      if (prev.some((b) => normalizeUrl(b.url) === normalized)) {
        return prev;
      }
      return [...prev, bm];
    });
  }, []);

  const removeBookmark = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const isBookmarked = activeTab
    ? bookmarks.some((b) => b.url === activeTab.url)
    : false;

  const toggleBookmark = useCallback(() => {
    if (!activeTab || activeTab.url === 'pulse://newtab') return;
    if (isBookmarked) {
      const existing = bookmarks.find((b) => b.url === activeTab.url);
      if (existing) removeBookmark(existing.id);
    } else {
      addBookmark(activeTab.title || activeTab.url, activeTab.url);
    }
  }, [activeTab, isBookmarked, bookmarks, addBookmark, removeBookmark]);

  // ── Download CRUD ──────────────────────────────────────────
  const addDownload = useCallback((url: string, filename: string) => {
    const dl: DownloadItem = {
      id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      filename,
      url,
      progress: 0,
      totalBytes: 0,
      receivedBytes: 0,
      state: 'progressing',
      timestamp: new Date(),
    };
    setDownloads((prev) => [dl, ...prev]);
    return dl.id;
  }, []);

  const updateDownload = useCallback((id: string, patch: Partial<DownloadItem>) => {
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
    );
  }, []);

  const removeDownload = useCallback((id: string) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const clearCompletedDownloads = useCallback(() => {
    setDownloads((prev) => prev.filter((d) => d.state !== 'completed'));
  }, []);

  // ── Tab drag state ────────────────────────────────────────
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  // ── Tab CRUD ──────────────────────────────────────────────
  const addTab = useCallback((url?: string) => {
    const tab = createTab(url, incognitoMode ? 'private' : 'normal');
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setSidebarPage(null);
  }, [incognitoMode]);

  const closeTab = useCallback((id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      setClosedTabs([tab, ...closedTabs].slice(0, 30));
    }
    const filtered = tabs.filter((t) => t.id !== id);
    if (filtered.length === 0) {
      const newTab = createTab();
      setTabs([newTab]);
      setActiveTabId(newTab.id);
      return;
    }
    setTabs(filtered);
    if (activeTabId === id) {
      const idx = tabs.findIndex((t) => t.id === id);
      const next = tabs[idx + 1] || tabs[idx - 1];
      if (next) {
        setActiveTabId(next.id);
      }
    }
  }, [tabs, activeTabId, closedTabs]);

  // ── Close all other tabs ──────────────────────────────────
  const closeOtherTabs = useCallback((keepId: string) => {
    const removed = tabs.filter((t) => t.id !== keepId);
    setClosedTabs([...removed, ...closedTabs].slice(0, 30));
    setTabs(tabs.filter((t) => t.id === keepId));
    setActiveTabId(keepId);
    setSidebarPage(null);
  }, [tabs, closedTabs]);

  // ── Restore last closed tab (Ctrl+Shift+T) ────────────────
  const restoreLastClosedTab = useCallback(() => {
    if (closedTabs.length === 0) return;
    const [tab, ...rest] = closedTabs;
    const newTab = { ...tab, id: newTabId(), previewImage: null };
    setClosedTabs(rest);
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
    setSidebarPage(newTab.page === 'browser' ? null : newTab.page);
  }, [closedTabs, tabs]);

  // ── Duplicate tab ─────────────────────────────────────────
  const duplicateTab = useCallback((tab: BrowserTab) => {
    const newTab: BrowserTab = {
      ...tab,
      id: newTabId(),
      title: tab.title,
      previewImage: null,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setSidebarPage(null);
  }, []);

  // ── Tab drag and drop ──────────────────────────────────────
  const handleTabDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    setDraggedTabId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    // Set a transparent drag image
    const ghost = document.createElement('div');
    ghost.style.opacity = '0';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }, []);

  const handleTabDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTabId(tabId);
  }, []);

  const handleTabDrop = useCallback((targetTabId: string) => {
    if (!draggedTabId || draggedTabId === targetTabId) {
      setDraggedTabId(null);
      setDragOverTabId(null);
      return;
    }
    setTabs((prev) => {
      const newTabs = [...prev];
      const dragIdx = newTabs.findIndex((t) => t.id === draggedTabId);
      const dropIdx = newTabs.findIndex((t) => t.id === targetTabId);
      if (dragIdx === -1 || dropIdx === -1) return prev;
      const [draggedTab] = newTabs.splice(dragIdx, 1);
      newTabs.splice(dropIdx, 0, draggedTab);
      return newTabs;
    });
    setDraggedTabId(null);
    setDragOverTabId(null);
  }, [draggedTabId]);

  const handleTabDragEnd = useCallback(() => {
    setDraggedTabId(null);
    setDragOverTabId(null);
  }, []);

  const updateTab = useCallback((id: string, patch: Partial<BrowserTab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }, []);

  // ── Navigation (default search: DuckDuckGo) ────────────
  const navigateTo = useCallback((url: string) => {
    let finalUrl = url.trim();
    const lowered = finalUrl.toLowerCase();
    if (
      lowered.startsWith('javascript:') ||
      lowered.startsWith('data:') ||
      lowered.startsWith('file:') ||
      lowered.startsWith('vbscript:') ||
      lowered.startsWith('blob:')
    ) {
      return;
    }
    if (
      !finalUrl.startsWith('http://') &&
      !finalUrl.startsWith('https://') &&
      !finalUrl.includes('://')
    ) {
      if (/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(finalUrl) && !/\s/.test(finalUrl)) {
        finalUrl = `https://${finalUrl}`;
      } else {
        finalUrl = `https://duckduckgo.com/?q=${encodeURIComponent(finalUrl)}`;
      }
    }
    const isNewTabNav = finalUrl === 'pulse://newtab';
    updateTab(activeTabId, {
      url: finalUrl,
      displayUrl: finalUrl,
      loading: !isNewTabNav,
      title: isNewTabNav ? 'New Tab' : finalUrl.replace(/^https?:\/\//, '').split('/')[0],
      ...(isNewTabNav ? { favicon: null } : {}),
    });
    setSidebarPage(null);
  }, [activeTabId, updateTab]);

  // ── Listen for newtab-navigate from NewTabPage ──────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.url) {
        const raw = String(detail.url).trim();
        const lowered = raw.toLowerCase();
        if (
          lowered.startsWith('javascript:') ||
          lowered.startsWith('data:') ||
          lowered.startsWith('file:') ||
          lowered.startsWith('vbscript:') ||
          lowered.startsWith('blob:')
        ) {
          return;
        }
        navigateTo(detail.url);
      }
    };
    window.addEventListener('newtab-navigate', handler);
    return () => window.removeEventListener('newtab-navigate', handler);
  }, [navigateTo]);

  // ── Network Graph: external open requests + open-url from node context menu ──
  useEffect(() => {
    const onOpen = () => networkGraphStore.open();
    const onOpenUrl = (e: Event) => {
      const url = (e as CustomEvent).detail?.url;
      if (typeof url === 'string' && url) addTab(url);
    };
    window.addEventListener('open-network-graph', onOpen);
    window.addEventListener('netgraph-open-url', onOpenUrl);
    return () => {
      window.removeEventListener('open-network-graph', onOpen);
      window.removeEventListener('netgraph-open-url', onOpenUrl);
    };
  }, [addTab]);

  const goHome = useCallback(() => {
    updateTab(activeTabId, {
      url: 'pulse://newtab',
      displayUrl: 'pulse://newtab',
      title: 'New Tab',
      favicon: null,
      loading: false,
    });
  }, [activeTabId, updateTab]);

  // ── Sidebar page navigation ───────────────────────────────
  const handleSidebarNavigate = useCallback((page: Page | 'browser') => {
    if (page === 'browser') {
      setSidebarPage(null);
    } else {
      setSidebarPage(page);
    }
  }, []);

  // ── Stable callbacks for memoized chrome (TitleBar/Sidebar/StatusBar) ──
  const handleNewTab = useCallback(() => addTab(), [addTab]);
  const handleRefresh = useCallback(() => {
    updateTab(activeTabId, { loading: true });
    window.dispatchEvent(new CustomEvent('webview-reload'));
  }, [activeTabId, updateTab]);
  const handleGoBack = useCallback(() => window.dispatchEvent(new CustomEvent('webview-go-back')), []);
  const handleGoForward = useCallback(() => window.dispatchEvent(new CustomEvent('webview-go-forward')), []);
  const handleOpenHistory = useCallback(() => setHistoryOpen(true), []);

  // ── Close tabs to the right (TabBar context menu) ───
  const closeTabsToRight = useCallback((keepId: string) => {
    const idx = tabs.findIndex(t => t.id === keepId);
    const toClose = tabs.slice(idx + 1);
    setClosedTabs(prev => [...toClose, ...prev].slice(0, 30));
    setTabs(prev => prev.slice(0, idx + 1));
    if (!tabs.slice(0, idx + 1).some(t => t.id === activeTabId)) {
      setActiveTabId(keepId);
    }
  }, [tabs, activeTabId]);

  // ── Private-mode toggle (TabBar + button) ───────────────
  const toggleIncognito = useCallback(() => {
    const next = !incognitoMode;
    setIncognitoMode(next);
    if (next) {
      const tab = createTab(undefined, 'private');
      setTabs(prev => [...prev, tab]);
      setActiveTabId(tab.id);
      setSidebarPage(null);
    }
  }, [incognitoMode]);

  // ── Tab hover preview state ───────────────────────────────
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showPreview, setShowPreview] = useState(false);

  const handleTabHoverChange = useCallback((tabId: string | null, pos: { x: number; y: number }) => {
    setHoveredTabId(tabId);
    if (tabId) setPreviewPos(pos);
  }, []);

  const handleSelectTab = useCallback((tab: BrowserTab) => {
    setActiveTabId(tab.id);
    setSidebarPage(tab.page === 'browser' ? null : tab.page);
  }, []);

  const handleReloadTab = useCallback((id: string) => {
    updateTab(id, { loading: true });
  }, [updateTab]);

  const handleCopyText = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  // ── Keyboard shortcuts (global, works even when input/webview not focused on div) ──
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    // e.code-based letter: same hotkey on any layout (RU 'к' → KeyR etc.)
    const key = /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();

    if (mod && key === 'k') {
      e.preventDefault();
      setCommandPaletteOpen((prev) => !prev);
      return;
    }
    if (mod && e.shiftKey && key === 'g') {
      e.preventDefault();
      networkGraphStore.toggle();
      return;
    }
    if (mod && key === 't' && !e.shiftKey) {
      e.preventDefault();
      addTab();
      return;
    }
    if (mod && key === 'w' && !e.shiftKey) {
      e.preventDefault();
      closeTab(activeTabId);
      return;
    }
    if (mod && e.shiftKey && key === 'w') {
      e.preventDefault();
      closeOtherTabs(activeTabId);
      return;
    }
    if (mod && e.shiftKey && key === 't') {
      e.preventDefault();
      restoreLastClosedTab();
      return;
    }
    if (e.key === 'Tab' && mod) {
      e.preventDefault();
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx === -1) return;
      const nextIdx = e.shiftKey
        ? (idx - 1 + tabs.length) % tabs.length
        : (idx + 1) % tabs.length;
      setActiveTabId(tabs[nextIdx].id);
      return;
    }
    if (mod && key === 'l') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('focus-urlbar'));
      return;
    }
    if (mod && (key === 'r' || e.key === '/')) {
      e.preventDefault();
      updateTab(activeTabId, { loading: true });
      window.dispatchEvent(new CustomEvent('webview-reload'));
      return;
    }
    if (e.key === 'F5') {
      e.preventDefault();
      updateTab(activeTabId, { loading: true });
      window.dispatchEvent(new CustomEvent('webview-reload'));
      return;
    }
    if (mod && key === 'd') {
      e.preventDefault();
      toggleBookmark();
      return;
    }
    if (e.key === '?' && mod) {
      e.preventDefault();
      setShortcutsOpen((prev) => !prev);
      return;
    }
    if (e.key === 'F12') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('webview-toggle-devtools'));
      return;
    }
    if (mod && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < tabs.length) {
        e.preventDefault();
        setActiveTabId(tabs[idx].id);
        setSidebarPage(tabs[idx].page === 'browser' ? null : tabs[idx].page);
      }
      return;
    }
    if (mod && e.key === '0') {
      e.preventDefault();
      if (tabs.length > 0) {
        const lastTab = tabs[tabs.length - 1];
        setActiveTabId(lastTab.id);
        setSidebarPage(lastTab.page === 'browser' ? null : lastTab.page);
      }
      return;
    }
  }, [addTab, closeTab, closeOtherTabs, restoreLastClosedTab, activeTabId, updateTab, toggleBookmark, tabs, setSidebarPage]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Shortcuts forwarded from webview (when focus inside guest) ──
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (!api?.onShortcut) return;
    const off = api.onShortcut((action: string) => {
      const fake = { key: '', metaKey: true, ctrlKey: true, shiftKey: false, preventDefault: () => {} } as any;
      if (action.startsWith('switch-')) {
        const num = action.split('-')[1];
        if (num === 'last') {
          if (tabs.length > 0) {
            const lastTab = tabs[tabs.length - 1];
            setActiveTabId(lastTab.id);
            setSidebarPage(lastTab.page === 'browser' ? null : lastTab.page);
          }
          return;
        }
        const idx = parseInt(num, 10) - 1;
        if (idx >= 0 && idx < tabs.length) {
          setActiveTabId(tabs[idx].id);
          setSidebarPage(tabs[idx].page === 'browser' ? null : tabs[idx].page);
        }
        return;
      }
      switch (action) {
        case 'new-tab': addTab(); break;
        case 'close-tab': closeTab(activeTabId); break;
        case 'close-others': closeOtherTabs(activeTabId); break;
        case 'restore-tab': restoreLastClosedTab(); break;
        case 'next-tab': fake.key='Tab'; handleKeyDown(fake); break;
        case 'prev-tab': fake.key='Tab'; fake.shiftKey=true; handleKeyDown(fake); break;
        case 'focus-url': window.dispatchEvent(new CustomEvent('focus-urlbar')); break;
        case 'reload': updateTab(activeTabId, { loading: true }); window.dispatchEvent(new CustomEvent('webview-reload')); break;
        case 'bookmark': toggleBookmark(); break;
        case 'palette': setCommandPaletteOpen(v=>!v); break;
        case 'find': window.dispatchEvent(new CustomEvent('pulse-toggle-find')); break;
        case 'netgraph': networkGraphStore.toggle(); break;
        case 'shortcuts': setShortcutsOpen(v=>!v); break;
        case 'devtools': window.dispatchEvent(new CustomEvent('webview-toggle-devtools')); break;
        default: break;
      }
    });
    return () => { try { off?.(); } catch {} };
  }, [addTab, closeTab, closeOtherTabs, restoreLastClosedTab, activeTabId, updateTab, toggleBookmark, handleKeyDown, tabs, setSidebarPage]);

  // ── Privacy routing enabled → auto-reload active tab via new route
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (!api?.onPrivacyRoutingEnabled) return;
    const off = api.onPrivacyRoutingEnabled(() => {
      window.dispatchEvent(new CustomEvent('webview-reload'));
    });
    return () => { try { off?.(); } catch {} };
  }, []);

  // ── Privacy new identity → clear tabs/history and reload
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (!api?.onPrivacyIdentityChanged) return;
    const off = api.onPrivacyIdentityChanged(() => {
      const fresh = createTab();
      setTabs([fresh]);
      setActiveTabId(fresh.id);
      setSidebarPage(null);
      setHistory([]);
      setClosedTabs([]);
      try {
        localStorage.removeItem('pulse-history');
        localStorage.removeItem('pulse-tabs');
        localStorage.setItem('pulse-tabs', JSON.stringify([{ ...fresh, previewImage: null }]));
      } catch {}
      window.dispatchEvent(new CustomEvent('webview-reload'));
    });
    return () => { try { off?.(); } catch {} };
  }, []);

  return (
    <div className={`flex flex-col h-screen bg-pulse-bg text-pulse-text select-none ${animationsOn ? '' : 'anim-off'}`}>
      {/* ── Title Bar / URL Bar ──────────────────────────── */}
      <TitleBar
        activeTab={activeTab}
        onNavigate={navigateTo}
        onGoHome={goHome}
        onNewTab={handleNewTab}
        onRefresh={handleRefresh}
        onBack={handleGoBack}
        onForward={handleGoForward}
        isSidebarPage={sidebarPage !== null}
        onBackToBrowser={() => setSidebarPage(null)}
        isBookmarked={isBookmarked}
        onToggleBookmark={toggleBookmark}
        incognitoMode={incognitoMode}
        onToggleIncognito={toggleIncognito}
      />

      {/* ── Save password prompt ─────────────────────────── */}
      <SavePasswordPrompt
        pending={pendingSave ? { host: pendingSave.host, username: pendingSave.username } : null}
        onSave={savePendingPassword}
        onNever={neverSavePassword}
        onDismiss={dismissSavePrompt}
      />

      {/* ── Main Content ────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <BrowserSidebar
          currentSidebarPage={sidebarPage}
          onNavigate={handleSidebarNavigate}
          onOpenHistory={handleOpenHistory}
          collapsed={true}
          onToggleCollapse={() => {}}
          incognitoMode={incognitoMode}
        />

        {/* Content */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Tab bar */}
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            dragOverTabId={dragOverTabId}
            hoveredTabId={hoveredTabId}
            showPreview={showPreview}
            previewPos={previewPos}
            incognitoMode={incognitoMode}
            tabContextMenu={tabContextMenu}
            onSelectTab={handleSelectTab}
            onCloseTab={closeTab}
            onCloseOtherTabs={closeOtherTabs}
            onCloseTabsToRight={closeTabsToRight}
            onReloadTab={handleReloadTab}
            onDuplicateTab={duplicateTab}
            onCopyText={handleCopyText}
            onAddTab={handleNewTab}
            onToggleIncognito={toggleIncognito}
            onDragStart={handleTabDragStart}
            onDragOver={handleTabDragOver}
            onDrop={handleTabDrop}
            onDragEnd={handleTabDragEnd}
            onHoverChange={handleTabHoverChange}
            onPreviewVisibility={setShowPreview}
            onContextMenu={setTabContextMenu}
            onCloseContextMenu={() => setTabContextMenu(null)}
          />

          {/* Page content */}
          <main className="flex-1 overflow-hidden relative">
            {sidebarPage ? (
              <div className="h-full overflow-auto p-4">
                <Suspense fallback={<PageFallback />}>
                <ViewTransition key={sidebarPage} name="section-panel">
                  <div className="h-full">
                  {sidebarPage === 'recon' && <Recon key="recon" />}
                  {sidebarPage === 'network' && <Network key="network" />}
                  {sidebarPage === 'domain-intel' && <DomainIntel key="domain-intel" />}
                  {sidebarPage === 'person-intel' && <PersonIntel key="person-intel" />}
                  {sidebarPage === 'ip-intel' && <IpIntel key="ip-intel" />}
                  {sidebarPage === 'web-intel' && <WebIntel key="web-intel" />}
                  {sidebarPage === 'osint-lookup' && (
                    <OSINTLookupPage key="osint-lookup" />
                  )}
                  {sidebarPage === 'subdomain-enum' && (
                    <SubdomainEnumPage key="subdomain-enum" />
                  )}
                  {sidebarPage === 'vuln-scanner' && (
                    <VulnScannerPage key="vuln-scanner" />
                  )}
                  {sidebarPage === 'http-client' && (
                    <HttpClientPage key="http-client" />
                  )}
                  {sidebarPage === 'osint-modules' && (
                    <OSINTModulesPage key="osint-modules" />
                  )}
                  {sidebarPage === 'cyber-tools' && (
                    <CyberToolsPage key="cyber-tools" />
                  )}
                  {sidebarPage === 'settings' && (
                    <SettingsPage key="settings" />
                  )}
                  {sidebarPage === 'passwords' && (
                    <PasswordManagerPage
                      key="passwords"
                      credentials={credentials}
                      onAdd={addCredential}
                      onUpdate={updateCredential}
                      onRemove={removeCredential}
                    />
                  )}
                  {sidebarPage === 'privacy-dashboard' && (
                    <PrivacyDashboard
                      key="privacy-dashboard"
                      currentUrl={activeTab?.url ?? 'pulse://newtab'}
                      currentTitle={activeTab?.title}
                      currentFavicon={activeTab?.favicon}
                    />
                  )}
                  {sidebarPage === 'bookmarks' && (
                    <BookmarksManager
                      key="bookmarks"
                      onNavigate={navigateTo}
                      onNewTab={(u)=> addTab(u)}
                    />
                  )}
                  {sidebarPage === 'canvas' && (
                    <CanvasBoard
                      key="canvas"
                      ownerId="pulse:local"
                      storageKey="pulse-canvases-local"
                    />
                  )}
                  </div>
                </ViewTransition>
                </Suspense>
              </div>
            ) : (
              <BrowserPage
                tabs={tabs}
                activeTabId={activeTabId}
                onUpdateTab={updateTab}
                onAddDownload={addDownload}
                onUpdateDownload={updateDownload}
                onAddHistory={addHistory}
                credentials={incognitoMode ? [] : credentials}
              />
            )}
            {/* ── Network Graph overlay (keeps webviews mounted) ── */}
            <AnimatePresence>
              {netgraphOpen && (
                <NetworkGraphPanel
                  key="network-graph"
                  activeTabId={activeTabId}
                  pageUrl={activeTab?.url ?? ''}
                  pageTitle={activeTab?.title}
                  onClose={() => networkGraphStore.close()}
                  inspector={<RequestInspectorBridge />}
                />
              )}
            </AnimatePresence>
          </main>
        </div>
      </div>

      {/* ── Downloads Bar ───────────────────────────────── */}
      <DownloadsBar
        downloads={downloads}
        onClear={clearCompletedDownloads}
        onRemove={removeDownload}
      />

      {/* ── Status Bar ──────────────────────────────────── */}
      <StatusBar
        incognitoMode={incognitoMode}
        isSecure={activeTab?.url?.startsWith('https://') ?? false}
        currentUrl={activeTab?.url ?? 'pulse://newtab'}
        onOpenNetworkGraph={() => networkGraphStore.open()}
      />

      {/* ── History Panel ───────────────────────────────── */}
      <AnimatePresence>
        {historyOpen && (
          <HistoryPanel
            history={history}
            onNavigate={navigateTo}
            onNewTab={addTab}
            onRemove={removeHistoryEntry}
            onClear={clearHistory}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Command Palette ──────────────────────────────── */}
      <AnimatePresence>
        {commandPaletteOpen && (
          <CommandPalette
            onClose={() => setCommandPaletteOpen(false)}
            onNavigate={(page) => {
              if (page === 'browser') {
                setSidebarPage(null);
              } else {
                setSidebarPage(page);
              }
            }}
            onNewTab={addTab}
            onOpenNetworkGraph={() => networkGraphStore.open()}
          />
        )}
      </AnimatePresence>

      {/* ── Keyboard Shortcuts ──────────────────────────── */}
      <AnimatePresence>
        {shortcutsOpen && (
          <KeyboardShortcuts onClose={() => setShortcutsOpen(false)} />
        )}
      </AnimatePresence>

      {/* ── Boot splash ─────────────────────────────────── */}
      <StartupSplash show={!booted} />
    </div>
  );
}
