import { useState, useCallback, useRef, useMemo, memo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Network as NetworkIcon,
  Play,
  Pause,
  RefreshCw,
  Wifi,
  Monitor,
  Router,
  Server,
  Loader,
  X,
} from 'lucide-react';
import type { NetworkNode } from '../types';

const typeIcons: Record<string, React.ReactNode> = {
  router: <Router size={24} />,
  host: <Monitor size={24} />,
  server: <Server size={24} />,
  device: <Wifi size={24} />,
};

const typeColors: Record<string, string> = {
  router: 'border-pulse-accent/40 text-pulse-accent',
  host: 'border-pulse-green/30 text-pulse-green',
  server: 'border-pulse-purple/30 text-pulse-purple',
  device: 'border-pulse-yellow/30 text-pulse-yellow',
  unknown: 'border-pulse-borderStrong text-pulse-muted',
};

function guessType(ip: string, hostname: string, mac: string): NetworkNode['type'] {
  const h = hostname.toLowerCase();
  const m = mac.toLowerCase();
  if (h.includes('router') || h.includes('gateway') || h.includes('gw') || ip.endsWith('.1')) return 'router';
  if (h.includes('server') || h.includes('nas') || h.includes('docker') || h.includes('k8s')) return 'server';
  if (h.includes('printer') || h.includes('camera') || h.includes('tv') || h.includes('chromecast')) return 'device';
  if (m.startsWith('00:50:56') || m.startsWith('00:0c:29')) return 'server';
  return 'host';
}

const Network = memo(function Network() {
  const [scanning, setScanning] = useState(false);
  const [subnet, setSubnet] = useState('');
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);
  const [nodes, setNodes] = useState<NetworkNode[]>([]);
  const [scanProgress, setScanProgress] = useState('');
  const scanRef = useRef<AbortController | null>(null);
  const [systemInfo, setSystemInfo] = useState<{ ips: Array<{ address: string; name: string }>; gateway: string | null } | null>(null);

  // Load system info on mount
  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.getSystemInfo().then((info) => {
      if (cancelled) return;
      if (info) {
        setSystemInfo({ ips: info.ips, gateway: info.gateway });
        const mainIface = (info.ips as any[]).find((i: any) => i.family === 'IPv4');
        if (mainIface) {
          const parts = String(mainIface.address).split('.');
          if (parts.length === 4) setSubnet(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`);
        }
      }
    }).catch(()=>{});
    return () => {
      cancelled = true;
    };
  }, []);

  // Abort in-flight scan on unmount
  useEffect(() => {
    return () => {
      scanRef.current?.abort();
    };
  }, []);

  const handleScan = useCallback(async () => {
    const controller = new AbortController();
    scanRef.current = controller;
    const isStopped = () => controller.signal.aborted;
    setScanning(true);
    setNodes([]);
    setScanProgress('Reading ARP table...');
    setSelectedNode(null);

    const allNodes: NetworkNode[] = [];

    // Step 1: Get ARP table (already-discovered devices)
    try {
      const arpResult = await window.electronAPI?.getArpTable();
      if (isStopped()) return;
      if (arpResult?.entries) {
        for (const entry of arpResult.entries) {
          if (isStopped()) return;
          if (entry.ip === '0.0.0.0' || entry.ip === '255.255.255.255') continue;

          // Try reverse DNS
          let hostname = '';
          try {
            const reverse = await window.electronAPI?.dnsReverse(entry.ip);
            if (isStopped()) return;
            if (reverse?.hostnames?.length) {
              hostname = reverse.hostnames[0];
            }
          } catch {}

          const type = guessType(entry.ip, hostname, entry.mac);
          allNodes.push({
            id: `node-${entry.ip}`,
            ip: entry.ip,
            mac: entry.mac,
            hostname: hostname || entry.ip,
            type,
            connections: [],
          });
        }
      }
    } catch {}

    setScanProgress(`Found ${allNodes.length} ARP entries. Pinging subnet...`);
    if (isStopped()) return;

    // Step 2: Ping sweep the subnet
    const subnetBase = subnet.replace(/\/\d+$/, '').replace(/\.\d+$/, '');
    if (subnetBase) {
      const ipsToPing: string[] = [];
      for (let i = 1; i <= 254; i++) {
        const ip = `${subnetBase}.${i}`;
        if (!allNodes.find((n) => n.ip === ip)) {
          ipsToPing.push(ip);
        }
      }

      // Ping in batches of 30
      const batchSize = 30;
      for (let i = 0; i < ipsToPing.length; i += batchSize) {
        if (isStopped()) return;
        const batch = ipsToPing.slice(i, i + batchSize);
        setScanProgress(`Pinging ${i + 1}-${Math.min(i + batchSize, ipsToPing.length)} of ${ipsToPing.length}...`);

        const results = await Promise.all(
          batch.map(async (ip) => {
            try {
              const result = await window.electronAPI?.pingHost(ip, 1);
              return { ip, reachable: result?.reachable || false };
            } catch {
              return { ip, reachable: false };
            }
          })
        );
        if (isStopped()) return;

        for (const result of results) {
          if (isStopped()) return;
          if (result.reachable && !allNodes.find((n) => n.ip === result.ip)) {
            let hostname = '';
            try {
              const reverse = await window.electronAPI?.dnsReverse(result.ip);
              if (isStopped()) return;
              if (reverse?.hostnames?.length) hostname = reverse.hostnames[0];
            } catch {}

            const type = guessType(result.ip, hostname, '');
            allNodes.push({
              id: `node-${result.ip}`,
              ip: result.ip,
              hostname: hostname || result.ip,
              type,
              connections: [],
            });
          }
        }
      }
    }

    // Step 3: Add gateway if not already present
    if (systemInfo?.gateway && !allNodes.find((n) => n.ip === systemInfo.gateway)) {
      allNodes.unshift({
        id: `node-${systemInfo.gateway}`,
        ip: systemInfo.gateway,
        hostname: 'gateway',
        type: 'router',
        connections: allNodes.map((n) => n.id),
      });
    }

    // Step 4: Mark gateway and build connections
    const gatewayNode = allNodes.find((n) => n.type === 'router');
    if (isStopped()) return;
    if (gatewayNode) {
      for (const node of allNodes) {
        if (node.id !== gatewayNode.id && !node.connections.includes(gatewayNode.id)) {
          node.connections.push(gatewayNode.id);
        }
        if (!gatewayNode.connections.includes(node.id)) {
          gatewayNode.connections.push(node.id);
        }
      }
    }

    setNodes(allNodes);
    if (isStopped()) return;
    setScanProgress(`Scan complete: ${allNodes.length} devices found`);
    setScanning(false);
  }, [subnet, systemInfo]);

  const stopScan = () => {
    scanRef.current?.abort();
    setScanning(false);
    setScanProgress('Остановлено');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex h-full gap-4"
    >
      {/* Left: Controls & Node List */}
      <div className="w-80 flex flex-col gap-4">
        {/* Scanner Controls */}
        <div className="bg-pulse-surface border border-pulse-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-pulse-muted uppercase tracking-wider mb-3 flex items-center gap-2">
            <NetworkIcon size={16} />
            Network Scanner
          </h2>
          <div className="space-y-3">
            <input
              type="text"
              value={subnet}
              onChange={(e) => setSubnet(e.target.value)}
              placeholder="Subnet (e.g. 192.168.1.0/24)..."
              className="w-full px-3 py-2.5 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { if (scanning) stopScan(); else handleScan(); }}
                disabled={!subnet.trim() && !scanning}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-40 ${
                  scanning
                    ? 'bg-pulse-red/15 text-pulse-red border border-pulse-red/25 hover:bg-pulse-red/20'
                    : 'bg-pulse-accent text-pulse-bg hover:bg-pulse-accentSoft'
                } disabled:opacity-50`}
              >
                {scanning ? <><Pause size={14} /> Stop</> : <><Play size={14} /> Scan</>}
              </button>
              <button
                onClick={handleScan}
                className="px-3 py-2.5 rounded-xl bg-pulse-panel border border-pulse-border text-pulse-muted hover:text-pulse-text hover:border-pulse-borderStrong transition-colors"
              >
                <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
              </button>
            </div>
            {scanProgress && (
              <div className="flex items-center gap-2 text-[10px] text-pulse-muted font-mono">
                {scanning && <Loader size={10} className="animate-spin text-pulse-accent" />}
                {scanProgress}
              </div>
            )}
          </div>
        </div>

        {/* Discovered Nodes */}
        <div className="flex-1 bg-pulse-surface border border-pulse-border rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-pulse-border flex items-center justify-between">
            <h3 className="text-sm font-semibold">Devices ({nodes.length})</h3>
            {nodes.length > 0 && (
              <span className="text-[10px] font-mono text-pulse-muted">
                {nodes.filter(n => n.type === 'router').length} routers, {nodes.filter(n => n.type === 'server').length} servers, {nodes.filter(n => n.type === 'host').length} hosts
              </span>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {nodes.length === 0 && !scanning && (
              <div className="flex flex-col items-center justify-center h-full text-pulse-muted text-xs p-4 text-center">
                <NetworkIcon size={32} className="mb-2 opacity-20" />
                Enter a subnet and click Scan
              </div>
            )}
            {nodes.map((node) => (
              <button
                key={node.id}
                onClick={() => setSelectedNode(node)}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b border-pulse-border/50 text-left transition-colors ${
                  selectedNode?.id === node.id
                    ? 'bg-pulse-panel border-l-2 border-l-pulse-accent/60'
                    : 'hover:bg-pulse-panel/50'
                }`}
              >
                <div className={`p-2 rounded-xl border ${typeColors[node.type] || typeColors.unknown} bg-pulse-bg`}>
                  {typeIcons[node.type] || typeIcons.host}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{node.hostname || 'Unknown'}</div>
                  <div className="text-xs font-mono text-pulse-muted">{node.ip}</div>
                </div>
                <div className="w-2 h-2 rounded-full bg-pulse-green/70" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Network Map */}
      <div className="flex-1 bg-pulse-surface border border-pulse-border rounded-xl p-4 relative overflow-hidden">
        <h2 className="text-sm font-semibold text-pulse-muted uppercase tracking-wider mb-4">
          Network Topology
        </h2>

        {nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[calc(100%-2rem)] text-pulse-muted">
            <NetworkIcon size={48} className="mb-3 opacity-10" />
            <div className="text-sm">No devices to display</div>
            <div className="text-xs mt-1 opacity-60">Run a scan to discover network devices</div>
          </div>
        ) : (
          <div className="relative h-[calc(100%-2rem)]">
            {/* Grid background */}
            <div className="absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage: 'radial-gradient(circle, #F5F5F7 1px, transparent 1px)',
                backgroundSize: '30px 30px',
              }}
            />

            {/* Nodes layout */}
            <div className="absolute inset-0 flex items-center justify-center overflow-auto p-8">
              <div className="relative" style={{ width: Math.max(500, nodes.length * 50), height: Math.max(400, nodes.length * 30) }}>
                {/* Router at center */}
                {nodes.filter(n => n.type === 'router').map((node, i) => (
                  <div key={node.id} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    <button
                      onClick={() => setSelectedNode(node)}
                      className={`w-16 h-16 rounded-xl border flex items-center justify-center bg-pulse-surface ${typeColors.router} hover:scale-105 transition-transform`}
                    >
                      <Router size={24} />
                    </button>
                    <div className="text-center mt-1 text-[10px] font-mono text-pulse-muted">{node.hostname}</div>
                  </div>
                ))}

                {/* Other nodes in a circle */}
                {nodes.filter(n => n.type !== 'router').map((node, i) => {
                  const count = nodes.filter(n => n.type !== 'router').length;
                  const angle = (i / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
                  const radius = 150 + Math.min(count * 5, 100);
                  const x = Math.cos(angle) * radius;
                  const y = Math.sin(angle) * radius;
                  return (
                    <div
                      key={node.id}
                      className="absolute left-1/2 top-1/2"
                      style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
                    >
                      <button
                        onClick={() => setSelectedNode(node)}
                        className={`w-12 h-12 rounded-xl border flex items-center justify-center bg-pulse-surface ${
                          typeColors[node.type] || typeColors.unknown
                        } hover:scale-105 transition-transform`}
                      >
                        {typeIcons[node.type] || typeIcons.host}
                      </button>
                      <div className="text-center mt-1 text-[9px] font-mono text-pulse-muted whitespace-nowrap max-w-[80px] truncate">
                        {node.hostname}
                      </div>
                    </div>
                  );
                })}

                {/* SVG lines */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
                  <defs>
                    <linearGradient id="line-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#F5F5F7" stopOpacity="0.08" />
                      <stop offset="50%" stopColor="#F5F5F7" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#F5F5F7" stopOpacity="0.08" />
                    </linearGradient>
                  </defs>
                  {nodes.filter(n => n.type === 'router').map((router) =>
                    nodes.filter(n => n.id !== router.id && n.connections.includes(router.id)).map((node, i) => {
                      const count = nodes.filter(n => n.type !== 'router').length;
                      const nodeIdx = nodes.filter(n => n.type !== 'router').findIndex(n => n.id === node.id);
                      const angle = (nodeIdx / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
                      const radius = 150 + Math.min(count * 5, 100);
                      const cx = Math.cos(angle) * radius;
                      const cy = Math.sin(angle) * radius;
                      const w = Math.max(500, nodes.length * 50);
                      const h = Math.max(400, nodes.length * 30);
                      return (
                        <line
                          key={`${router.id}-${node.id}`}
                          x1={w / 2} y1={h / 2}
                          x2={w / 2 + cx} y2={h / 2 + cy}
                          stroke="url(#line-gradient)"
                          strokeWidth="1"
                          strokeDasharray="4 4"
                        />
                      );
                    })
                  )}
                </svg>
              </div>
            </div>

            {/* Selected node detail */}
            {selectedNode && (
              <div className="absolute bottom-4 right-4 w-72 bg-pulse-surface border border-pulse-border rounded-xl p-4 shadow-card z-10">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg border ${typeColors[selectedNode.type] || typeColors.unknown} bg-pulse-surface`}>
                      {typeIcons[selectedNode.type] || typeIcons.host}
                    </div>
                    <span className="text-sm font-semibold">{selectedNode.hostname}</span>
                  </div>
                  <button onClick={() => setSelectedNode(null)} className="text-pulse-muted hover:text-pulse-text p-1 rounded hover:bg-pulse-panel"><X size={12} /></button>
                </div>
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between"><span className="text-pulse-muted">IP</span><span>{selectedNode.ip}</span></div>
                  {selectedNode.mac && <div className="flex justify-between"><span className="text-pulse-muted">MAC</span><span>{selectedNode.mac}</span></div>}
                  <div className="flex justify-between"><span className="text-pulse-muted">Type</span><span className="capitalize">{selectedNode.type}</span></div>
                  <div className="flex justify-between"><span className="text-pulse-muted">Connections</span><span>{selectedNode.connections.length}</span></div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
});

export default Network;
