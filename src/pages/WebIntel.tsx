import { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, Link, Lock, Shield, Search, Play, Loader } from 'lucide-react';
import { ALL_MODULES } from '../lib/module-loader';

type WebTab = 'url-check' | 'ssl-certs' | 'threats';

const TABS: { id: WebTab; label: string; icon: React.ReactNode }[] = [
  { id: 'url-check', label: 'URL Check', icon: <Link size={14} /> },
  { id: 'ssl-certs', label: 'SSL & Certs', icon: <Lock size={14} /> },
  { id: 'threats', label: 'Threats', icon: <Shield size={14} /> },
];

function cleanText(s: string): string {
  return String(s || '').replace(/\r/g, '').trim();
}

interface ExecResult {
  stdout?: string;
  stderr?: string;
}

async function execCmd(command: string, timeoutMs = 10000): Promise<string> {
  const api = (window as unknown as { electronAPI?: { execCommand?: (command: string, timeoutMs?: number) => Promise<ExecResult> } }).electronAPI;
  if (!api?.execCommand) throw new Error('Electron IPC not available');
  const res = await api.execCommand(command, timeoutMs);
  return cleanText(res?.stdout || res?.stderr || '');
}

function parseHeaders(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      const k = m[1].trim().toLowerCase();
      if (!(k in map)) map[k] = m[2].trim();
    }
  }
  return map;
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

function UrlCheck() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    let u = input.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const probe = await execCmd(`curl -s -o /dev/null -w "%{http_code}|%{url_effective}|%{time_total}|%{size_download}|%{content_type}|%{redirect_url}" -L --max-time 10 -I "${u}"`);
      const parts = probe.split('|');
      const redirectUrl = cleanText(parts[5] || '');
      const timeTotal = parseFloat(cleanText(parts[2] || ''));
      const out: Record<string, string> = {
        'URL': u,
        'Status': cleanText(parts[0] || '') || 'Unknown',
        'Final URL': cleanText(parts[1] || '') || u,
        'Response Time ms': Number.isFinite(timeTotal) ? `${Math.round(timeTotal * 1000)} ms` : (cleanText(parts[2] || '') || 'Unknown'),
        'Content-Type': cleanText(parts[4] || '') || 'Unknown',
        'Redirected': redirectUrl ? `Yes -> ${redirectUrl}` : 'No',
      };
      const raw = await execCmd(`curl -s -I -L --max-time 10 "${u}"`);
      const h = parseHeaders(raw);
      out['HSTS'] = h['strict-transport-security'] ? 'Yes' : 'No';
      out['CSP'] = h['content-security-policy'] || 'Not set';
      out['X-Frame-Options'] = h['x-frame-options'] || 'Not set';
      out['X-Content-Type-Options'] = h['x-content-type-options'] || 'Not set';
      out['Server'] = h['server'] || 'Not set';
      setData(out);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Check failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted/60" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder="https://example.com/page"
            className="w-full pl-9 pr-3 py-2.5 bg-pulse-bgSoft/60 border border-pulse-border/60 rounded-xl text-sm font-mono focus:border-pulse-accent/40 outline-none"
          />
        </div>
        <button onClick={run} disabled={loading || !input.trim()} className="flex items-center gap-2 px-5 py-2.5 bg-pulse-accent text-pulse-bg font-semibold rounded-xl text-sm hover:bg-pulse-accentSoft disabled:opacity-40 transition-colors">
          {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />} Run
        </button>
      </div>
      {error && <div className="text-xs text-pulse-red bg-pulse-red/10 border border-pulse-red/20 rounded-lg px-3 py-2">{error}</div>}
      <div>
        <h3 className="text-xs font-semibold text-pulse-muted uppercase tracking-wider mb-2">Result</h3>
        {data ? <KVTable data={data} /> : <div className="text-xs text-pulse-muted">Enter a URL and click Run</div>}
      </div>
    </div>
  );
}

function SslCerts() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    const d = input.replace(/^(https?:\/\/)/i, '').replace(/\/.*$/, '').trim();
    if (!d) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const raw = await execCmd(`curl -s -I -L --max-time 10 "https://${d}"`);
      const h = parseHeaders(raw);
      const out: Record<string, string> = {
        'Domain': d,
        'Protocol': 'HTTPS',
        'Server': h['server'] || 'Not set',
        'HSTS': h['strict-transport-security'] ? 'Enabled' : 'Disabled',
        'X-Frame-Options': h['x-frame-options'] || 'Not set',
        'X-Content-Type-Options': h['x-content-type-options'] || 'Not set',
        'CSP': h['content-security-policy'] ? 'Set' : 'Not set',
      };
      const certRaw = await execCmd(`echo | openssl s_client -servername ${d} -connect ${d}:443 2>/dev/null | openssl x509 -noout -subject -issuer -dates -fingerprint 2>/dev/null`);
      let subject = '';
      let issuer = '';
      let validFrom = '';
      let validUntil = '';
      let fingerprint = '';
      for (const line of certRaw.split('\n')) {
        const t = line.trim();
        const low = t.toLowerCase();
        if (low.startsWith('subject=')) subject = t.slice('subject='.length).trim();
        else if (low.startsWith('issuer=')) issuer = t.slice('issuer='.length).trim();
        else if (low.startsWith('notbefore=')) validFrom = t.slice('notbefore='.length).trim();
        else if (low.startsWith('notafter=')) validUntil = t.slice('notafter='.length).trim();
        else if (low.includes('fingerprint=')) fingerprint = t.slice(t.indexOf('=') + 1).trim();
      }
      out['Certificate Subject'] = subject || 'Unknown';
      out['Issuer'] = issuer || 'Unknown';
      out['Valid From'] = validFrom || 'Unknown';
      out['Valid Until'] = validUntil || 'Unknown';
      const exp = Date.parse(validUntil);
      out['Days Until Expiry'] = Number.isFinite(exp)
        ? (exp < Date.now() ? 'EXPIRED' : `${Math.ceil((exp - Date.now()) / 86400000)} days`)
        : 'Unknown';
      out['SHA1 Fingerprint'] = fingerprint || 'Unknown';
      setData(out);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Check failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted/60" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder="example.com"
            className="w-full pl-9 pr-3 py-2.5 bg-pulse-bgSoft/60 border border-pulse-border/60 rounded-xl text-sm font-mono focus:border-pulse-accent/40 outline-none"
          />
        </div>
        <button onClick={run} disabled={loading || !input.trim()} className="flex items-center gap-2 px-5 py-2.5 bg-pulse-accent text-pulse-bg font-semibold rounded-xl text-sm hover:bg-pulse-accentSoft disabled:opacity-40 transition-colors">
          {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />} Run
        </button>
      </div>
      {error && <div className="text-xs text-pulse-red bg-pulse-red/10 border border-pulse-red/20 rounded-lg px-3 py-2">{error}</div>}
      <div>
        <h3 className="text-xs font-semibold text-pulse-muted uppercase tracking-wider mb-2">Result</h3>
        {data ? <KVTable data={data} /> : <div className="text-xs text-pulse-muted">Enter a domain and click Run</div>}
      </div>
    </div>
  );
}

const THREAT_MODULES = ['urlhaus', 'tech_scan'];

function Threats() {
  const mods = ALL_MODULES.filter((m) => THREAT_MODULES.includes(m.id));
  const [modId, setModId] = useState<string>(mods[0]?.id || 'urlhaus');
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
    } catch (e: unknown) {
      setResult({ error: e instanceof Error ? e.message : 'Module failed' });
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
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted/60" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder="https://example.com/file.exe or example.com"
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

export default function WebIntel() {
  const [tab, setTab] = useState<WebTab>('url-check');
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Globe size={20} className="text-pulse-accent" /> Web Intel
        </h1>
        <p className="text-xs text-pulse-muted mt-1">URL safety, certificates and web threats in one place</p>
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
        {tab === 'url-check' && <UrlCheck />}
        {tab === 'ssl-certs' && <SslCerts />}
        {tab === 'threats' && <Threats />}
      </div>
    </motion.div>
  );
}
