import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Globe, Key, Wifi, FileText, Mail, Shield,
  Car, Camera, Link2, Hash, Copy, Check, Loader, Play,
  Database, Trash2, Zap,
  Radar,
} from 'lucide-react';
import { ALL_MODULES, type ModuleInfo } from '../lib/module-loader';
import { getCachedResult, setCachedResult, clearModuleCache, getCacheStats } from '../lib/module-cache';
import CyberToolsPage from './CyberTools';

const TOOL_ICONS: Record<string, React.ReactNode> = {
  crypto: <Globe size={20} />,
  ton: <Globe size={20} />,
  crypto_tx: <Link2 size={20} />,
  hash_lookup: <Hash size={20} />,
  mac_vendor: <Wifi size={20} />,
  rapiddns: <Search size={20} />,
  site_files: <FileText size={20} />,
  smtp: <Mail size={20} />,
  tech_scan: <Shield size={20} />,
  vin: <Car size={20} />,
  exif: <Camera size={20} />,
  crt_sh: <Shield size={20} />,
  shodan_internetdb: <Globe size={20} />,
  urlhaus: <Shield size={20} />,
  malwarebazaar: <Hash size={20} />,
  threatfox: <Zap size={20} />,
  emailrep: <Mail size={20} />,
  abuseipdb: <Shield size={20} />,
  greynoise: <Radar size={20} />,
};

const TOOL_COLORS: Record<string, string> = {
  crypto: 'text-pulse-accent',
  ton: 'text-pulse-accent',
  crypto_tx: 'text-pulse-green',
  hash_lookup: 'text-pulse-yellow',
  mac_vendor: 'text-pulse-green',
  rapiddns: 'text-pulse-purple',
  site_files: 'text-pulse-red',
  smtp: 'text-pulse-green',
  tech_scan: 'text-pulse-orange',
  vin: 'text-pulse-yellow',
  exif: 'text-pulse-purple',
  crt_sh: 'text-pulse-accent',
  shodan_internetdb: 'text-pulse-orange',
  urlhaus: 'text-pulse-red',
  malwarebazaar: 'text-pulse-red',
  threatfox: 'text-pulse-yellow',
  emailrep: 'text-pulse-green',
  abuseipdb: 'text-pulse-red',
  greynoise: 'text-pulse-purple',
};

export default function OSINTModulesPage() {
  const [mode, setMode] = useState<'osint' | 'cyber'>('osint');
  const [activeTool, setActiveTool] = useState<ModuleInfo>(ALL_MODULES[0]);
  const [input, setInput] = useState('');
  const [fileInput, setFileInput] = useState<File | null>(null);
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<{ tool: string; input: string; result: Record<string, any> }[]>([]);

  const [cacheStats, setCacheStats] = useState(getCacheStats());

  const handleRun = useCallback(async () => {
    if (activeTool.inputType === 'file') {
      if (!fileInput) return;
      setLoading(true);
      setResult(null);
      try {
        const res = await activeTool.run(fileInput);
        setResult(res);
        setHistory(prev => [{ tool: activeTool.name, input: fileInput.name, result: res }, ...prev].slice(0, 20));
      } catch (e: any) {
        setResult({ error: e.message });
      }
      setLoading(false);
    } else {
      if (!input.trim()) return;
      setLoading(true);
      setResult(null);

      // Check cache first
      const cached = getCachedResult(activeTool.id, input);
      if (cached) {
        setResult({ ...cached, _cached: true });
        setLoading(false);
        return;
      }

      try {
        const res = await activeTool.run(input);
        setResult(res);
        // Cache successful results (not errors/skipped)
        if (!res.error && !res.skipped) {
          setCachedResult(activeTool.id, input, res);
        }
        setHistory(prev => [{ tool: activeTool.name, input, result: res }, ...prev].slice(0, 20));
      } catch (e: any) {
        setResult({ error: e.message });
      }
      setLoading(false);
      setCacheStats(getCacheStats());
    }
  }, [activeTool, input, fileInput]);

  const copyResult = async () => {
    if (result) {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-3 h-full"
    >
      <div className="flex gap-1 p-1 bg-pulse-panel border border-pulse-border rounded-xl w-fit">
        <button onClick={() => setMode('osint')} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === 'osint' ? 'bg-pulse-surface text-pulse-accent border border-pulse-borderStrong' : 'text-pulse-muted hover:text-pulse-text'}`}>OSINT Modules ({ALL_MODULES.length})</button>
        <button onClick={() => setMode('cyber')} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === 'cyber' ? 'bg-pulse-surface text-pulse-accent border border-pulse-borderStrong' : 'text-pulse-muted hover:text-pulse-text'}`}>Cyber Tools (5)</button>
      </div>
      {mode === 'cyber' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <CyberToolsPage />
        </div>
      ) : (
        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Left: Tool List */}
          <div className="w-64 flex flex-col gap-1.5 overflow-y-auto">
        <div className="px-2 py-2 mb-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-pulse-muted uppercase tracking-wider">
              OSINT Modules ({ALL_MODULES.length})
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-pulse-muted font-mono">
                <Database size={8} className="inline" /> {cacheStats.totalEntries}
              </span>
              {cacheStats.totalEntries > 0 && (
                <button
                  onClick={() => { clearModuleCache(); setCacheStats(getCacheStats()); }}
                  className="text-[9px] text-pulse-red/60 hover:text-pulse-red transition-colors"
                  title="Clear cache"
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          </div>
        </div>
        {ALL_MODULES.map((tool) => (
          <button
            key={tool.id}
            onClick={() => { setActiveTool(tool); setResult(null); setInput(''); setFileInput(null); }}
            className={`flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
              activeTool.id === tool.id
                ? 'bg-pulse-panel border border-pulse-borderStrong'
                : 'hover:bg-pulse-surfaceHover border border-transparent'
            }`}
          >
            <span className={TOOL_COLORS[tool.id] || 'text-pulse-muted'}>
              {TOOL_ICONS[tool.id] || <Globe size={20} />}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{tool.name}</div>
              <div className="text-[10px] text-pulse-muted truncate">{tool.tags.slice(0, 3).join(', ')}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Right: Tool Panel */}
      <div className="flex-1 bg-pulse-surface border border-pulse-border rounded-xl p-5 overflow-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
              <span className={TOOL_COLORS[activeTool.id]}>
                {TOOL_ICONS[activeTool.id]}
              </span>
              {activeTool.name}
            </h2>
            <p className="text-xs text-pulse-muted mt-1">{activeTool.description}</p>
          </div>
        </div>

        {/* Input */}
        <div className="flex gap-2 mb-4">
          {activeTool.inputType === 'file' ? (
            <label className="flex-1 flex items-center gap-2 px-4 py-3 bg-pulse-bg border border-pulse-border rounded-xl text-sm cursor-pointer hover:border-pulse-borderStrong transition-colors">
              <Camera size={16} className="text-pulse-muted" />
              <span className="text-pulse-muted">
                {fileInput ? fileInput.name : activeTool.inputPlaceholder}
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setFileInput(e.target.files?.[0] || null)}
              />
            </label>
          ) : (
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRun()}
              placeholder={activeTool.inputPlaceholder}
              className="flex-1 px-4 py-3 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
              autoFocus
            />
          )}
          <button
            onClick={handleRun}
            disabled={loading || (activeTool.inputType === 'text' && !input.trim()) || (activeTool.inputType === 'file' && !fileInput)}
            className="flex items-center gap-2 px-5 py-3 bg-pulse-accent text-pulse-bg font-semibold rounded-xl hover:bg-pulse-accentSoft active:scale-[0.98] transition-all disabled:opacity-40"
          >
            {loading ? (
              <Loader size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            Run
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 bg-pulse-bg border border-pulse-border rounded-xl p-4 overflow-auto min-h-[200px]">
          {loading && (
            <div className="flex items-center justify-center h-full text-pulse-muted">
              <div className="flex items-center gap-3">
                <Loader size={20} className="animate-spin text-pulse-accent" />
                <span className="text-sm">Running {activeTool.name}...</span>
              </div>
            </div>
          )}

          {!loading && !result && (
            <div className="flex flex-col items-center justify-center h-full text-pulse-muted">
              <div className="text-4xl mb-3 opacity-20">
                {TOOL_ICONS[activeTool.id]}
              </div>
              <div className="text-sm">Enter input and click Run</div>
              <div className="text-xs mt-1 opacity-60">{activeTool.description}</div>
            </div>
          )}

          {!loading && result && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-pulse-textMuted uppercase tracking-wider">Result</span>
                  {result._cached && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-pulse-accent/10 text-pulse-accent text-[9px] rounded font-mono">
                      <Zap size={8} /> cached
                    </span>
                  )}
                </div>
                <button
                  onClick={copyResult}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel rounded transition-colors"
                >
                  {copied ? <Check size={10} className="text-pulse-green" /> : <Copy size={10} />}
                  {copied ? 'Copied' : 'Copy JSON'}
                </button>
              </div>
              <pre className="text-xs font-mono text-pulse-text whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(result, (key, val) => key === '_cached' ? undefined : val, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] text-pulse-muted uppercase tracking-wider mb-2">
              Recent ({history.length})
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const tool = ALL_MODULES.find(t => t.name === h.tool);
                    if (tool) { setActiveTool(tool); setInput(h.input); setResult(h.result); }
                  }}
                  className="flex-shrink-0 px-2 py-1 bg-pulse-panel border border-pulse-border rounded-lg text-[10px] font-mono text-pulse-muted hover:text-pulse-text hover:border-pulse-borderStrong transition-colors"
                  title={`${h.tool}: ${h.input}`}
                >
                  {h.tool}: {h.input.slice(0, 15)}{h.input.length > 15 ? '…' : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
        </div>
      )}
    </motion.div>
  );
}
