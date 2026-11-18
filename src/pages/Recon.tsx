import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Globe,
  Server,
  Copy,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Play,
  Pause,
  Database,
  Shield,
  MapPin,
  Clock,
  Wifi,
  Link2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Info,
  Layers,
  Zap,
} from 'lucide-react';
import type { ReconTarget, PortInfo } from '../types';

const COMMON_PORTS: PortInfo[] = [
  { port: 21, protocol: 'tcp', service: 'ftp', state: 'closed' },
  { port: 22, protocol: 'tcp', service: 'ssh', state: 'closed' },
  { port: 23, protocol: 'tcp', service: 'telnet', state: 'closed' },
  { port: 25, protocol: 'tcp', service: 'smtp', state: 'closed' },
  { port: 53, protocol: 'tcp', service: 'dns', state: 'closed' },
  { port: 80, protocol: 'tcp', service: 'http', state: 'closed' },
  { port: 110, protocol: 'tcp', service: 'pop3', state: 'closed' },
  { port: 143, protocol: 'tcp', service: 'imap', state: 'closed' },
  { port: 443, protocol: 'tcp', service: 'https', state: 'closed' },
  { port: 445, protocol: 'tcp', service: 'microsoft-ds', state: 'closed' },
  { port: 993, protocol: 'tcp', service: 'imaps', state: 'closed' },
  { port: 995, protocol: 'tcp', service: 'pop3s', state: 'closed' },
  { port: 1433, protocol: 'tcp', service: 'mssql', state: 'closed' },
  { port: 3306, protocol: 'tcp', service: 'mysql', state: 'closed' },
  { port: 3389, protocol: 'tcp', service: 'rdp', state: 'closed' },
  { port: 5432, protocol: 'tcp', service: 'postgresql', state: 'closed' },
  { port: 5900, protocol: 'tcp', service: 'vnc', state: 'closed' },
  { port: 6379, protocol: 'tcp', service: 'redis', state: 'closed' },
  { port: 8080, protocol: 'tcp', service: 'http-proxy', state: 'closed' },
  { port: 8443, protocol: 'tcp', service: 'https-alt', state: 'closed' },
  { port: 9200, protocol: 'tcp', service: 'elasticsearch', state: 'closed' },
  { port: 27017, protocol: 'tcp', service: 'mongodb', state: 'closed' },
];

interface ReconResult {
  host: string;
  ip: string;
  reverseDns: string;
  status: 'alive' | 'dead' | 'unknown';
  ports: PortInfo[];
  dns: Record<string, string>;
  http: Record<string, string>;
  ssl: Record<string, string>;
  geo: Record<string, string>;
  ping: { reachable: boolean; avgMs: number | null; output: string };
  traceroute: string;
}

async function execCmd(command: string, timeoutMs = 10000): Promise<string> {
  if (!window.electronAPI?.execCommand) return '';
  try {
    const result = await window.electronAPI.execCommand(command, timeoutMs);
    return (result.stdout || result.stderr || '').trim();
  } catch {
    return '';
  }
}

function cleanText(text: string): string {
  return text.replace(/\?{3,}/g, '').trim();
}

export default function Recon() {
  const [target, setTarget] = useState('');
  const [scanType, setScanType] = useState('quick');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [scanning, setScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState('');
  const [result, setResult] = useState<ReconResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

  const handleStop = useCallback(() => {
    stoppedRef.current = true;
    abortRef.current?.abort();
    setScanning(false);
    setScanPhase('Остановлено');
    setProgress(0);
  }, []);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleScan = useCallback(async () => {
    if (!target.trim()) return;

    const controller = new AbortController();
    abortRef.current = controller;
    stoppedRef.current = false;
    const signal = controller.signal;
    const isStopped = () => stoppedRef.current || signal.aborted;

    setScanning(true);
    setResult(null);
    setProgress(0);
    setExpandedSections({ ports: true, dns: true });

    let hostname = target.trim();
    if (hostname.startsWith('http://') || hostname.startsWith('https://')) {
      hostname = new URL(hostname).hostname;
    }

    const recon: ReconResult = {
      host: hostname,
      ip: '-',
      reverseDns: '-',
      status: 'unknown',
      ports: [],
      dns: {},
      http: {},
      ssl: {},
      geo: {},
      ping: { reachable: false, avgMs: null, output: '' },
      traceroute: '',
    };

    // ── Phase 1: DNS Resolution ────────────────────────────
    setScanPhase('Resolving DNS...');
    setProgress(5);
    try {
      if (window.electronAPI?.dnsResolve) {
        const aResult = await window.electronAPI.dnsResolve(hostname, 'A');
        if (!aResult.error && aResult.records?.length > 0) {
          recon.ip = aResult.records[0];
        }
        // AAAA
        try {
          const aaaa = await window.electronAPI.dnsResolve(hostname, 'AAAA');
          if (!aaaa.error && aaaa.records?.length > 0) {
            recon.dns['AAAA'] = aaaa.records.join(', ');
          }
        } catch {}
        // MX
        try {
          const mx = await window.electronAPI.dnsResolve(hostname, 'MX');
          if (!mx.error && mx.records?.length > 0) {
            recon.dns['MX'] = mx.records.map((r: any) => `${r.exchange} (pri ${r.priority})`).join('\n');
          }
        } catch {}
        // NS
        try {
          const ns = await window.electronAPI.dnsResolve(hostname, 'NS');
          if (!ns.error && ns.records?.length > 0) {
            recon.dns['NS'] = ns.records.join('\n');
          }
        } catch {}
        // TXT
        try {
          const txt = await window.electronAPI.dnsResolve(hostname, 'TXT');
          if (!txt.error && txt.records?.length > 0) {
            recon.dns['TXT'] = txt.records.join('\n');
          }
        } catch {}
        // CNAME
        try {
          const cname = await window.electronAPI.dnsResolve(hostname, 'CNAME');
          if (!cname.error && cname.records?.length > 0) {
            recon.dns['CNAME'] = cname.records.join(', ');
          }
        } catch {}
        // SOA
        try {
          const soa = await window.electronAPI.dnsResolve(hostname, 'SOA');
          if (!soa.error && soa.records?.length > 0) {
            const s = soa.records[0];
            if (s) {
              recon.dns['SOA NS'] = s.nsname || '-';
              recon.dns['SOA Admin'] = s.hostmaster || '-';
              recon.dns['SOA Serial'] = s.serial ? String(s.serial) : '-';
            }
          }
        } catch {}
      }
    } catch {}

    recon.dns['A'] = recon.ip;
    if (isStopped()) return;

    // ── Phase 2: Reverse DNS ────────────────────────────────
    setScanPhase('Reverse DNS lookup...');
    setProgress(15);
    if (recon.ip !== '-' && window.electronAPI?.dnsReverse) {
      try {
        const rev = await window.electronAPI.dnsReverse(recon.ip);
        if (isStopped()) return;
        if (!rev.error && rev.hostnames?.length > 0) {
          recon.reverseDns = rev.hostnames.join(', ');
        }
      } catch {}
    }

    // ── Phase 3: Ping ──────────────────────────────────────
    setScanPhase('Pinging host...');
    setProgress(20);
    if (isStopped()) return;
    if (window.electronAPI?.pingHost) {
      try {
        const pingResult = await window.electronAPI.pingHost(hostname, 4);
        if (isStopped()) return;
        recon.ping = {
          reachable: pingResult.reachable,
          avgMs: pingResult.avgMs,
          output: pingResult.output || '',
        };
        if (pingResult.reachable) recon.status = 'alive';
      } catch {}
    }

    // ── Phase 4: Port Scan ─────────────────────────────────
    setScanPhase('Scanning ports...');
    let portsToScan: number[];
    if (scanType === 'quick') {
      portsToScan = [21, 22, 25, 53, 80, 110, 143, 443, 993, 995, 3389, 8080, 8443];
    } else if (scanType === 'full') {
      portsToScan = COMMON_PORTS.map(p => p.port);
    } else if (scanType === 'stealth') {
      portsToScan = [80, 443];
    } else {
      portsToScan = COMMON_PORTS.map(p => p.port);
    }

    setProgress(25);
    const scanResults = await window.electronAPI?.scanPorts(hostname, portsToScan, 40, 2500);
    if (isStopped()) return;
    const openPorts: PortInfo[] = [];

    if (scanResults) {
      for (let i = 0; i < scanResults.length; i++) {
        if (isStopped()) return;
        const sr = scanResults[i];
        const portInfo = COMMON_PORTS.find(p => p.port === sr.port);
        if (sr.open) {
          openPorts.push({
            port: sr.port,
            protocol: 'tcp',
            service: portInfo?.service || 'unknown',
            state: 'open',
            version: portInfo?.service || '',
          });
        }
        setProgress(25 + Math.round(((i + 1) / scanResults.length) * 30));
      }
    }

    openPorts.sort((a, b) => a.port - b.port);
    recon.ports = openPorts;
    if (isStopped()) return;
    if (recon.status === 'unknown') {
      recon.status = openPorts.length > 0 ? 'alive' : 'unknown';
    }

    // ── Phase 5: HTTP Headers ──────────────────────────────
    setScanPhase('Fetching HTTP headers...');
    setProgress(60);
    if (isStopped()) return;
    const hasHttp = openPorts.some(p => p.port === 80);
    const hasHttps = openPorts.some(p => p.port === 443);
    const scheme = hasHttps ? 'https' : 'http';

    try {
      const headers = await execCmd(`curl -s -I -L --max-time 8 "${scheme}://${hostname}"`, 10000);
      const lines = headers.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const m = line.match(/^([^:]+):\s*(.+)/);
        if (m) {
          const key = m[1].trim();
          const val = m[2].trim();
          if (['server', 'content-type', 'x-powered-by', 'x-aspnet-version', 'x-runtime',
               'strict-transport-security', 'content-security-policy', 'x-frame-options',
               'x-content-type-options', 'x-xss-protection', 'via', 'x-cache',
               'cf-ray', 'x-amz-cf-id', 'age', 'set-cookie'].includes(key.toLowerCase())) {
            recon.http[key] = val;
          }
        }
      }
      recon.http['URL'] = `${scheme}://${hostname}`;
      recon.http['Status'] = (headers.match(/HTTP\/[\d.]+\s+(\d+)/) || [])[1] || '-';
    } catch {}

    // ── Phase 6: SSL Certificate ───────────────────────────
    setScanPhase('Checking SSL certificate...');
    setProgress(70);
    if (isStopped()) return;
    if (hasHttps) {
      try {
        const cert = await execCmd(
          `echo | openssl s_client -servername ${hostname} -connect ${hostname}:443 2>/dev/null | openssl x509 -noout -subject -issuer -dates -serial -ext subjectAltName 2>/dev/null`,
          10000
        );
        const subjectM = cert.match(/subject=(.+)/);
        const issuerM = cert.match(/issuer=(.+)/);
        const notBeforeM = cert.match(/notBefore=(.+)/);
        const notAfterM = cert.match(/notAfter=(.+)/);
        const serialM = cert.match(/serial=(.+)/);
        const sanM = cert.match(/DNS:([^\s,]+)/g);

        if (subjectM) recon.ssl['Subject'] = cleanText(subjectM[1].trim());
        if (issuerM) recon.ssl['Issuer'] = cleanText(issuerM[1].trim());
        if (serialM) recon.ssl['Serial'] = serialM[1].trim();
        if (notBeforeM) recon.ssl['Valid From'] = notBeforeM[1].trim();
        if (notAfterM) {
          recon.ssl['Valid Until'] = notAfterM[1].trim();
          const expiry = new Date(notAfterM[1].trim());
          const days = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          recon.ssl['Days Left'] = days > 0 ? `${days} days` : 'EXPIRED';
        }
        if (sanM) {
          recon.ssl['SANs'] = sanM.map(s => s.replace('DNS:', '')).join(', ');
        }
      } catch {}
    }

    // ── Phase 7: GeoIP ─────────────────────────────────────
    setScanPhase('Looking up geolocation...');
    setProgress(85);
    if (isStopped()) return;
    if (recon.ip !== '-') {
      let geoDone = false;
      // Try fetch ipinfo
      try {
        const r = await fetch(`https://ipinfo.io/${recon.ip}/json`, { signal });
        if (isStopped()) return;
        if (r.ok) {
          const geo: any = await r.json();
          const filtered: Record<string, string> = {};
          if (geo.ip) filtered.IP = geo.ip;
          if (geo.city) filtered.City = geo.city;
          if (geo.region) filtered.Region = geo.region;
          if (geo.country) filtered.Country = geo.country;
          if (geo.loc) filtered.Location = geo.loc;
          if (geo.org) filtered.Organization = geo.org;
          if (geo.timezone) filtered.Timezone = geo.timezone;
          if (geo.postal) filtered.Postal = geo.postal;
          if (Object.keys(filtered).length > 0) { recon.geo = filtered; geoDone = true; }
        }
      } catch {}
      // Fallback: ip-api
      if (!geoDone) {
        if (isStopped()) return;
        try {
          const r2 = await fetch(`https://ip-api.com/json/${recon.ip}?fields=status,query,country,regionName,city,zip,lat,lon,timezone,isp,org`, { signal });
          if (isStopped()) return;
          if (r2.ok) {
            const j2: any = await r2.json();
            if (j2.status === 'success') {
              const tmp: Record<string, string> = {};
              if (j2.query) tmp.IP = j2.query;
              if (j2.city) tmp.City = j2.city;
              if (j2.regionName) tmp.Region = j2.regionName;
              if (j2.country) tmp.Country = j2.country;
              if (j2.lat && j2.lon) tmp.Location = `${j2.lat},${j2.lon}`;
              if (j2.org) tmp.Organization = j2.org;
              else if (j2.isp) tmp.Organization = j2.isp;
              if (j2.timezone) tmp.Timezone = j2.timezone;
              if (j2.zip) tmp.Postal = j2.zip;
              if (Object.keys(tmp).length > 0) { recon.geo = tmp; geoDone = true; }
            }
          }
        } catch {}
      }
      // Fallback: curl
      if (!geoDone) {
        try {
          const geoOutput = await execCmd(`curl -s "https://ipinfo.io/${recon.ip}/json"`, 8000);
          if (geoOutput) {
            const geo: any = JSON.parse(geoOutput);
            const filtered: Record<string, string> = {};
            if (geo.ip) filtered.IP = geo.ip;
            if (geo.city) filtered.City = geo.city;
            if (geo.region) filtered.Region = geo.region;
            if (geo.country) filtered.Country = geo.country;
            if (geo.loc) filtered.Location = geo.loc;
            if (geo.org) filtered.Organization = geo.org;
            if (geo.timezone) filtered.Timezone = geo.timezone;
            if (geo.postal) filtered.Postal = geo.postal;
            if (Object.keys(filtered).length > 0) recon.geo = filtered;
          }
        } catch {}
      }
    }

    // ── Phase 8: Traceroute ────────────────────────────────
    setScanPhase('Running traceroute...');
    setProgress(90);
    if (isStopped()) return;
    if (window.electronAPI?.traceroute) {
      try {
        const trResult = await window.electronAPI.traceroute(hostname);
        if (isStopped()) return;
        recon.traceroute = cleanText(trResult.data || trResult.error || '(no output)');
      } catch {}
    }

    // ── Done ───────────────────────────────────────────────
    if (isStopped()) return;
    setProgress(100);
    setScanPhase('Scan complete');
    setResult(recon);
    setScanning(false);
  }, [target, scanType]);

  const copyAll = async () => {
    if (!result) return;
    const sections: string[] = [
      `=== RECON REPORT: ${result.host} ===`,
      `IP: ${result.ip}`,
      `Reverse DNS: ${result.reverseDns}`,
      `Status: ${result.status}`,
      `Ping: ${result.ping.reachable ? `${result.ping.avgMs}ms avg` : 'unreachable'}`,
      '',
      `--- DNS Records ---`,
      ...Object.entries(result.dns).map(([k, v]) => `${k}: ${v}`),
      '',
      `--- Open Ports (${result.ports.length}) ---`,
      ...result.ports.map(p => `${p.port}/${p.protocol}  ${p.state}  ${p.service}`),
      '',
      `--- HTTP Headers ---`,
      ...Object.entries(result.http).map(([k, v]) => `${k}: ${v}`),
      '',
      `--- SSL Certificate ---`,
      ...Object.entries(result.ssl).map(([k, v]) => `${k}: ${v}`),
      '',
      `--- Geolocation ---`,
      ...Object.entries(result.geo).map(([k, v]) => `${k}: ${v}`),
      '',
      `--- Traceroute ---`,
      result.traceroute || '(not available)',
    ];
    try {
      await navigator.clipboard.writeText(sections.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Globe className="text-pulse-accent" size={22} />
            Recon & Reconnaissance
          </h1>
          <p className="text-xs text-pulse-muted mt-1">Deep target enumeration: DNS, ports, HTTP, SSL, GeoIP, traceroute</p>
        </div>
        {result && (
          <button
            onClick={copyAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel transition-all"
          >
            <Copy size={12} />
            {copied ? 'Copied!' : 'Copy Report'}
          </button>
        )}
      </div>

      {/* Target Input */}
      <div className="bg-pulse-surface border border-pulse-border rounded-xl p-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted" />
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !scanning && handleScan()}
              placeholder="Enter target (IP, domain, or hostname)..."
              className="w-full pl-10 pr-4 py-3 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
            />
          </div>
          <select
            value={scanType}
            onChange={(e) => setScanType(e.target.value)}
            className="px-4 py-3 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono text-pulse-text appearance-none cursor-pointer outline-none focus:border-pulse-accent/60 transition-colors"
          >
            <option value="quick">Quick (13 ports)</option>
            <option value="full">Full (22 ports)</option>
            <option value="stealth">Stealth (2 ports)</option>
          </select>
          {scanning ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-2 px-6 py-3 bg-pulse-red/15 text-pulse-red border border-pulse-red/25 font-semibold rounded-xl hover:bg-pulse-red/20 active:scale-[0.98] transition-all text-sm"
            >
              <Pause size={14} />
              Stop
            </button>
          ) : (
            <button
              onClick={handleScan}
              disabled={!target.trim()}
              className="flex items-center gap-2 px-6 py-3 bg-pulse-accent text-pulse-bg font-semibold rounded-xl hover:bg-pulse-accentSoft active:scale-[0.98] transition-all text-sm disabled:opacity-40"
            >
              <Play size={14} />
              Scan
            </button>
          )}
        </div>

        {/* Progress */}
        {scanning && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-pulse-muted mb-1">
              <span>{scanPhase}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-1 bg-pulse-panel rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pulse-accentDim via-pulse-accent to-pulse-accentSoft rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Presets */}
        <div className="flex gap-2 mt-3">
          {['scanme.nmap.org', 'google.com', 'github.com', 'cloudflare.com'].map((preset) => (
            <button
              key={preset}
              onClick={() => setTarget(preset)}
              className="px-3 py-1 text-[11px] font-mono bg-pulse-panel border border-pulse-border rounded-lg text-pulse-muted hover:text-pulse-text hover:border-pulse-borderStrong transition-colors"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Target Summary */}
          <div className="bg-pulse-surface border border-pulse-border rounded-xl p-4">
            <div className="flex items-center gap-4">
              <div className={`w-2.5 h-2.5 rounded-full ${result.status === 'alive' ? 'bg-pulse-green/80' : result.status === 'dead' ? 'bg-pulse-red/80' : 'bg-pulse-yellow/80'}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{result.host}</span>
                  <span className="text-xs font-mono text-pulse-muted bg-pulse-panel px-2 py-0.5 rounded">{result.ip}</span>
                  {result.reverseDns !== '-' && (
                    <span className="text-[10px] font-mono text-pulse-accent/70 bg-pulse-accent/10 px-2 py-0.5 rounded">{result.reverseDns}</span>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-2 text-[11px] text-pulse-muted flex-wrap tabular-nums">
                  <span className="flex items-center gap-1">
                    {result.ping.reachable ? <CheckCircle2 size={10} className="text-pulse-green" /> : <AlertTriangle size={10} className="text-pulse-yellow" />}
                    {result.ping.reachable ? `${result.ping.avgMs}ms avg` : 'unreachable'}
                  </span>
                  <span>{result.ports.length} open ports</span>
                  <span>{Object.keys(result.dns).length} DNS records</span>
                  {Object.keys(result.http).length > 0 && <span>HTTP {result.http['Status'] || '?'}</span>}
                  {Object.keys(result.ssl).length > 0 && <span>SSL {result.ssl['Days Left'] || ''}</span>}
                  {Object.keys(result.geo).length > 0 && <span>{result.geo['Country'] || ''}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* DNS Records */}
          {Object.keys(result.dns).length > 0 && (
            <Section
              title="DNS Records"
              icon={<Database size={14} className="text-pulse-accent" />}
              count={Object.keys(result.dns).length}
              expanded={expandedSections.dns !== false}
              onToggle={() => toggleSection('dns')}
            >
              <div className="grid grid-cols-1 gap-1.5">
                {Object.entries(result.dns).map(([key, value]) => (
                  <div key={key} className="flex gap-3 text-xs font-mono">
                    <span className="w-24 text-pulse-accent font-semibold flex-shrink-0">{key}</span>
                    <span className="text-pulse-text break-all whitespace-pre-wrap">{value}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Open Ports */}
          <Section
            title="Open Ports"
            icon={<Server size={14} className="text-pulse-green" />}
            count={result.ports.length}
            expanded={expandedSections.ports !== false}
            onToggle={() => toggleSection('ports')}
          >
            {result.ports.length === 0 ? (
              <div className="text-center text-pulse-muted text-xs py-4">No open ports detected</div>
            ) : (
              <div className="space-y-1.5">
                {result.ports.map((p) => (
                  <div key={p.port} className="flex items-center gap-3 p-2.5 bg-pulse-bg/50 rounded-xl border border-pulse-border/30 hover:bg-pulse-panel/40 transition-colors">
                    <span className="text-pulse-accent font-mono font-bold text-sm w-14">{p.port}</span>
                    <span className="text-pulse-muted font-mono text-[10px] bg-pulse-panel px-1.5 py-0.5 rounded">{p.protocol}</span>
                    <span className="text-pulse-text text-xs font-medium flex-1">{p.service}</span>
                    <span className="px-2 py-0.5 rounded-full bg-pulse-green/15 text-pulse-green text-[10px] font-medium">open</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* HTTP Headers */}
          {Object.keys(result.http).length > 0 && (
            <Section
              title="HTTP Headers"
              icon={<Link2 size={14} className="text-pulse-yellow" />}
              count={Object.keys(result.http).length}
              expanded={expandedSections.http}
              onToggle={() => toggleSection('http')}
            >
              <div className="grid grid-cols-1 gap-1.5">
                {Object.entries(result.http).map(([key, value]) => (
                  <div key={key} className="flex gap-3 text-xs font-mono">
                    <span className="w-36 text-pulse-yellow font-semibold flex-shrink-0 truncate">{key}</span>
                    <span className="text-pulse-text break-all">{value}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* SSL Certificate */}
          {Object.keys(result.ssl).length > 0 && (
            <Section
              title="SSL Certificate"
              icon={<Shield size={14} className="text-pulse-red" />}
              count={Object.keys(result.ssl).length}
              expanded={expandedSections.ssl}
              onToggle={() => toggleSection('ssl')}
            >
              <div className="grid grid-cols-1 gap-1.5">
                {Object.entries(result.ssl).map(([key, value]) => (
                  <div key={key} className="flex gap-3 text-xs font-mono">
                    <span className="w-28 text-pulse-red font-semibold flex-shrink-0">{key}</span>
                    <span className="text-pulse-text break-all">{value}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Geolocation - only where data exists */}
          {(() => {
            const geoEntries = Object.entries(result.geo).filter(([, v]) => v && String(v).trim() !== '' && String(v).trim() !== '-' && String(v).trim().toLowerCase() !== 'none');
            return geoEntries.length > 0 ? (
              <Section
                title="Geolocation"
                icon={<MapPin size={14} className="text-pulse-orange" />}
                count={geoEntries.length}
                expanded={expandedSections.geo}
                onToggle={() => toggleSection('geo')}
              >
                <div className="grid grid-cols-2 gap-2">
                  {geoEntries.map(([key, value]) => (
                    <div key={key} className="flex gap-2 text-xs font-mono p-2 bg-pulse-bg/30 rounded-lg">
                      <span className="text-pulse-orange font-semibold">{key}:</span>
                      <span className="text-pulse-text">{value}</span>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null;
          })()}

          {/* Traceroute */}
          {result.traceroute && (
            <Section
              title="Traceroute"
              icon={<Zap size={14} className="text-pulse-purple" />}
              count={result.traceroute.split('\n').length}
              expanded={expandedSections.traceroute}
              onToggle={() => toggleSection('traceroute')}
            >
              <pre className="text-[11px] font-mono text-pulse-muted whitespace-pre-wrap bg-pulse-bg/50 p-3 rounded-lg max-h-48 overflow-auto">
                {result.traceroute}
              </pre>
            </Section>
          )}
        </div>
      )}

      {/* Empty State */}
      {!result && !scanning && (
        <div className="flex flex-col items-center justify-center py-16 text-pulse-muted">
          <div className="w-20 h-20 rounded-2xl bg-pulse-panel border border-pulse-border flex items-center justify-center mb-4">
            <Globe size={32} className="text-pulse-muted opacity-40" />
          </div>
          <div className="text-sm font-medium">Enter a target to scan</div>
          <div className="text-xs mt-1 opacity-60">Supports IPs, domains, and hostnames</div>
          <div className="flex items-center gap-1.5 mt-3 text-[10px] text-pulse-muted/40">
            <Info size={10} />
            <span>Full recon: DNS + Ports + HTTP + SSL + GeoIP + Traceroute</span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Collapsible Section Component ─────────────────────────
function Section({
  title,
  icon,
  count,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-pulse-surface border border-pulse-border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-pulse-panel/30 transition-colors"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-pulse-textMuted flex-1 text-left">{title}</span>
        <span className="text-[10px] text-pulse-muted/60 bg-pulse-panel px-2 py-0.5 rounded-full tabular-nums">{count}</span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-pulse-border/30">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
