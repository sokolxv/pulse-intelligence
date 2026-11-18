import { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, Database, Radar, Search, Award, Cpu, Play, Loader } from 'lucide-react';
import Recon from './Recon';
import SubdomainEnumPage from './SubdomainEnum';
import { ALL_MODULES } from '../lib/module-loader';

type DomainTab = 'whois-dns' | 'subdomains' | 'recon' | 'intel';

const TABS: { id: DomainTab; label: string; icon: React.ReactNode }[] = [
  { id: 'whois-dns', label: 'WHOIS & DNS', icon: <Globe size={14} /> },
  { id: 'subdomains', label: 'Subdomains', icon: <Radar size={14} /> },
  { id: 'recon', label: 'Port Recon', icon: <Search size={14} /> },
  { id: 'intel', label: 'Certs & Tech', icon: <Award size={14} /> },
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

function WhoisDns() {
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [whois, setWhois] = useState<Record<string, string> | null>(null);
  const [dns, setDns] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    const d = domain.replace(/^(https?:\/\/)/, '').replace(/\/.*$/, '').trim();
    if (!d) return;
    setLoading(true);
    setError('');
    setWhois(null);
    setDns(null);
    try {
      const api: any = (window as any).electronAPI;
      if (!api?.whoisLookup || !api?.dnsResolve) throw new Error('Requires Electron runtime');
      const [w, ...recs] = await Promise.all([
        api.whoisLookup(d),
        ...['A', 'AAAA', 'MX', 'NS', 'TXT', 'SOA'].map((t) => api.dnsResolve(d, t)),
      ]);
      if (w.error && !w.data) throw new Error(cleanText(w.error));
      const parsed: Record<string, string> = {};
      cleanText(w.data || '').split('\n').forEach((line: string) => {
        const m = line.match(/^([^:]+):\s*(.+)/);
        if (m) parsed[m[1].trim()] = m[2].trim();
      });
      setWhois(parsed);
      const dparsed: Record<string, string> = {};
      const types = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'SOA'];
      recs.forEach((r: any, i: number) => {
        if (!r.error && r.records?.length > 0) {
          dparsed[types[i]] = r.records.map((x: any) => (typeof x === 'string' ? x : x.exchange ? `${x.exchange} (pri ${x.priority})` : JSON.stringify(x))).join(', ');
        }
      });
      setDns(dparsed);
    } catch (e: any) {
      setError(e.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Database size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted/60" />
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder="example.com"
            className="w-full pl-9 pr-3 py-2.5 bg-pulse-bgSoft/60 border border-pulse-border/60 rounded-xl text-sm font-mono focus:border-pulse-accent/40 outline-none"
          />
        </div>
        <button onClick={run} disabled={loading || !domain.trim()} className="flex items-center gap-2 px-5 py-2.5 bg-pulse-accent text-pulse-bg font-semibold rounded-xl text-sm hover:bg-pulse-accentSoft disabled:opacity-40 transition-colors">
          {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />} Run
        </button>
      </div>
      {error && <div className="text-xs text-pulse-red bg-pulse-red/10 border border-pulse-red/20 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-semibold text-pulse-muted uppercase tracking-wider mb-2">WHOIS</h3>
          {whois ? <KVTable data={whois} /> : <div className="text-xs text-pulse-muted">Enter a domain and click Run</div>}
        </div>
        <div>
          <h3 className="text-xs font-semibold text-pulse-muted uppercase tracking-wider mb-2">DNS records</h3>
          {dns ? <KVTable data={dns} /> : <div className="text-xs text-pulse-muted">Enter a domain and click Run</div>}
        </div>
      </div>
    </div>
  );
}

const INTEL_MODULES = ['crt_sh', 'rapiddns', 'tech_scan', 'shodan_internetdb'];

function CertsTech() {
  const mods = ALL_MODULES.filter((m) => INTEL_MODULES.includes(m.id));
  const [modId, setModId] = useState(mods[0]?.id || 'crt_sh');
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
          <Cpu size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted/60" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder="example.com or IP"
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

export default function DomainIntel() {
  const [tab, setTab] = useState<DomainTab>('whois-dns');
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Globe size={20} className="text-pulse-accent" /> Domain Intel
        </h1>
        <p className="text-xs text-pulse-muted mt-1">WHOIS, DNS, subdomains, ports and certificates — all domain vectors in one place</p>
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
        {tab === 'whois-dns' && <WhoisDns />}
        {tab === 'subdomains' && <SubdomainEnumPage />}
        {tab === 'recon' && <Recon />}
        {tab === 'intel' && <CertsTech />}
      </div>
    </motion.div>
  );
}
