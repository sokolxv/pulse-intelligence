import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Send,
  Copy,
  Check,
  ChevronDown,
  Plus,
  Trash2,
  Clock,
  Zap,
  Globe,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import type { HttpRequest, HttpResponse } from '../types';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const METHOD_COLORS: Record<string, string> = {
  GET: 'text-pulse-green',
  POST: 'text-pulse-yellow',
  PUT: 'text-pulse-orange',
  PATCH: 'text-pulse-orange',
  DELETE: 'text-pulse-red',
  HEAD: 'text-pulse-accent',
  OPTIONS: 'text-pulse-purple',
};

const CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'text/plain',
  'text/xml',
  'application/xml',
  'multipart/form-data',
];

const AUTH_TYPES = [
  { id: 'none', label: 'No Auth' },
  { id: 'bearer', label: 'Bearer Token' },
  { id: 'basic', label: 'Basic Auth' },
  { id: 'api-key', label: 'API Key' },
] as const;

const HISTORY_KEY = 'pulse-http-history';

function loadHistory(): (HttpRequest & { response?: HttpResponse; timestamp: number })[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveHistory(history: (HttpRequest & { response?: HttpResponse; timestamp: number })[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
}

export default function HttpClientPage() {
  const [request, setRequest] = useState<HttpRequest>({
    method: 'GET',
    url: 'https://httpbin.org/get',
    headers: { 'User-Agent': 'PulseBrowser/1.0' },
    body: '',
    authType: 'none',
    authToken: '',
    contentType: 'application/json',
  });
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMethodDropdown, setShowMethodDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const methodDropdownRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState(loadHistory);
  const [activeTab, setActiveTab] = useState<'body' | 'headers' | 'auth'>('headers');
  const [showHistory, setShowHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const headerEntries = Object.entries(request.headers);
  const [newHeaderKey, setNewHeaderKey] = useState('');
  const [newHeaderValue, setNewHeaderValue] = useState('');

  const addHeader = () => {
    if (newHeaderKey.trim()) {
      setRequest((prev) => ({
        ...prev,
        headers: { ...prev.headers, [newHeaderKey.trim()]: newHeaderValue.trim() },
      }));
      setNewHeaderKey('');
      setNewHeaderValue('');
    }
  };

  const removeHeader = (key: string) => {
    setRequest((prev) => {
      const h = { ...prev.headers };
      delete h[key];
      return { ...prev, headers: h };
    });
  };

  const handleSend = useCallback(async () => {
    if (!request.url.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setLoading(true);
    setResponse(null);
    setError(null);

    const startTime = performance.now();

    try {
      let url = request.url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      const headers: Record<string, string> = { ...request.headers };

      // Add auth headers
      if (request.authType === 'bearer' && request.authToken) {
        headers['Authorization'] = `Bearer ${request.authToken}`;
      } else if (request.authType === 'basic' && request.authToken) {
        headers['Authorization'] = `Basic ${btoa(request.authToken)}`;
      } else if (request.authType === 'api-key' && request.authToken) {
        headers['X-API-Key'] = request.authToken;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        headers['Content-Type'] = request.contentType;
      }

      const fetchInit: RequestInit = {
        method: request.method,
        headers,
      };

      if (['POST', 'PUT', 'PATCH'].includes(request.method) && request.body) {
        fetchInit.body = request.body;
      }

      const api: any = (window as any).electronAPI;
      if (!api?.httpRequest) throw new Error('HTTP Client доступен только в Electron');
      const ipcResponse = await api.httpRequest({
        method: request.method,
        url,
        headers,
        body: fetchInit.body || '',
        timeoutMs: 15000,
      });
      if (signal.aborted) return;
      if (!ipcResponse?.ok) throw new Error(ipcResponse?.error || 'Request failed');
      const endTime = performance.now();
      const responseText = String(ipcResponse.body || '');
      const responseHeaders: Record<string, string> = ipcResponse.headers || {};

      const resp: HttpResponse = {
        status: ipcResponse.status,
        statusText: ipcResponse.statusText,
        headers: responseHeaders,
        body: responseText,
        time: Math.round(endTime - startTime),
        size: new TextEncoder().encode(responseText).length,
      };

      setResponse(resp);

      if (signal.aborted) return;
      const historyEntry = { ...request, response: resp, timestamp: Date.now() };
      setHistory((prev) => {
        const next = [historyEntry, ...prev];
        saveHistory(next);
        return next;
      });
    } catch (err: any) {
      if (signal.aborted) return;
      setError(err.message || 'Request failed');
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, [request]);

  const loadFromHistory = (entry: (typeof history)[0]) => {
    setRequest({
      method: entry.method,
      url: entry.url,
      headers: entry.headers,
      body: entry.body,
      authType: entry.authType,
      authToken: entry.authToken,
      contentType: entry.contentType,
    });
    if (entry.response) setResponse(entry.response);
    setShowHistory(false);
  };

  const copyResponse = async () => {
    if (response) {
      try {
        await navigator.clipboard.writeText(response.body);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {}
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-pulse-green';
    if (status >= 300 && status < 400) return 'text-pulse-yellow';
    if (status >= 400 && status < 500) return 'text-pulse-orange';
    return 'text-pulse-red';
  };

  const tryFormatJSON = (text: string) => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };

  // Close method dropdown on outside click
  useEffect(() => {
    if (!showMethodDropdown) return;
    const handler = (e: MouseEvent) => {
      if (methodDropdownRef.current && !methodDropdownRef.current.contains(e.target as Node)) {
        setShowMethodDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMethodDropdown]);

  // Close method dropdown on Escape
  useEffect(() => {
    if (!showMethodDropdown) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMethodDropdown(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showMethodDropdown]);

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
            <Zap className="text-pulse-accent" />
            HTTP Client
          </h1>
          <p className="text-xs text-pulse-muted mt-1">REST API tester & debug tool</p>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-pulse-panel border border-pulse-border text-pulse-muted hover:text-pulse-text transition-colors"
        >
          <Clock size={14} />
          History ({history.length})
        </button>
      </div>

      {/* History Panel */}
      {showHistory && (
        <div className="bg-pulse-surface border border-pulse-border rounded-xl max-h-48 overflow-auto">
          {history.length === 0 ? (
            <div className="p-4 text-center text-pulse-muted text-xs">No history yet</div>
          ) : (
            history.map((entry, i) => (
              <button
                key={i}
                onClick={() => loadFromHistory(entry)}
                className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-pulse-border/30 hover:bg-pulse-surfaceHover transition-colors text-left tabular-nums"
              >
                <span className={`text-xs font-mono font-bold ${METHOD_COLORS[entry.method]}`}>
                  {entry.method}
                </span>
                <span className="text-xs font-mono truncate flex-1">{entry.url}</span>
                {entry.response && (
                  <span className={`text-[10px] font-mono ${getStatusColor(entry.response.status)}`}>
                    {entry.response.status}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* URL Bar */}
      <div className="flex gap-2">
        <div className="relative" ref={methodDropdownRef}>
          <button
            onClick={() => setShowMethodDropdown(!showMethodDropdown)}
            className={`flex items-center gap-2 px-4 py-3 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono font-bold ${METHOD_COLORS[request.method]} hover:bg-pulse-panel hover:border-pulse-borderStrong transition-colors min-w-[100px]`}
          >
            {request.method}
            <ChevronDown size={14} />
          </button>
          {showMethodDropdown && (
            <div className="absolute top-full left-0 mt-1 bg-pulse-surface border border-pulse-border rounded-xl shadow-card z-50 overflow-hidden">
              {METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setRequest((prev) => ({ ...prev, method: m }));
                    setShowMethodDropdown(false);
                  }}
                  className={`w-full px-4 py-2 text-sm font-mono text-left hover:bg-pulse-panel transition-colors ${METHOD_COLORS[m]}`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="text"
          value={request.url}
          onChange={(e) => setRequest((prev) => ({ ...prev, url: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Enter request URL..."
          className="flex-1 px-4 py-3 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
        />
        {loading ? (
          <button
            onClick={handleStop}
            className="flex items-center gap-2 px-6 py-3 bg-pulse-red/15 text-pulse-red border border-pulse-red/25 font-semibold rounded-xl hover:bg-pulse-red/20 active:scale-[0.98] transition-all text-sm"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!request.url.trim()}
            className="flex items-center gap-2 px-6 py-3 bg-pulse-accent text-pulse-bg font-semibold rounded-xl hover:bg-pulse-accentSoft active:scale-[0.98] transition-all disabled:opacity-40"
          >
            <Send size={16} />
            Send
          </button>
        )}
      </div>

      {/* Request Config / Response Side by Side */}
      <div className="flex gap-4 flex-1 overflow-hidden">
        {/* Left: Request Config */}
        <div className="flex-1 bg-pulse-surface border border-pulse-border rounded-xl overflow-hidden flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-pulse-border">
            {(['headers', 'body', 'auth'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-xs font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? 'text-pulse-accent border-b-2 border-pulse-accent font-semibold'
                    : 'text-pulse-muted hover:text-pulse-text'
                }`}
              >
                {tab}
                {tab === 'headers' && headerEntries.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-pulse-panel rounded text-[10px]">
                    {headerEntries.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {activeTab === 'headers' && (
              <div className="space-y-2">
                {headerEntries.map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <input
                      value={key}
                      readOnly
                      className="flex-1 px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-xs font-mono text-pulse-accent"
                    />
                    <input
                      value={value}
                      readOnly
                      className="flex-1 px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-xs font-mono"
                    />
                    <button
                      onClick={() => removeHeader(key)}
                      className="p-2 text-pulse-muted hover:text-pulse-red hover:bg-pulse-red/10 rounded-lg transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-2">
                  <input
                    value={newHeaderKey}
                    onChange={(e) => setNewHeaderKey(e.target.value)}
                    placeholder="Key"
                    className="flex-1 px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-xs font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && addHeader()}
                  />
                  <input
                    value={newHeaderValue}
                    onChange={(e) => setNewHeaderValue(e.target.value)}
                    placeholder="Value"
                    className="flex-1 px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-xs font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && addHeader()}
                  />
                  <button
                    onClick={addHeader}
                    className="p-2 text-pulse-accent hover:bg-pulse-accent/10 rounded-lg transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'body' && (
              <div className="space-y-3">
                <select
                  value={request.contentType}
                  onChange={(e) => setRequest((prev) => ({ ...prev, contentType: e.target.value }))}
                  className="px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-xs font-mono"
                >
                  {CONTENT_TYPES.map((ct) => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
                <textarea
                  value={request.body}
                  onChange={(e) => setRequest((prev) => ({ ...prev, body: e.target.value }))}
                  placeholder='{"key": "value"}'
                  className="w-full h-64 px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-xs font-mono resize-none"
                />
              </div>
            )}

            {activeTab === 'auth' && (
              <div className="space-y-4">
                <div className="flex gap-2 flex-wrap">
                  {AUTH_TYPES.map((at) => (
                    <button
                      key={at.id}
                      onClick={() => setRequest((prev) => ({ ...prev, authType: at.id as any }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        request.authType === at.id
                          ? 'bg-pulse-surface text-pulse-accent border border-pulse-borderStrong'
                          : 'bg-pulse-panel border border-pulse-border text-pulse-muted hover:text-pulse-text hover:border-pulse-borderStrong'
                      }`}
                    >
                      {at.label}
                    </button>
                  ))}
                </div>
                {request.authType !== 'none' && (
                  <input
                    type="password"
                    value={request.authToken}
                    onChange={(e) => setRequest((prev) => ({ ...prev, authToken: e.target.value }))}
                    placeholder={
                      request.authType === 'basic'
                        ? 'username:password'
                        : request.authType === 'bearer'
                        ? 'Bearer token'
                        : 'API Key value'
                    }
                    className="w-full px-3 py-2.5 bg-pulse-bg border border-pulse-border rounded-lg text-sm font-mono"
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Response */}
        <div className="flex-1 bg-pulse-surface border border-pulse-border rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-pulse-border">
            <span className="text-xs font-semibold text-pulse-muted">Response</span>
            {response && (
                  <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
                <span className={getStatusColor(response.status)}>
                  {response.status} {response.statusText}
                </span>
                <span className="text-pulse-muted">{response.time}ms</span>
                <span className="text-pulse-muted">{formatSize(response.size)}</span>
                <button
                  onClick={copyResponse}
                  className="p-1 rounded text-pulse-muted hover:text-pulse-text transition-colors"
                >
                  {copied ? <Check size={12} className="text-pulse-green" /> : <Copy size={12} />}
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {loading && (
              <div className="flex items-center justify-center h-full text-pulse-muted">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full border-2 border-pulse-accent border-t-transparent animate-spin" />
                  <span className="text-sm">Sending request...</span>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-3 p-4 bg-pulse-red/15 border border-pulse-red/25 rounded-xl">
                <AlertTriangle size={16} className="text-pulse-red flex-shrink-0" />
                <span className="text-sm text-pulse-red">{error}</span>
              </div>
            )}
            {response && !loading && (
              <pre className="text-xs font-mono text-pulse-text whitespace-pre-wrap break-all leading-relaxed">
                {tryFormatJSON(response.body)}
              </pre>
            )}
            {!response && !loading && !error && (
              <div className="flex flex-col items-center justify-center h-full text-pulse-muted">
                <Globe size={32} className="mb-3 opacity-30" />
                <div className="text-sm">Send a request to see the response</div>
                <div className="text-xs mt-1 opacity-60">Ctrl+Enter to send quickly</div>
              </div>
            )}
          </div>

          {/* Response Headers */}
          {response && (
            <div className="border-t border-pulse-border">
              <div className="px-4 py-2">
                <span className="text-[10px] font-semibold text-pulse-muted uppercase tracking-wider">
                  Response Headers
                </span>
              </div>
              <div className="max-h-32 overflow-auto px-4 pb-3">
                {Object.entries(response.headers).map(([key, value]) => (
                  <div key={key} className="flex gap-2 text-[10px] font-mono py-0.5">
                    <span className="text-pulse-accent">{key}:</span>
                    <span className="text-pulse-muted">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
