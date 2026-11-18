import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck, Shield, ShieldOff, Globe, Lock, Unlock,
  BarChart3, Trash2, RotateCw, Eye, ExternalLink,
  AlertTriangle, Zap, Ban, Activity, Filter
} from 'lucide-react';
import type { PrivacySiteStats } from '../types';

function getHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch { return null; }
}

function sanitizeHost(input: string): string | null {
  const t = (input || '').trim();
  if (!t) return null;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t) ? t : `https://${t}`;
    const u = new URL(withScheme);
    const h = u.hostname.trim().replace(/\.$/, '');
    if (/^[a-zA-Z0-9._-]{1,253}$/.test(h) && h.length > 0) return h.toLowerCase();
    return null;
  } catch {
    const host = t.split('/')[0].split(':')[0].split('?')[0].split('#')[0].trim().replace(/\.$/, '');
    if (/^[a-zA-Z0-9._-]{1,253}$/.test(host) && host.length > 0) return host.toLowerCase();
    return null;
  }
}

const BLOCKED: (string | RegExp)[] = ['localhost', /127\./, '::1', '0.0.0.0', '169.254.169.254', 'metadata.google', /192\.168\./, /10\./, /172\.(1[6-9]|2\d|3[01])\./];

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return BLOCKED.some((b) => (typeof b === 'string' ? h === b || h.endsWith('.' + b) : b.test(h)));
}
void sanitizeHost;
void isBlockedHost;
void BLOCKED;

function categoryMeta(cat: string) {
  switch (cat) {
    case 'ads': return { label: 'Ad networks', desc: 'Banners, popups, ad servers', color: 'text-pulse-orange', bg: 'bg-pulse-orange/15', border: 'border-pulse-orange/25', bar: 'bg-pulse-orange/70' };
    case 'analytics': return { label: 'Analytics', desc: 'Trackers, pixels, beacons', color: 'text-pulse-accent', bg: 'bg-pulse-accent/15', border: 'border-pulse-accent/25', bar: 'bg-pulse-accent/70' };
    case 'social': return { label: 'Social', desc: 'Facebook, Twitter, LinkedIn', color: 'text-pulse-purple', bg: 'bg-pulse-purple/15', border: 'border-pulse-purple/25', bar: 'bg-pulse-purple/70' };
    case 'crypto': return { label: 'Crypto', desc: 'Miners & hijackers', color: 'text-pulse-red', bg: 'bg-pulse-red/15', border: 'border-pulse-red/25', bar: 'bg-pulse-red/70' };
    default: return { label: 'Other', desc: 'Fingerprint & misc', color: 'text-pulse-muted', bg: 'bg-pulse-muted/10', border: 'border-pulse-border', bar: 'bg-pulse-muted/60' };
  }
}

interface PrivacyDashboardProps {
  currentUrl: string;
  currentTitle?: string;
  currentFavicon?: string | null;
}

export default function PrivacyDashboard({ currentUrl, currentTitle, currentFavicon }: PrivacyDashboardProps) {
  const host = useMemo(() => getHost(currentUrl), [currentUrl]);
  const isNewTab = !currentUrl || currentUrl === 'pulse://newtab' || currentUrl.startsWith('about:');

  const [siteStats, setSiteStats] = useState<PrivacySiteStats | null>(null);
  const [globalCount, setGlobalCount] = useState(0);
  const [filterCount, setFilterCount] = useState(0);
  const [enabledGlobal, setEnabledGlobal] = useState(true);
  const [siteEnabled, setSiteEnabled] = useState(true);
  const [perSiteList, setPerSiteList] = useState<PrivacySiteStats[]>([]);
  const [recentGlobal, setRecentGlobal] = useState<any[]>([]);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const cancelRef = useRef(false);
  void cancelRef;
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const api: any = (window as any).electronAPI;
    if (!api) { inFlightRef.current = false; return; }
    try {
      const all = await api.getAllAdBlockerStats?.();
      if (!mountedRef.current) return;
      if (all) {
        setGlobalCount(all.blockCount ?? 0);
        setFilterCount(all.filterCount ?? 0);
        setEnabledGlobal(all.enabled ?? true);
        setPerSiteList(all.perSite ?? []);
        setRecentGlobal(all.recentGlobal ?? []);
        if (host && !isNewTab) {
          const s = all.perSite?.find((p: any) => p.hostname === host);
          if (s) setSiteStats(s);
          else {
            const single = await api.getSiteStats?.(host);
            if (!mountedRef.current) return;
            setSiteStats(single ?? { hostname: host, count: 0, blocked: 0, categories: { ads:0, analytics:0, social:0, crypto:0, other:0 }, domains:{}, recent:[], lastBlockedAt:null });
          }
          const disabled = all.disabledSites ?? [];
          setSiteEnabled(!disabled.includes(host));
        } else {
          setSiteStats(null);
        }
      } else {
        const stats = await api.getAdBlockerStats?.();
        if (!mountedRef.current) return;
        if (stats) {
          setGlobalCount(stats.blockCount ?? 0);
          setFilterCount(stats.filterCount ?? 0);
          setEnabledGlobal(stats.enabled ?? true);
        }
        if (host && !isNewTab) {
          const s = await api.getSiteStats?.(host);
          if (!mountedRef.current) return;
          setSiteStats(s);
          const all2 = await api.getAllAdBlockerStats?.();
          if (!mountedRef.current) return;
          if (all2) setSiteEnabled(!all2.disabledSites?.includes(host));
        }
      }
    } catch {} finally {
      inFlightRef.current = false;
    }
  }, [host, isNewTab]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (!api?.onAdBlockerUpdate) return;
    const off = api.onAdBlockerUpdate((data: any) => {
      if (!data) return;
      if (data.clearedAll) {
        setGlobalCount(0);
        setPerSiteList([]);
        setRecentGlobal([]);
        setSiteStats(prev => prev ? { ...prev, count:0, blocked:0, categories:{ads:0, analytics:0, social:0, crypto:0, other:0}, domains:{}, recent:[] } : prev);
        return;
      }
      if (data.cleared && data.siteHost === host) {
        setSiteStats(data.siteStats ?? { hostname: host!, count: 0, categories:{ads:0, analytics:0, social:0, crypto:0, other:0}, domains:{}, recent:[], lastBlockedAt:null });
        refresh();
        return;
      }
      if (data.globalCount !== undefined) setGlobalCount(data.globalCount);
      if (data.siteHost && host && data.siteHost === host && data.siteStats) {
        setSiteStats(data.siteStats);
      } else if (data.siteHost) {
        refresh();
      } else {
        refresh();
      }
    });
    return () => { try { off?.(); } catch {} };
  }, [host, refresh]);

  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (!api?.onAdBlockerToggle) return;
    const off = api.onAdBlockerToggle((d: any) => {
      if (d && typeof d.enabled === 'boolean') setEnabledGlobal(d.enabled);
    });
    return () => { try { off?.(); } catch {} };
  }, []);

  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (!api?.onAdBlockerSiteToggle) return;
    const off = api.onAdBlockerSiteToggle((d: any) => {
      if (d && host && d.hostname === host) setSiteEnabled(!!d.enabled);
    });
    return () => { try { off?.(); } catch {} };
  }, [host]);

  const handleToggleSite = async () => {
    if (!host) return;
    const prev = siteEnabled;
    const next = !siteEnabled;
    setSiteEnabled(next);
    try {
      await (window as any).electronAPI?.toggleSiteBlocking?.(host, next);
      if (!mountedRef.current) return;
    } catch {
      if (!mountedRef.current) return;
      setSiteEnabled(prev);
      return;
    }
    setTimeout(() => { if (mountedRef.current) refresh(); }, 300);
  };

  const handleToggleGlobal = async () => {
    const prev = enabledGlobal;
    const next = !enabledGlobal;
    setEnabledGlobal(next);
    try {
      await (window as any).electronAPI?.toggleAdBlocker?.(next);
      if (!mountedRef.current) return;
    } catch {
      if (!mountedRef.current) return;
      setEnabledGlobal(prev);
    }
  };

  const handleClearSite = async () => {
    if (!host) return;
    try { await (window as any).electronAPI?.clearSiteStats?.(host); } catch {}
    setSiteStats({ hostname: host, count:0, blocked:0, categories:{ads:0, analytics:0, social:0, crypto:0, other:0}, domains:{}, recent:[], lastBlockedAt:null });
    refresh();
  };

  const handleClearAll = async () => {
    try { await (window as any).electronAPI?.clearAllStats?.(); } catch { try { (window as any).electronAPI?.resetAdBlockerCount?.(); } catch {} }
    setGlobalCount(0);
    setPerSiteList([]);
    setSiteStats(prev => prev ? { ...prev, count:0, blocked:0, categories:{ads:0, analytics:0, social:0, crypto:0, other:0}, domains:{}, recent:[] } : prev);
    setRecentGlobal([]);
  };

  const domainList = useMemo(() => {
    if (!siteStats?.domains) return [];
    return Object.entries(siteStats.domains)
      .map(([domain, v]: any) => ({ domain, count: v.count, category: v.category }))
      .sort((a,b)=>b.count - a.count);
  }, [siteStats]);

  const totalForSite = siteStats?.count ?? 0;
  const cats = siteStats?.categories ?? { ads:0, analytics:0, social:0, crypto:0, other:0 };
  const maxCat = Math.max(1, cats.ads, cats.analytics, cats.social, cats.crypto, cats.other);
  const protectionLevel = !enabledGlobal ? 'off' : !siteEnabled ? 'site-off' : totalForSite > 20 ? 'strong' : totalForSite > 5 ? 'moderate' : totalForSite > 0 ? 'light' : 'clean';
  const isSecure = currentUrl.startsWith('https://');

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="max-w-[980px] mx-auto space-y-5 pb-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pulse-accent/10 border border-pulse-accent/15 flex items-center justify-center">
            <ShieldCheck size={20} className="text-pulse-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              Privacy Dashboard
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-lg bg-pulse-panel border border-pulse-border text-pulse-textMuted">Brave-style Shields</span>
            </h1>
            <p className="text-xs text-pulse-muted">Trackers blocked on current page • per-site breakdown • no breaking Tor routing</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={handleClearAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-pulse-surface border border-pulse-border text-xs text-pulse-muted hover:text-pulse-text hover:border-pulse-borderStrong transition-all">
            <Trash2 size={12} /> Clear all
          </button>
          <button onClick={refresh} className="w-8 h-8 flex items-center justify-center rounded-xl bg-pulse-surface border border-pulse-border text-pulse-muted hover:text-pulse-text hover:border-pulse-borderStrong transition-all" title="Refresh">
            <RotateCw size={14} />
          </button>
        </div>
      </div>

      <div className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${!enabledGlobal ? 'bg-pulse-red/10 border-pulse-red/25' : !siteEnabled ? 'bg-pulse-yellow/10 border-pulse-yellow/25' : protectionLevel==='strong' ? 'bg-pulse-green/10 border-pulse-green/25' : 'bg-pulse-surface border-pulse-border'}`}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center border flex-shrink-0 ${!enabledGlobal ? 'bg-pulse-red/15 border-pulse-red/25 text-pulse-red' : !siteEnabled ? 'bg-pulse-yellow/15 border-pulse-yellow/25 text-pulse-yellow' : 'bg-pulse-accent/15 border-pulse-accent/25 text-pulse-accent'}`}>
            {!enabledGlobal || !siteEnabled ? <ShieldOff size={18} /> : <ShieldCheck size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold flex items-center gap-2">
              { !enabledGlobal ? 'Shields are OFF globally' : !siteEnabled ? 'Shields are OFF for this site' : protectionLevel==='clean' ? 'No trackers detected yet' : protectionLevel==='strong' ? 'Strong protection active' : protectionLevel==='moderate' ? 'Protection active' : 'Light protection'}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-lg border font-mono tabular-nums ${!enabledGlobal ? 'bg-pulse-red/15 border-pulse-red/25 text-pulse-red' : !siteEnabled ? 'bg-pulse-yellow/15 border-pulse-yellow/25 text-pulse-yellow' : 'bg-pulse-green/15 border-pulse-green/25 text-pulse-green'}`}>
                {!enabledGlobal ? 'OFF' : !siteEnabled ? 'SITE OFF' : 'ON'}
              </span>
            </div>
            <div className="text-[11px] text-pulse-muted truncate">
              {!enabledGlobal ? 'All blocking disabled — toggle to resume' : !siteEnabled ? `Blocking paused for ${host} — trackers will load` : `Blocking ${filterCount} filter rules • ${globalCount} total blocked across all sites`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-pulse-muted hidden sm:inline">Global</span>
          <button
            onClick={handleToggleGlobal}
            className={`w-11 h-6 rounded-full transition-colors flex items-center p-0.5 ${enabledGlobal ? 'bg-pulse-accent' : 'bg-pulse-border'}`}
            title={enabledGlobal ? 'Disable globally' : 'Enable globally'}
          >
            <span className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${enabledGlobal ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      <div className="bg-pulse-surface border border-pulse-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-pulse-border/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isNewTab ? (
              <div className="w-6 h-6 rounded bg-pulse-panel flex items-center justify-center flex-shrink-0"><Zap size={12} className="text-pulse-accent" /></div>
            ) : currentFavicon ? (
              <img src={currentFavicon} alt="" className="w-6 h-6 rounded flex-shrink-0 bg-white" />
            ) : (
              <div className="w-6 h-6 rounded bg-pulse-panel border border-pulse-border flex items-center justify-center flex-shrink-0"><Globe size={12} className="text-pulse-muted" /></div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-mono truncate flex items-center gap-1.5">
                {isNewTab ? <span className="text-pulse-muted">pulse://newtab</span> : <span className="text-pulse-text truncate">{currentUrl}</span>}
                {!isNewTab && (isSecure ? <Lock size={10} className="text-pulse-green flex-shrink-0" /> : <Unlock size={10} className="text-pulse-yellow flex-shrink-0" />)}
              </div>
              {!isNewTab && host && <div className="text-[10px] text-pulse-muted truncate">{host} • {currentTitle || host}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!isNewTab && host && (
              <>
                <span className="text-[11px] text-pulse-muted hidden md:inline">Block on this site</span>
                <button
                  onClick={handleToggleSite}
                  className={`w-11 h-6 rounded-full transition-colors flex items-center p-0.5 ${siteEnabled ? 'bg-pulse-accent' : 'bg-pulse-border'}`}
                  title={siteEnabled ? 'Disable for this site' : 'Enable for this site'}
                >
                  <span className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${siteEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </>
            )}
          </div>
        </div>

        {isNewTab ? (
          <div className="p-10 text-center">
            <div className="w-14 h-14 rounded-xl bg-pulse-panel border border-pulse-border flex items-center justify-center mx-auto mb-3">
              <Eye size={20} className="text-pulse-muted" />
            </div>
            <div className="text-sm font-medium">No page loaded</div>
            <div className="text-xs text-pulse-muted mt-1 max-w-md mx-auto">Open a website to see Brave-style tracker breakdown. Navigate via the address bar — blocking runs in the background on <span className="text-pulse-accent font-mono">persist:main</span> partition.</div>
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-pulse-bg border border-pulse-border rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[10px] tracking-wider font-mono text-pulse-muted mb-1"><Ban size={10} /> THIS PAGE</div>
                <div className="text-2xl font-mono font-bold tabular-nums text-pulse-accent">{totalForSite}</div>
                <div className="text-[11px] text-pulse-muted">trackers blocked</div>
                {siteStats?.lastBlockedAt && <div className="text-[10px] text-pulse-muted/60 mt-1">last {new Date(siteStats.lastBlockedAt).toLocaleTimeString()}</div>}
              </div>
              <div className="bg-pulse-bg border border-pulse-border rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[10px] tracking-wider font-mono text-pulse-muted mb-1"><BarChart3 size={10} /> TOTAL</div>
                <div className="text-2xl font-mono font-bold tabular-nums text-pulse-green">{globalCount}</div>
                <div className="text-[11px] text-pulse-muted">all sites blocked</div>
                <div className="text-[10px] text-pulse-muted/60 mt-1">{filterCount} filters • {perSiteList.length} sites</div>
              </div>
              <div className="bg-pulse-bg border border-pulse-border rounded-xl p-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] tracking-wider font-mono text-pulse-muted mb-1"><Activity size={10} /> STATUS</div>
                  <div className={`text-sm font-semibold ${siteEnabled && enabledGlobal ? 'text-pulse-green' : 'text-pulse-yellow'}`}>{siteEnabled && enabledGlobal ? 'Protected' : 'Unprotected'}</div>
                  <div className="text-[11px] text-pulse-muted">{isSecure ? 'HTTPS • encrypted' : 'HTTP • not encrypted'}</div>
                </div>
                <button
                  onClick={handleClearSite}
                  disabled={totalForSite===0}
                  className="mt-2 w-full flex items-center justify-center gap-1 py-1 rounded bg-pulse-surface border border-pulse-border text-[11px] text-pulse-muted hover:text-pulse-text disabled:opacity-40 transition-colors"
                >
                  <Trash2 size={10} /> Clear for this site
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
              {(['ads','analytics','social','crypto'] as const).map(cat => {
                const meta = categoryMeta(cat);
                const count = (cats as any)[cat] ?? 0;
                const pct = Math.round((count / maxCat) * 100);
                return (
                  <div key={cat} className={`rounded-xl border p-3 ${meta.bg} ${meta.border}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
                      <span className="text-sm font-mono font-bold">{count}</span>
                    </div>
                    <div className="text-[10px] text-pulse-muted leading-tight mb-2">{meta.desc}</div>
                    <div className="h-1 bg-pulse-bg/60 rounded-full overflow-hidden border border-pulse-border/50">
                      <div className={`h-full rounded-full transition-all ${meta.bar}`} style={{ width: `${count===0?0:Math.max(8,pct)}%` }} />
                    </div>
                    <div className="text-[10px] font-mono text-pulse-muted mt-1">{count===0 ? '— none blocked' : `${count} blocked`}</div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-pulse-muted mb-2">
              <Filter size={12} /> Blocked domains on this page
              <span className="px-1.5 py-0.5 rounded bg-pulse-panel border border-pulse-border text-[10px] font-mono">{domainList.length} domains</span>
              {cats.other > 0 && <span className="px-1.5 py-0.5 rounded bg-pulse-panel border border-pulse-border text-[10px] font-mono">+{cats.other} other</span>}
            </div>

            {domainList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-pulse-border bg-pulse-bg p-6 text-center">
                <Shield size={20} className="mx-auto text-pulse-muted/50 mb-2" />
                <div className="text-xs font-medium">No trackers blocked yet</div>
                <div className="text-[11px] text-pulse-muted mt-1">Visit a site with ads/analytics — blocks appear here live via <span className="font-mono text-pulse-accent">adblocker-update</span> IPC.</div>
                <div className="flex items-center justify-center gap-2 mt-3">
                  <span className="text-[10px] text-pulse-muted">Try:</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pulse-surface border border-pulse-border">cnn.com</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pulse-surface border border-pulse-border">youtube.com</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pulse-surface border border-pulse-border">nytimes.com</span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-pulse-border overflow-hidden bg-pulse-bg">
                <div className="max-h-[260px] overflow-auto divide-y divide-pulse-border/50">
                  {domainList.map(({ domain, count, category }) => {
                    const meta = categoryMeta(category);
                    return (
                      <div key={domain} className="flex items-center gap-3 px-3 py-2.5 hover:bg-pulse-panel/30 transition-colors">
                        <div className="w-7 h-7 rounded-lg bg-pulse-surface border border-pulse-border flex items-center justify-center flex-shrink-0">
                          <Globe size={12} className="text-pulse-muted" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-mono truncate">{domain}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`text-[9px] px-1 py-0 rounded border font-mono ${meta.bg} ${meta.border} ${meta.color}`}>{meta.label}</span>
                            <span className="text-[10px] text-pulse-muted/60 truncate">blocked {count}×</span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-mono font-bold">{count}</div>
                          <div className="text-[10px] text-pulse-muted">requests</div>
                        </div>
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.bar}`} title={category} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {siteStats?.recent && siteStats.recent.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] font-mono text-pulse-muted flex items-center gap-1.5 mb-2">
                  <ExternalLink size={10} /> Recent blocked URLs
                </div>
                <div className="rounded-xl border border-pulse-border bg-pulse-bg overflow-hidden">
                  <div className="max-h-[180px] overflow-auto divide-y divide-pulse-border/30">
                    {siteStats.recent.slice(0,12).map((r, i) => (
                      <div key={i} className="px-3 py-2 flex items-center gap-2 text-[11px] font-mono">
                        <span className={`text-[9px] px-1 py-0 rounded border flex-shrink-0 ${categoryMeta(r.category).bg} ${categoryMeta(r.category).border} ${categoryMeta(r.category).color}`}>{r.category}</span>
                        <span className="truncate flex-1 text-pulse-muted">{r.url}</span>
                        <span className="text-[10px] text-pulse-muted/50 flex-shrink-0">{new Date(r.timestamp).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {perSiteList.length > 0 && (
        <div className="bg-pulse-surface border border-pulse-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-pulse-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <BarChart3 size={14} className="text-pulse-muted" />
              All sites breakdown
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pulse-panel border border-pulse-border text-pulse-muted">{perSiteList.length} sites</span>
            </div>
            <div className="text-[10px] text-pulse-muted font-mono">sorted by blocked count</div>
          </div>
          <div className="divide-y divide-pulse-border/30 max-h-[220px] overflow-auto">
            {perSiteList.slice(0, 15).map(s => (
              <div key={s.hostname} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-pulse-panel/30 transition-colors ${s.hostname===host ? 'bg-pulse-accent/5' : ''}`}>
                <Globe size={12} className="text-pulse-muted flex-shrink-0" />
                <span className="text-xs font-mono truncate flex-1">{s.hostname}</span>
                <div className="hidden sm:flex items-center gap-1">
                  {(['ads','analytics','social','crypto'] as const).map(c=> {
                    const n = (s.categories as any)[c];
                    if (!n) return null;
                    const m = categoryMeta(c);
                    return <span key={c} className={`text-[10px] px-1 py-0 rounded border font-mono ${m.bg} ${m.border} ${m.color}`}>{c}:{n}</span>;
                  })}
                </div>
                <span className="text-sm font-mono font-bold flex-shrink-0">{s.count}</span>
                {s.hostname===host && <span className="text-[9px] px-1 py-0 rounded bg-pulse-accent text-pulse-bg font-mono flex-shrink-0">CURRENT</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {recentGlobal.length > 0 && isNewTab && (
        <div className="bg-pulse-surface border border-pulse-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-pulse-border/50 flex items-center gap-2 text-xs font-semibold">
            <Activity size={14} className="text-pulse-muted" /> Recent blocks across all sites
          </div>
          <div className="divide-y divide-pulse-border/30 max-h-[200px] overflow-auto">
            {recentGlobal.slice(0,20).map((r, i)=> (
              <div key={i} className="px-3 py-2 flex items-center gap-2 text-[11px] font-mono">
                <span className="text-[10px] text-pulse-muted/60 flex-shrink-0 truncate max-w-[140px]">{r.siteHost}</span>
                <span className={`text-[9px] px-1 py-0 rounded border flex-shrink-0 ${categoryMeta(r.category).bg} ${categoryMeta(r.category).border} ${categoryMeta(r.category).color}`}>{r.category}</span>
                <span className="truncate flex-1 text-pulse-muted">{r.domain}</span>
                <span className="truncate hidden md:inline max-w-[280px] text-pulse-muted/50">{r.url}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-pulse-border bg-pulse-bg p-3 flex items-start gap-2.5">
        <AlertTriangle size={14} className="text-pulse-yellow flex-shrink-0 mt-0.5" />
        <div className="text-[11px] leading-relaxed text-pulse-muted">
          <span className="font-semibold text-pulse-text">No breaking changes:</span> Tor routing on <span className="font-mono text-pulse-accent">persist:main</span> still via <span className="font-mono">socks5://127.0.0.1:9150</span>, auth worker unchanged, <span className="font-mono">webview preload</span> autofill intact. Disable per-site only affects that hostname — global toggle re-registers <span className="font-mono">webRequest.onBeforeRequest</span>.
        </div>
      </div>
    </motion.div>
  );
}
