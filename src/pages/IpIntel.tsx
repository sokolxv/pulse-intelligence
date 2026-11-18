import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, ShieldAlert, Search, Play, Loader, Square } from 'lucide-react';
import { ALL_MODULES } from '../lib/module-loader';

type IpTab = 'geolocation' | 'reputation';

const TABS: { id: IpTab; label: string; icon: React.ReactNode }[] = [
  { id: 'geolocation', label: 'Geolocation', icon: <MapPin size={14} /> },
  { id: 'reputation', label: 'Reputation', icon: <ShieldAlert size={14} /> },
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

function parseIpInfo(j: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (j == null || typeof j !== 'object') return out;
  if (j.ip != null && String(j.ip).trim()) out['IP'] = cleanText(String(j.ip));
  if (j.hostname) out['Hostname'] = cleanText(String(j.hostname));
  if (j.city) out['City'] = cleanText(String(j.city));
  if (j.region) out['Region'] = cleanText(String(j.region));
  if (j.country) out['Country'] = cleanText(String(j.country));
  if (j.loc) out['Location'] = cleanText(String(j.loc));
  if (j.org) out['Organization'] = cleanText(String(j.org));
  if (j.timezone) out['Timezone'] = cleanText(String(j.timezone));
  if (j.postal) out['Postal'] = cleanText(String(j.postal));
  return out;
}

function Geolocation() {
  const [ip, setIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, string> | null>(null);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const stop = () => {
    abortRef.current?.abort();
  };

  const run = async () => {
    const target = ip.replace(/[^0-9a-fA-F.:]/g, '').trim();
    if (!target) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');
    setData(null);
    setSource('');
    const guard = () => {
      if (abortRef.current !== ctrl || ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    };
    try {
      // 1) ipinfo.io direct
      try {
        const res = await fetch(`https://ipinfo.io/${target}/json`, { signal: ctrl.signal });
        if (res.ok) {
          const parsed = parseIpInfo(await res.json());
          if (Object.keys(parsed).length >= 2) {
            setData(parsed);
            setSource('ipinfo.io');
            return;
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError' || ctrl.signal.aborted) throw e;
      }
      // 2) ip-api.com fallback
      try {
        const res = await fetch(`https://ip-api.com/json/${target}?fields=status,message,query,country,regionName,city,zip,lat,lon,timezone,isp,org,as`, { signal: ctrl.signal });
        if (res.ok) {
          const j: any = await res.json();
          if (j && j.status === 'success') {
            const out: Record<string, string> = {};
            if (j.query) out['IP'] = cleanText(String(j.query));
            if (j.city) out['City'] = cleanText(String(j.city));
            if (j.regionName) out['Region'] = cleanText(String(j.regionName));
            if (j.country) out['Country'] = cleanText(String(j.country));
            if (j.lat != null && j.lon != null) out['Location'] = `${j.lat},${j.lon}`;
            const org = cleanText(String(j.org || j.isp || ''));
            if (org) out['Organization'] = org;
            if (j.timezone) out['Timezone'] = cleanText(String(j.timezone));
            if (j.zip) out['Postal'] = cleanText(String(j.zip));
            if (j.as) out['AS'] = cleanText(String(j.as));
            if (Object.keys(out).length > 0) {
              setData(out);
              setSource('ip-api.com');
              return;
            }
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError' || ctrl.signal.aborted) throw e;
      }
      // 3) curl via Electron (same parse as ipinfo.io)
      try {
        const api: any = (window as any).electronAPI;
        if (!api?.execCommand) throw new Error('Requires Electron runtime');
        const r: any = await api.execCommand(`curl -s "https://ipinfo.io/${target}/json"`);
        guard();
        const raw: string = typeof r === 'string' ? r : cleanText(String(r?.stdout || ''));
        if (raw) {
          const parsed = parseIpInfo(JSON.parse(raw));
          if (Object.keys(parsed).length >= 2) {
            setData(parsed);
            setSource('ipinfo.io via curl');
            return;
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError' || ctrl.signal.aborted) throw e;
      }
      // 4) reverse DNS final fallback
      const api: any = (window as any).electronAPI;
      if (!api?.dnsReverse) throw new Error('Requires Electron runtime');
      const r: any = await api.dnsReverse(target);
      guard();
      const names: string[] = Array.isArray(r?.hostnames) ? r.hostnames : [];
      if (names.length > 0) {
        setData({ IP: target, Hostnames: names.map((h) => cleanText(String(h))).join(', ') });
        setSource('reverse DNS');
        return;
      }
      if (r?.error) throw new Error(cleanText(String(r.error)));
      throw new Error('All geolocation sources failed');
    } catch (e: any) {
      if (abortRef.current !== ctrl) return;
      if (e?.name === 'AbortError' || ctrl.signal.aborted) {
        setError('Stopped');
      } else {
        setError(e?.message || 'Lookup failed');
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted/60" />
          <input
            value={ip}
            onChange={(e) => setIp(e.target.value.replace(/[^0-9a-fA-F.:]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder="8.8.8.8"
            className="w-full pl-9 pr-3 py-2.5 bg-pulse-bgSoft/60 border border-pulse-border/60 rounded-xl text-sm font-mono focus:border-pulse-accent/40 outline-none"
          />
        </div>
        <button onClick={run} disabled={loading || !ip.trim()} className="flex items-center gap-2 px-5 py-2.5 bg-pulse-accent text-pulse-bg font-semibold rounded-xl text-sm hover:bg-pulse-accentSoft disabled:opacity-40 transition-colors">
          {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />} Run
        </button>
        {loading && (
          <button onClick={stop} className="flex items-center gap-2 px-4 py-2.5 bg-pulse-red/15 border border-pulse-red/40 text-pulse-red font-semibold rounded-xl text-sm hover:bg-pulse-red/25 transition-colors">
            <Square size={14} /> Stop
          </button>
        )}
      </div>
      {error && <div className="text-xs text-pulse-red bg-pulse-red/10 border border-pulse-red/20 rounded-lg px-3 py-2">{error}</div>}
      <div>
        <h3 className="text-xs font-semibold text-pulse-muted uppercase tracking-wider mb-2">Geolocation{source ? ` · ${source}` : ''}</h3>
        {data ? <KVTable data={data} /> : (!loading && <div className="text-xs text-pulse-muted">Enter an IP and click Run</div>)}
      </div>
    </div>
  );
}

const REPUTATION_MODULE_IDS = ['abuseipdb', 'greynoise', 'shodan_internetdb'];

function Reputation() {
  const mods = REPUTATION_MODULE_IDS.flatMap((id) => ALL_MODULES.find((m) => m.id === id) ?? []);
  const [modId, setModId] = useState(mods[0]?.id || 'abuseipdb');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const mod = mods.find((m) => m.id === modId) || mods[0];

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
      <div className="flex flex-wrap gap-2">
        {mods.map((m) => (
          <button
            key={m.id}
            onClick={() => { setModId(m.id); setResult(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${modId === m.id ? 'bg-pulse-accent/15 border-pulse-accent/40 text-pulse-accent' : 'bg-pulse-panel/50 border-pulse-border/50 text-pulse-muted hover:text-pulse-text'}`}
            title={m.description}
          >
            {m.name}
          </button>
        ))}
      </div>
      <div className="text-xs text-pulse-muted">{mod?.description}</div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted/60" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder="8.8.8.8"
            className="w-full pl-9 pr-3 py-2.5 bg-pulse-bgSoft/60 border border-pulse-border/60 rounded-xl text-sm font-mono focus:border-pulse-accent/40 outline-none"
          />
        </div>
        <button onClick={run} disabled={loading || !input.trim()} className="flex items-center gap-2 px-5 py-2.5 bg-pulse-accent text-pulse-bg font-semibold rounded-xl text-sm hover:bg-pulse-accentSoft disabled:opacity-40 transition-colors">
          {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />} Run
        </button>
      </div>
      {result && (
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-[420px] overflow-auto p-3 bg-pulse-bg/60 rounded-lg border border-pulse-border">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

export default function IpIntel() {
  const [tab, setTab] = useState<IpTab>('geolocation');
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <MapPin size={20} className="text-pulse-accent" /> IP Intel
        </h1>
        <p className="text-xs text-pulse-muted mt-1">Geolocation, reputation and infrastructure of any IP in one place</p>
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
        {tab === 'geolocation' && <Geolocation />}
        {tab === 'reputation' && <Reputation />}
      </div>
    </motion.div>
  );
}
