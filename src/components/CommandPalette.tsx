import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Globe, Network,
  Settings, Plus, Shield, Link2, Link, Binary, Key, User, Server,
} from 'lucide-react';
import type { Page } from '../types';

const commandItems: { id: Page; label: string; icon: React.ReactNode; shortcut?: string }[] = [
  { id: 'browser', label: 'New Tab', icon: <Plus size={16} />, shortcut: '⌘T' },
  { id: 'domain-intel', label: 'Domain Intel (WHOIS, DNS, subdomains)', icon: <Globe size={16} /> },
  { id: 'person-intel', label: 'Person Intel (email, username, leaks)', icon: <User size={16} /> },
  { id: 'ip-intel', label: 'IP Intel (geo, reputation)', icon: <Server size={16} /> },
  { id: 'web-intel', label: 'Web Intel (URL, SSL, threats)', icon: <Link size={16} /> },
  { id: 'network', label: 'Network Scanner', icon: <Network size={16} /> },
  { id: 'vuln-scanner', label: 'Vulnerability Scanner', icon: <Shield size={16} />, shortcut: '⌘9' },
  { id: 'http-client', label: 'HTTP Client', icon: <Link2 size={16} /> },
  { id: 'cyber-tools', label: 'Cyber Tools', icon: <Binary size={16} /> },
  { id: 'passwords', label: 'Password Manager', icon: <Key size={16} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={16} />, shortcut: '⌘6' },
];

interface CommandPaletteProps {
  onClose: () => void;
  onNavigate: (page: Page) => void;
  onNewTab: () => void;
  onOpenNetworkGraph?: () => void;
}

export default function CommandPalette({ onClose, onNavigate, onNewTab, onOpenNetworkGraph }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = commandItems.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-xl glass rounded-2xl shadow-card overflow-hidden rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-pulse-border/60">
          <Search size={18} className="text-pulse-muted/60 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent border-0 text-[15px] text-pulse-text placeholder-pulse-muted/50 outline-none focus-visible:outline-none"
          />
          <kbd className="text-[10px] font-mono text-pulse-muted bg-pulse-panel border border-pulse-border/60 rounded-md px-1.5 py-0.5">
            ESC
          </kbd>
        </div>
        <div className="max-h-72 overflow-auto p-2">
          {filtered.map((item) => (
            <button
              key={item.id}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-pulse-panel/70 transition-colors text-left"
              onClick={() => {
                if (item.id === 'browser') {
                  onNewTab();
                } else {
                  onNavigate(item.id);
                }
                onClose();
              }}
            >
              <span className="text-pulse-muted opacity-80">{item.icon}</span>
              <span className="flex-1 text-pulse-text/90">{item.label}</span>
              {item.shortcut && (
                <kbd className="text-[10px] font-mono text-pulse-muted/70 bg-pulse-panel border border-pulse-border/50 rounded px-1.5 py-0.5 tnum">{item.shortcut}</kbd>
              )}
            </button>
          ))}
          {onOpenNetworkGraph && 'network graph requests dependencies'.includes(query.toLowerCase()) && (
            <button
              key="network-graph"
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-pulse-panel/70 transition-colors text-left"
              onClick={() => {
                onOpenNetworkGraph();
                onClose();
              }}
            >
              <span className="text-pulse-muted opacity-80"><Network size={16} /></span>
              <span className="flex-1 text-pulse-text/90">Network Graph</span>
              <kbd className="text-[10px] font-mono text-pulse-muted/70 bg-pulse-panel border border-pulse-border/50 rounded px-1.5 py-0.5 tnum">⌘⇧G</kbd>
            </button>
          )}
          {filtered.length === 0 && !(onOpenNetworkGraph && 'network graph requests dependencies'.includes(query.toLowerCase())) && (
            <div className="px-4 py-6 text-center text-pulse-muted/60 text-sm">No results found</div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
