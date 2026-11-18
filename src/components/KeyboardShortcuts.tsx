import { useEffect, useRef, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Keyboard, X, Lightbulb, Zap } from 'lucide-react';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Command Palette' },
      { keys: ['⌘', 'T'], description: 'New Tab' },
      { keys: ['⌘', 'W'], description: 'Close Tab' },
      { keys: ['⌘', 'L'], description: 'Focus URL Bar' },
      { keys: ['⌘', '/'], description: 'Reload Page' },
      { keys: ['⌘', 'R'], description: 'Reload Page (alt)' },
    ],
  },
  {
    title: 'Tabs',
    shortcuts: [
      { keys: ['⌘', 'T'], description: 'New Tab' },
      { keys: ['⌘', 'W'], description: 'Close Tab' },
      { keys: ['⌘', 'Shift', 'W'], description: 'Close Other Tabs' },
      { keys: ['⌘', 'Shift', 'T'], description: 'Restore Closed Tab' },
      { keys: ['⌘', '1-9'], description: 'Switch to Tab #N' },
      { keys: ['⌘', '0'], description: 'Switch to Last Tab' },
      { keys: ['⌘', 'Tab'], description: 'Next Tab' },
      { keys: ['⌘', 'Shift', 'Tab'], description: 'Previous Tab' },
      { keys: ['Ctrl', 'Click'], description: 'Close Tab (middle-click)' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['⌘', 'D'], description: 'Toggle Bookmark' },
      { keys: ['⌘', 'F'], description: 'Find in Page' },
      { keys: ['⌘', 'K'], description: 'Command Palette' },
      { keys: ['⌘', 'L'], description: 'Focus URL Bar' },
      { keys: ['⌘', '/'], description: 'Reload Page' },
      { keys: ['F12'], description: 'Toggle DevTools' },
      { keys: ['⌘', 'Shift', 'G'], description: 'Network Graph' },
      { keys: ['⌘', '?'], description: 'Show Shortcuts' },
      { keys: ['Esc'], description: 'Close Panel / Palette' },
    ],
  },
  {
    title: 'Context Menu',
    shortcuts: [
      { keys: ['Right-Click'], description: 'Bookmark / Link / History' },
    ],
  },
];

const tips = [
  { title: 'OSINT Recon', text: 'Use the OSINT Lookup sidebar for WHOIS, DNS, GeoIP, and email intelligence on any target.' },
  { title: 'Quick Navigation', text: 'Press ⌘K to open the Command Palette — type any tool name to jump there instantly.' },
  { title: 'Password Security', text: 'The built-in password generator uses crypto.getRandomValues() for cryptographically secure randomness.' },
  { title: 'HTTP Client', text: 'The HTTP Client supports Bearer, Basic, and API Key auth — full REST API testing.' },
  { title: 'Subdomain Enum', text: 'Subdomain enumeration uses DNS brute-force with 120+ common subdomain names.' },
  { title: 'Vuln Scanner', text: 'The Vulnerability Scanner checks security headers, HTTPS config, cookies, and DNS security records.' },
  { title: 'Ad Blocker', text: 'The built-in ad blocker has 100+ filter rules — toggle it from the status bar or Settings.' },
  { title: 'Cyber Tools', text: 'Hash, encode, decode, and parse JWT tokens with the Cyber Tools panel.' },
  { title: 'New Tab', text: 'Your New Tab page has quick links to Shodan, crt.sh, Exploit-DB, and other OSINT resources.' },
  { title: 'Context Menus', text: 'Right-click bookmarks, links, and history entries for quick actions like copy URL or open in new tab.' },
  { title: 'Network Map', text: 'The Network Scanner uses real ARP table and ping sweep to discover devices on your LAN.' },
  { title: 'Tab Management', text: 'Use ⌘T for new tabs, ⌘W to close, and ⌘L to quickly jump to the URL bar.' },
  { title: 'Password Manager', text: 'Store credentials securely — passwords are shown as dots by default and can be revealed per-entry.' },
  { title: 'Browser Shortcuts', text: 'Press ⌘/ or ⌘R to reload the current page, ⌘D to bookmark it, F12 for DevTools.' },
  { title: 'Recon Scanning', text: 'The Recon tool uses real TCP connect scans via Electron — no mock data.' },
];

function pickTip(): typeof tips[number] {
  const idx = Math.floor(Math.random() * tips.length);
  return tips[idx];
}

interface KeyboardShortcutsProps {
  onClose: () => void;
}

export default function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [tip] = useState(() => pickTip());

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-2xl glass rounded-2xl shadow-card overflow-hidden rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-pulse-border/60">
          <div className="flex items-center gap-2.5">
            <Keyboard size={18} className="text-pulse-accentDim" />
            <span className="text-sm font-semibold tracking-wide">Keyboard Shortcuts</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel/70 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Shortcuts grid */}
        <div className="p-6 grid grid-cols-2 gap-6 max-h-[60vh] overflow-auto">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-[11px] font-semibold text-pulse-muted uppercase tracking-widest mb-3">
                {group.title}
              </h3>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut, i) => (
                  <div key={i} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {shortcut.keys.map((key, j) => (
                        <span key={j}>
                          <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 bg-pulse-panel border border-pulse-border/60 rounded-md shadow-sm text-[11px] font-mono tnum text-pulse-creamDim">
                            {key}
                          </kbd>
                          {j < shortcut.keys.length - 1 && (
                            <span className="text-pulse-muted/40 mx-0.5">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                    <span className="text-xs text-pulse-textMuted truncate">{shortcut.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Tip of the Day */}
        <div className="px-6 pb-4">
          <div className="flex items-start gap-3 p-4 bg-pulse-bgSoft/60 border border-pulse-border/40 rounded-xl">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-pulse-accent/10 border border-pulse-accent/15 flex items-center justify-center">
              <Lightbulb size={16} className="text-pulse-accentDim" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold text-pulse-muted uppercase tracking-widest">Tip of the Day</span>
              </div>
              <div className="text-xs font-medium text-pulse-text mb-0.5">{tip.title}</div>
              <div className="text-[11px] text-pulse-textMuted leading-relaxed">{tip.text}</div>
            </div>
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-6 py-3 border-t border-pulse-border/40 text-center">
          <span className="text-[10px] text-pulse-muted/70 font-mono tnum">
            Press <kbd className="px-1 py-0.5 bg-pulse-panel border border-pulse-border/60 rounded-md text-pulse-creamDim">⌘?</kbd> or <kbd className="px-1 py-0.5 bg-pulse-panel border border-pulse-border/60 rounded-md text-pulse-creamDim">Esc</kbd> to close
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
