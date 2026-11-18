import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe,
  Search,
  Play,
  Pause,
  Copy,
  Check,
  Wifi,
  WifiOff,
  Server,
  Filter,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Info,
  ExternalLink,
} from 'lucide-react';
import type { SubdomainEntry } from '../types';

const COMMON_SUBDOMAINS = [
  'www', 'mail', 'ftp', 'localhost', 'webmail', 'smtp', 'pop', 'ns1', 'ns2', 'ns3', 'ns4',
  'dns', 'dns1', 'dns2', 'mx', 'mx1', 'mx2', 'gateway', 'gw', 'vpn', 'proxy',
  'api', 'dev', 'stage', 'staging', 'test', 'testing', 'sandbox', 'demo',
  'admin', 'panel', 'portal', 'dashboard', 'manage', 'management', 'console',
  'app', 'apps', 'mobile', 'm', 'wap',
  'blog', 'forum', 'community', 'support', 'help', 'docs', 'wiki', 'kb',
  'cdn', 'static', 'assets', 'media', 'images', 'img', 'files', 'download',
  'db', 'database', 'sql', 'mysql', 'postgres', 'mongodb', 'redis', 'elasticsearch',
  'git', 'gitlab', 'github', 'bitbucket', 'svn', 'repo', 'repository',
  'ci', 'jenkins', 'travis', 'circleci', 'drone', 'build',
  'jira', 'confluence', 'slack', 'teams',
  'shop', 'store', 'payment', 'pay', 'checkout', 'billing',
  'auth', 'login', 'sso', 'oauth', 'id', 'identity',
  'crm', 'erp', 'hr', 'intranet', 'internal',
  'backup', 'bak', 'old', 'legacy', 'archive',
  'monitor', 'grafana', 'kibana', 'prometheus', 'nagios', 'zabbix',
  'kubernetes', 'k8s', 'docker', 'registry', 'harbor',
  'edge', 'origin', 'backend', 'lb', 'loadbalancer',
  's3', 'aws', 'gcp', 'azure', 'cloud',
  'cloudflare', 'akamai', 'fastly',
];

const QUICK_PORTS = [80, 443, 22, 8080, 8443];

export default function SubdomainEnumPage() {
  const [domain, setDomain] = useState('');
  const [subdomains, setSubdomains] = useState<SubdomainEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<'all' | 'alive' | 'dead'>('all');
  const [expandedSub, setExpandedSub] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState('');
  const scanRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      scanRef.current?.abort();
    };
  }, []);

  const handleScan = useCallback(async () => {
    if (!domain.trim()) return;

    setSubdomains([]);
    setScanning(true);
    setProgress(0);
    setScanPhase('Enumerating subdomains...');

    const controller = new AbortController();
    scanRef.current = controller;

    const baseDomain = domain.replace(/^(https?:\/\/)/, '').replace(/\/.*$/, '');
    const total = COMMON_SUBDOMAINS.length;
    const found: SubdomainEntry[] = [];

    // Phase 1: DNS brute-force via IPC
    for (let i = 0; i < total; i++) {
      if (controller.signal.aborted) break;

      const sub = COMMON_SUBDOMAINS[i];
      const fqdn = `${sub}.${baseDomain}`;

      setProgress(Math.round(((i + 1) / total) * 60));

      try {
        if (window.electronAPI?.dnsResolve) {
          const result = await window.electronAPI.dnsResolve(fqdn, 'A');
          if (controller.signal.aborted) break;
          if (!result.error && result.records?.length > 0) {
            found.push({
              subdomain: fqdn,
              ip: result.records[0] || '-',
              status: 'alive',
              ports: [],
              source: 'DNS',
            });
          } else {
            found.push({
              subdomain: fqdn,
              ip: '-',
              status: 'dead',
              ports: [],
              source: 'DNS',
            });
          }
        }
      } catch {
        if (controller.signal.aborted) break;
        found.push({
          subdomain: fqdn,
          ip: '-',
          status: 'unknown',
          ports: [],
          source: 'DNS',
        });
      }

      if (i % 5 === 0 || i === total - 1) {
        if (controller.signal.aborted) break;
        setSubdomains([...found]);
      }
    }
    if (controller.signal.aborted) return;

    // Phase 2: Port scan alive subdomains
    const aliveSubs = found.filter(s => s.status === 'alive' && s.ip !== '-');
    if (aliveSubs.length > 0 && window.electronAPI?.scanPorts) {
      setScanPhase(`Scanning ports for ${aliveSubs.length} alive hosts...`);

      for (let i = 0; i < aliveSubs.length; i++) {
        if (controller.signal.aborted) break;

        const sub = aliveSubs[i];
        setProgress(60 + Math.round(((i + 1) / aliveSubs.length) * 40));

        try {
          const portResults = await window.electronAPI.scanPorts(sub.ip, QUICK_PORTS, 10, 2000);
          if (controller.signal.aborted) break;
          if (portResults) {
            const openPorts = portResults.filter((p: any) => p.open).map((p: any) => p.port);
            sub.ports = openPorts;
          }
        } catch {}

        // Update state
        if (controller.signal.aborted) break;
        setSubdomains([...found]);
      }
    }

    if (controller.signal.aborted) return;
    setScanPhase('Scan complete');
    setScanning(false);
    setProgress(100);
  }, [domain]);

  const stopScan = () => {
    scanRef.current?.abort();
    setScanning(false);
    setScanPhase('Остановлено');
    setProgress(0);
  };

  const filteredSubdomains = subdomains.filter((s) => {
    if (filter === 'alive') return s.status === 'alive';
    if (filter === 'dead') return s.status === 'dead';
    return true;
  });

  const aliveCount = subdomains.filter((s) => s.status === 'alive').length;
  const deadCount = subdomains.filter((s) => s.status === 'dead').length;

  const copyResults = async () => {
    const text = filteredSubdomains
      .filter(s => s.status === 'alive')
      .map((s) => `${s.subdomain}\t${s.ip}\t${s.ports.length > 0 ? 'ports:' + s.ports.join(',') : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
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
      className="flex flex-col h-full gap-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Globe className="text-pulse-accent" size={22} />
            Subdomain Enumeration
          </h1>
          <p className="text-xs text-pulse-muted mt-1">DNS brute-force + port scan for alive subdomains</p>
        </div>
        {subdomains.length > 0 && (
          <button
            onClick={copyResults}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel transition-all"
          >
            <Copy size={12} />
            {copied ? 'Copied!' : 'Copy Alive'}
          </button>
        )}
      </div>

      {/* Input */}
      <div className="bg-pulse-surface border border-pulse-border rounded-xl p-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted" />
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !scanning && handleScan()}
              placeholder="Enter domain (e.g. example.com)..."
              className="w-full pl-10 pr-4 py-3 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
            />
          </div>
          {scanning ? (
            <button
              onClick={stopScan}
              className="flex items-center gap-2 px-6 py-3 bg-pulse-red/15 text-pulse-red border border-pulse-red/25 font-semibold rounded-xl hover:bg-pulse-red/20 active:scale-[0.98] transition-all text-sm"
            >
              <Pause size={14} />
              Stop
            </button>
          ) : (
            <button
              onClick={handleScan}
              disabled={!domain.trim()}
              className="flex items-center gap-2 px-6 py-3 bg-pulse-accent text-pulse-bg font-semibold rounded-xl hover:bg-pulse-accentSoft active:scale-[0.98] transition-all text-sm disabled:opacity-40"
            >
              <Play size={14} />
              Enumerate
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

        {/* Stats */}
        {subdomains.length > 0 && (
          <div className="flex gap-4 mt-3 text-[11px] font-mono">
            <span className="text-pulse-muted">Total: {subdomains.length}</span>
            <span className="text-pulse-green flex items-center gap-1"><Wifi size={10} /> Alive: {aliveCount}</span>
            <span className="text-pulse-red flex items-center gap-1"><WifiOff size={10} /> Dead: {deadCount}</span>
            {subdomains.some(s => s.ports.length > 0) && (
              <span className="text-pulse-accent flex items-center gap-1">
                <Server size={10} /> With open ports: {subdomains.filter(s => s.ports.length > 0).length}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      {subdomains.length > 0 && (
        <div className="flex-1 bg-pulse-surface border border-pulse-border rounded-xl overflow-hidden flex flex-col">
          {/* Filters */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-pulse-border">
            <div className="flex items-center gap-2">
              <Filter size={12} className="text-pulse-muted" />
              {(['all', 'alive', 'dead'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-all tabular-nums ${
                    filter === f
                      ? 'bg-pulse-accent text-pulse-bg font-semibold'
                      : 'bg-pulse-panel border border-pulse-border text-pulse-muted hover:text-pulse-text hover:border-pulse-borderStrong'
                  }`}
                >
                  {f} {f === 'alive' && `(${aliveCount})`}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-auto">
            {filteredSubdomains.filter(s => s.status === 'alive').length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-pulse-muted text-xs p-4">
                <Globe size={24} className="mb-2 opacity-20" />
                No alive subdomains found
              </div>
            )}

            {filteredSubdomains.filter(s => s.status === 'alive').map((sub) => (
              <div key={sub.subdomain} className="border-b border-pulse-border/30">
                <button
                  onClick={() => setExpandedSub(expandedSub === sub.subdomain ? null : sub.subdomain)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-pulse-panel/30 transition-colors text-left"
                >
                  <div className="w-2 h-2 rounded-full bg-pulse-green/70 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-pulse-accent">{sub.subdomain}</span>
                      {sub.ports.length > 0 && (
                        <span className="px-1.5 py-0.5 bg-pulse-accent/10 text-pulse-accent text-[9px] font-mono rounded">
                          {sub.ports.length} ports
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-pulse-muted mt-0.5">{sub.ip}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`http://${sub.subdomain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 rounded text-pulse-muted hover:text-pulse-accent transition-colors"
                      title="Open in browser"
                    >
                      <ExternalLink size={10} />
                    </a>
                    {expandedSub === sub.subdomain ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </div>
                </button>

                <AnimatePresence>
                  {expandedSub === sub.subdomain && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-3 pt-1 border-t border-pulse-border/20">
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                          <div><span className="text-pulse-muted">IP:</span> <span className="text-pulse-text">{sub.ip}</span></div>
                          <div><span className="text-pulse-muted">Source:</span> <span className="text-pulse-text">{sub.source}</span></div>
                        </div>
                        {sub.ports.length > 0 && (
                          <div className="mt-2">
                            <div className="text-[10px] text-pulse-muted mb-1">Open Ports:</div>
                            <div className="flex gap-1.5 flex-wrap">
                              {sub.ports.map(port => (
                                <span key={port} className="px-2 py-0.5 bg-pulse-green/10 text-pulse-green text-[10px] font-mono rounded-full">
                                  {port}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {subdomains.length === 0 && !scanning && (
        <div className="flex-1 flex flex-col items-center justify-center text-pulse-muted">
          <div className="w-20 h-20 rounded-2xl bg-pulse-panel border border-pulse-border flex items-center justify-center mb-4">
            <Globe size={32} className="text-pulse-muted opacity-40" />
          </div>
          <div className="text-sm font-medium">Enter a domain to discover subdomains</div>
          <div className="text-xs mt-1 opacity-60">
            DNS brute-force with {COMMON_SUBDOMAINS.length} names + port scan for alive hosts
          </div>
          <div className="flex items-center gap-1.5 mt-3 text-[10px] text-pulse-muted/40">
            <Info size={10} />
            <span>Uses Electron IPC for reliable DNS resolution</span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
