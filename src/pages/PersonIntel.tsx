import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AtSign, Loader, Mail, Play, Search, Shield, Square, User } from 'lucide-react';
import { ALL_MODULES } from '../lib/module-loader';

type PersonTab = 'email' | 'username' | 'leaks';

const TABS: { id: PersonTab; label: string; icon: React.ReactNode }[] = [
  { id: 'email', label: 'Email', icon: <Mail size={14} /> },
  { id: 'username', label: 'Username', icon: <User size={14} /> },
  { id: 'leaks', label: 'Leaks', icon: <Shield size={14} /> },
];

function cleanText(s: string): string {
  return String(s || '').replace(/\r/g, '').trim();
}

function KVTable({ data }: { data: Record<string, string> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <div className="text-xs text-pulse-muted">No data</div>;
  return (
    <div className="divide-y divide-pulse-border/30 border border-pulse-border/50 rounded-xl overflow-hidden">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-3 px-3 py-2 text-xs">
          <span className="w-40 flex-shrink-0 font-mono text-pulse-muted truncate" title={k}>{k}</span>
          <span className="flex-1 font-mono text-pulse-text break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}

function InputRunRow({
  value,
  onChange,
  placeholder,
  icon,
  loading,
  onRun,
  onStop,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon: React.ReactNode;
  loading: boolean;
  onRun: () => void;
  onStop?: () => void;
}) {
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted/60">{icon}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onRun(); }}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-2.5 bg-pulse-bgSoft/60 border border-pulse-border/60 rounded-xl text-sm font-mono focus:border-pulse-accent/40 outline-none"
        />
      </div>
      {loading && onStop ? (
        <button onClick={onStop} className="flex items-center gap-2 px-5 py-2.5 bg-pulse-red text-pulse-bg font-semibold rounded-xl text-sm hover:opacity-90 transition-colors">
          <Square size={14} /> Stop
        </button>
      ) : (
        <button onClick={onRun} disabled={loading || !value.trim()} className="flex items-center gap-2 px-5 py-2.5 bg-pulse-accent text-pulse-bg font-semibold rounded-xl text-sm hover:bg-pulse-accentSoft disabled:opacity-40 transition-colors">
          {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />} Run
        </button>
      )}
    </div>
  );
}

const DISPOSABLE_DOMAINS = ['guerrillamail.com', 'tempmail.com', 'throwaway.email', 'yopmail.com', 'mailinator.com', 'temp-mail.org', '10minutemail.com'];

function EmailIntel() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    const query = email.trim();
    if (!query) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const api: any = (window as any).electronAPI;
      if (!api?.dnsResolve) throw new Error('Requires Electron runtime');
      const domain = query.split('@')[1] || '';
      const parsed: Record<string, string> = { Email: query, Domain: domain };
      try {
        const mxResult = await api.dnsResolve(domain, 'MX');
        if (!mxResult.error && mxResult.records?.length > 0) {
          parsed['MX Records'] = mxResult.records.map((r: any) => `${r.exchange} (pri ${r.priority})`).join(', ');
        }
      } catch {}
      parsed['Disposable'] = DISPOSABLE_DOMAINS.some((d) => domain.toLowerCase().endsWith(d)) ? 'Yes' : 'No';
      try {
        const soaResult = await api.dnsResolve(domain, 'SOA');
        if (!soaResult.error && soaResult.records?.length > 0) {
          const soa = soaResult.records[0];
          if (soa) {
            parsed['Primary NS'] = soa.nsname || '-';
            parsed['Admin Email'] = soa.hostmaster || '-';
            parsed['Serial'] = soa.serial ? String(soa.serial) : '-';
          }
        }
      } catch {}
      try {
        const aResult = await api.dnsResolve(domain, 'A');
        if (!aResult.error && aResult.records?.length > 0) {
          parsed['Domain IP'] = aResult.records[0];
        }
      } catch {}
      setData(parsed);
    } catch (e: any) {
      setError(cleanText(e.message || 'Lookup failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <InputRunRow value={email} onChange={setEmail} placeholder="user@example.com" icon={<AtSign size={16} />} loading={loading} onRun={run} />
      {error && <div className="text-xs text-pulse-red bg-pulse-red/10 border border-pulse-red/20 rounded-lg px-3 py-2">{error}</div>}
      {data ? <KVTable data={data} /> : !error && <div className="text-xs text-pulse-muted">Enter an email and click Run</div>}
    </div>
  );
}

interface WmnSite {
  name: string;
  uri_check: string;
  post_body?: unknown;
  post_data?: unknown;
  method?: unknown;
}

let wmnSitesCache: WmnSite[] | null = null;

async function loadWmnSites(externalSignal?: AbortSignal): Promise<WmnSite[] | null> {
  if (wmnSitesCache) return wmnSitesCache;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const onExternalAbort = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      return null;
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const res = await fetch('https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json', { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const sites = (json as { sites?: unknown }).sites;
    if (!Array.isArray(sites)) return null;
    const filtered = (sites as Record<string, unknown>[]).filter((s) => {
      const name = s['name'];
      const uriCheck = s['uri_check'];
      if (typeof name !== 'string' || typeof uriCheck !== 'string') return false;
      if (!uriCheck.includes('{account}')) return false;
      if (s['post_body'] || s['post_data']) return false;
      const method = s['method'];
      if (typeof method === 'string' && method.toUpperCase() === 'POST') return false;
      return true;
    }) as unknown as WmnSite[];
    wmnSitesCache = filtered.slice(0, 500);
    return wmnSitesCache;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function wmnHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function UsernameIntel() {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Record<string, string> | null>(null);
  const [results, setResults] = useState<Record<string, string> | null>(null);
  const [checkedUrls, setCheckedUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const stop = () => {
    abortRef.current?.abort();
  };

  const run = async () => {
    const u = username.trim();
    if (!u) return;
    const api: any = (window as any).electronAPI;
    if (!api?.execCommand) {
      setError('Requires Electron runtime');
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');
    setSummary(null);
    setResults(null);
    setCheckedUrls({});
    try {
      const encoded = encodeURIComponent(u);
      const topPlatforms = [
        { name: 'GitHub', url: `https://github.com/${u}` },
        { name: 'GitLab', url: `https://gitlab.com/${u}` },
        { name: 'Reddit', url: `https://www.reddit.com/user/${u}` },
        { name: 'Twitter/X', url: `https://x.com/${u}` },
        { name: 'Instagram', url: `https://www.instagram.com/${u}/` },
        { name: 'YouTube', url: `https://www.youtube.com/@${u}` },
        { name: 'Twitch', url: `https://www.twitch.tv/${u}` },
        { name: 'Keybase', url: `https://keybase.io/${u}` },
        { name: 'HackerOne', url: `https://hackerone.com/${u}` },
        { name: 'TryHackMe', url: `https://tryhackme.com/p/${u}` },
      ];
      let deepList: { name: string; url: string }[] = topPlatforms;
      let profileCount = 0;
      try {
        const wmn = await loadWmnSites(ctrl.signal);
        if (ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (wmn && wmn.length > 0) {
          profileCount = wmn.length;
          const seen = new Set<string>(topPlatforms.map((p) => wmnHost(p.url)));
          const extras: { name: string; url: string }[] = [];
          for (const s of wmn) {
            if (extras.length >= 20) break;
            const url = s.uri_check.replace(/\{account\}/g, encoded);
            const host = wmnHost(url);
            if (!host || seen.has(host)) continue;
            seen.add(host);
            extras.push({ name: s.name, url });
          }
          deepList = [...topPlatforms, ...extras];
        }
      } catch {}
      const deepResults: Record<string, string> = {};
      const urls: Record<string, string> = {};
      const foundNames: string[] = [];
      for (const platform of deepList) {
        if (ctrl.signal.aborted) break;
        urls[platform.name] = platform.url;
        try {
          const out = await api.execCommand(`curl -s -o /dev/null -w "%{http_code}" -L --max-time 5 "${platform.url}"`, 8000);
          const status = cleanText(String(out?.stdout ?? out ?? ''));
          const exists = status === '200';
          deepResults[platform.name] = exists ? `Found (HTTP ${status})` : `Not found (HTTP ${status})`;
          if (exists) foundNames.push(platform.name);
        } catch {
          deepResults[platform.name] = 'Unreachable';
        }
      }
      setCheckedUrls(urls);
      setResults(deepResults);
      setSummary({
        Username: u,
        Checked: `${deepList.length} deep + ${profileCount} profile links`,
        Found: foundNames.length > 0 ? `${foundNames.length} (${foundNames.join(', ')})` : 'None',
      });
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(cleanText(e.message || 'Lookup failed'));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="space-y-4">
      <InputRunRow value={username} onChange={setUsername} placeholder="johndoe" icon={<Search size={16} />} loading={loading} onRun={run} onStop={stop} />
      {error && <div className="text-xs text-pulse-red bg-pulse-red/10 border border-pulse-red/20 rounded-lg px-3 py-2">{error}</div>}
      {summary && <KVTable data={summary} />}
      {results ? (
        <div className="divide-y divide-pulse-border/30 border border-pulse-border/50 rounded-xl overflow-hidden">
          {Object.entries(results).map(([name, status]) => {
            const found = status.toLowerCase().includes('found (http');
            return (
              <div key={name} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className="w-40 flex-shrink-0 font-mono text-pulse-muted truncate" title={name}>{name}</span>
                <span className={`flex-1 font-mono break-all ${found ? 'text-pulse-green' : 'text-pulse-text'}`}>{status}</span>
                {checkedUrls[name] && (
                  <a href={checkedUrls[name]} target="_blank" rel="noreferrer" className="text-pulse-accent hover:underline font-mono truncate max-w-[220px]" title={checkedUrls[name]}>
                    {checkedUrls[name]}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !summary && !error && <div className="text-xs text-pulse-muted">Enter a username and click Run</div>
      )}
    </div>
  );
}

function LeaksIntel() {
  const mod = ALL_MODULES.find((m) => m.id === 'emailrep');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    if (!input.trim() || !mod) return;
    setLoading(true);
    setResult(null);
    try {
      setResult(await mod.run(input.trim()));
    } catch (e: any) {
      setResult({ error: e.message || 'Module failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-pulse-muted">{mod?.description}</div>
      <InputRunRow value={input} onChange={setInput} placeholder="user@example.com" icon={<AtSign size={16} />} loading={loading} onRun={run} />
      {!mod && <div className="text-xs text-pulse-red bg-pulse-red/10 border border-pulse-red/20 rounded-lg px-3 py-2">Module 'emailrep' not found</div>}
      {result && (
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-[420px] overflow-auto p-3 bg-pulse-bg/60 rounded-lg border border-pulse-border">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

export default function PersonIntel() {
  const [tab, setTab] = useState<PersonTab>('email');
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <User size={20} className="text-pulse-accent" /> Person Intel
        </h1>
        <p className="text-xs text-pulse-muted mt-1">Email, username and leak intelligence in one place</p>
      </div>
      <div className="flex gap-1.5 p-1 bg-pulse-surface border border-pulse-border/60 rounded-xl w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${tab === t.id ? 'bg-pulse-accent/15 text-pulse-accent' : 'text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel/60'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div key={tab}>
        {tab === 'email' && <EmailIntel />}
        {tab === 'username' && <UsernameIntel />}
        {tab === 'leaks' && <LeaksIntel />}
      </div>
    </motion.div>
  );
}
