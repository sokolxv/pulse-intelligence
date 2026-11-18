import { useState, useEffect, useRef, memo } from 'react';
import {
  Minus, Square, X, Zap,
  ChevronLeft, ChevronRight, RotateCw, Home,
  Shield, Lock, Star, Eye, EyeOff,
  Globe, Copy, Check,
} from 'lucide-react';
import type { BrowserTab, SiteInfo } from '../types';
import pulseMarkUrl from '../assets/pulse-mark.svg';

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      getAdBlockerStats: () => Promise<import('../types').AdBlockerStats>;
      toggleAdBlocker: (enabled: boolean) => void;
      resetAdBlockerCount: () => void;
      execCommand: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number; duration: number }>;
      getSystemInfo: () => Promise<{ platform: string; arch: string; hostname: string; ips: Array<{ name: string; address: string; family: string; mac: string }>; gateway: string | null }>;
      getNetworkInterfaces: () => Promise<Array<{ name: string; address: string; family: string; mac: string }>>;
      getArpTable: () => Promise<{ entries: Array<{ ip: string; mac: string }>; raw: string; error?: string }>;
      dnsResolve: (hostname: string, type?: string) => Promise<{ records: any[]; type: string; error?: string }>;
      dnsReverse: (ip: string) => Promise<{ hostnames: string[]; error?: string }>;
      scanPort: (host: string, port: number, timeout?: number) => Promise<{ port: number; open: boolean; latency: number; error?: string }>;
      scanPorts: (host: string, ports: number[], concurrency?: number, timeout?: number) => Promise<Array<{ port: number; open: boolean; latency: number; error?: string }>>;
      pingHost: (host: string, count?: number) => Promise<{ reachable: boolean; output: string; avgMs: number | null }>;
      whoisLookup: (domain: string) => Promise<{ data: string; error: string | null }>;
      traceroute: (host: string) => Promise<{ data: string; error: string | null }>;
    };
  }
}

interface TitleBarProps {
  activeTab: BrowserTab;
  onNavigate: (url: string) => void;
  onGoHome: () => void;
  onNewTab: () => void;
  onRefresh: () => void;
  onBack: () => void;
  onForward: () => void;
  isSidebarPage: boolean;
  onBackToBrowser: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  incognitoMode: boolean;
  onToggleIncognito: () => void;
}

function TitleBar({
  activeTab,
  onNavigate,
  onGoHome,
  onRefresh,
  onBack,
  onForward,
  isSidebarPage,
  onBackToBrowser,
  isBookmarked,
  onToggleBookmark,
  incognitoMode,
  onToggleIncognito,
}: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [urlInput, setUrlInput] = useState(activeTab.displayUrl);
  const [urlFocused, setUrlFocused] = useState(false);
  const [siteInfoOpen, setSiteInfoOpen] = useState(false);
  const [siteInfoCopied, setSiteInfoCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const siteInfoRef = useRef<HTMLDivElement>(null);
  const prevTabIdRef = useRef(activeTab.id);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.isMaximized().then(setIsMaximized);
    }
  }, []);

  useEffect(() => {
    const handler = () => inputRef.current?.focus();
    window.addEventListener('focus-urlbar', handler);
    return () => window.removeEventListener('focus-urlbar', handler);
  }, []);

  // Sync URL input when tab changes (but not while user is typing).
  // On tab switch (activeTab.id change) sync even while focused.
  useEffect(() => {
    if (prevTabIdRef.current !== activeTab.id) {
      prevTabIdRef.current = activeTab.id;
      setUrlInput(activeTab.displayUrl);
    } else if (!urlFocused) {
      setUrlInput(activeTab.displayUrl);
    }
  }, [activeTab.id, activeTab.displayUrl, urlFocused]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput.trim()) {
      onNavigate(urlInput.trim());
      inputRef.current?.blur();
    }
  };

  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = async () => {
    window.electronAPI?.maximize();
    const max = await window.electronAPI?.isMaximized();
    setIsMaximized(max ?? false);
  };
  const handleClose = () => window.electronAPI?.close();

  const isSecure = activeTab.url.startsWith('https://');
  const isNewTab = activeTab.url === 'pulse://newtab';

  const siteInfo: SiteInfo = {
    url: activeTab.url,
    secure: isSecure,
    certIssuer: undefined,
    certSubject: (() => { try { return new URL(activeTab.url).hostname; } catch { return ''; } })(),
    certExpiry: undefined,
  };

  // Close site info on outside click
  useEffect(() => {
    if (!siteInfoOpen) return;
    const handler = (e: MouseEvent) => {
      if (siteInfoRef.current && !siteInfoRef.current.contains(e.target as Node)) {
        setSiteInfoOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [siteInfoOpen]);

  return (
    <div className={`border-b border-pulse-border chrome-grain liquid-bar ${incognitoMode ? 'bg-[#14141A]' : 'bg-pulse-surface/95 backdrop-blur-md'}`}>
      {/* Title bar row */}
      <div className="drag-region flex items-center h-8 px-2">
        <div className="flex items-center gap-1.5 no-drag">
          <img src={pulseMarkUrl} alt="Pulse" className="w-5 h-5 rounded shrink-0" />
          <span className="text-[11px] font-semibold tracking-[0.24em] text-pulse-accentSoft/90">PULSE</span>
        </div>

        {/* Title */}
        <div className="flex-1 text-center text-[11px] text-pulse-muted font-mono truncate px-4">
          {activeTab.title === 'New Tab' ? 'Pulse Browser' : activeTab.title}
        </div>

        {/* Window controls */}
        <div className="flex items-center gap-0.5 no-drag">
          <button onClick={handleMinimize} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-pulse-panelHover active:scale-90 transition-all duration-150 text-pulse-muted hover:text-pulse-text">
            <Minus size={12} />
          </button>
          <button onClick={handleMaximize} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-pulse-panelHover active:scale-90 transition-all duration-150 text-pulse-muted hover:text-pulse-text">
            <Square size={10} />
          </button>
          <button onClick={handleClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-pulse-red/15 active:scale-90 transition-all duration-150 text-pulse-muted hover:text-pulse-red">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Navigation + URL bar row */}
      <div className="flex items-center gap-1.5 px-2 pb-2 no-drag">
        {/* Back / Forward */}
        <button
          onClick={onBack}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-pulse-panelHover active:scale-90 transition-all duration-150 text-pulse-muted hover:text-pulse-creamDim disabled:opacity-30 disabled:hover:bg-transparent disabled:active:scale-100"
          disabled={!activeTab.canGoBack}
          title="Back"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={onForward}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-pulse-panelHover active:scale-90 transition-all duration-150 text-pulse-muted hover:text-pulse-creamDim disabled:opacity-30 disabled:hover:bg-transparent disabled:active:scale-100"
          disabled={!activeTab.canGoForward}
          title="Forward"
        >
          <ChevronRight size={16} />
        </button>

        {/* Refresh / Home */}
        <button
          onClick={onRefresh}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-pulse-panelHover active:scale-90 transition-all duration-150 text-pulse-muted hover:text-pulse-creamDim"
          title="Reload"
        >
          <RotateCw size={14} />
        </button>
        <button
          onClick={onGoHome}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-pulse-panelHover active:scale-90 transition-all duration-150 text-pulse-muted hover:text-pulse-creamDim"
          title="Home"
        >
          <Home size={14} />
        </button>

        {/* URL Bar */}
        <form onSubmit={handleSubmit} className="flex-1 relative">
          <div className={`field flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-200 ${
            urlFocused
              ? 'border-pulse-accent/60 shadow-glow ring-2 ring-pulse-accent/15 bg-pulse-bg'
              : 'hover:border-pulse-borderStrong'
          }`}>
            {/* Site info / Security indicator */}
            {!isNewTab && (
              <div ref={siteInfoRef} className="relative">
                <button
                  type="button"
                  onClick={() => setSiteInfoOpen(!siteInfoOpen)}
                  className="flex items-center gap-1 transition-all duration-150 hover:bg-pulse-panelHover/60 active:scale-90 rounded-full px-1.5 py-0.5"
                  title="Connection information"
                >
                  {isSecure ? (
                    <Lock size={12} className="text-pulse-green" />
                  ) : (
                    <Shield size={12} className="text-pulse-yellow" />
                  )}
                </button>
                {/* Site Info Popup */}
                {siteInfoOpen && (
                  <div className="glass chrome-grain absolute top-full left-0 mt-2 w-80 rounded-2xl shadow-card z-50 p-4 animate-fade-up">
                    <div className="flex items-center gap-2 mb-3">
                      {isSecure ? (
                        <Lock size={16} className="text-pulse-green" />
                      ) : (
                        <Shield size={16} className="text-pulse-yellow" />
                      )}
                      <span className="text-sm font-semibold">
                        {isSecure ? 'Connection is secure' : 'Connection is not secure'}
                      </span>
                    </div>
                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex justify-between">
                        <span className="text-pulse-muted">URL</span>
                        <span className="text-pulse-text truncate max-w-[200px]" title={activeTab.url}>{activeTab.url}</span>
                      </div>
                      {siteInfo.secure && (
                        <div className="flex justify-between">
                          <span className="text-pulse-muted">Issuer</span>
                          <span>{siteInfo.certIssuer ?? '—'}</span>
                        </div>
                      )}
                      {siteInfo.secure && siteInfo.certSubject && (
                        <div className="flex justify-between">
                          <span className="text-pulse-muted">Subject</span>
                          <span>{siteInfo.certSubject}</span>
                        </div>
                      )}
                      {siteInfo.secure && (
                        <div className="flex justify-between">
                          <span className="text-pulse-muted">Expires</span>
                          <span>{siteInfo.certExpiry ?? 'unknown'}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(activeTab.url);
                        setSiteInfoCopied(true);
                        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
                        copyTimerRef.current = setTimeout(() => setSiteInfoCopied(false), 1500);
                      }}
                      className="btn-ghost flex items-center gap-2 mt-3 w-full px-3 py-2 rounded-xl text-xs text-pulse-muted hover:text-pulse-creamDim active:scale-[0.98] transition-all duration-150"
                    >
                      {siteInfoCopied ? <Check size={12} className="text-pulse-green" /> : <Copy size={12} />}
                      {siteInfoCopied ? 'Copied!' : 'Copy URL'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {isNewTab && (
              <Zap size={12} className="text-pulse-accent flex-shrink-0" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={urlFocused ? urlInput : (isNewTab ? '' : activeTab.displayUrl)}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={() => {
                setUrlFocused(true);
                setUrlInput(activeTab.displayUrl);
                setTimeout(() => inputRef.current?.select(), 0);
              }}
              onBlur={() => setUrlFocused(false)}
              placeholder="Search or enter URL..."
              className="flex-1 bg-transparent text-sm font-mono text-pulse-text placeholder:text-pulse-muted/60 outline-none selection:bg-pulse-accent/25"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={onToggleBookmark}
              className={`p-1 rounded-full active:scale-90 transition-all duration-150 ${
                isBookmarked
                  ? 'text-pulse-yellow bg-pulse-yellow/10 shadow-[0_0_12px_rgba(200,168,126,0.25)]'
                  : 'text-pulse-muted hover:text-pulse-yellow hover:bg-pulse-panelHover/60'
              }`}
              title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
            >
              <Star size={14} fill={isBookmarked ? 'currentColor' : 'none'} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default memo(TitleBar);
