import { memo } from 'react';
import { motion } from 'framer-motion';
import {
  Globe,
  Network,
  Settings,
  Bookmark,
  Clock,
  Download,
  Key,
  Shield,
  ShieldCheck,
  Link2,
  Link,
  EyeOff,
  User,
  Server,
  Wrench,
  Shapes,
} from 'lucide-react';
import type { Page } from '../types';

interface BrowserSidebarProps {
  currentSidebarPage: Page | null;
  onNavigate: (page: Page | 'browser') => void;
  onOpenHistory: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  incognitoMode?: boolean;
}

const navItems: { id: Page; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'bookmarks', label: 'Закладки', icon: <Bookmark size={20} />, color: 'text-pulse-yellow' },
  { id: 'privacy-dashboard', label: 'Privacy', icon: <ShieldCheck size={20} />, color: 'text-pulse-green' },
  { id: 'network', label: 'Network', icon: <Network size={20} />, color: 'text-pulse-purple' },
  { id: 'domain-intel', label: 'Domain Intel', icon: <Globe size={20} />, color: 'text-pulse-accent' },
  { id: 'person-intel', label: 'Person Intel', icon: <User size={20} />, color: 'text-pulse-green' },
  { id: 'ip-intel', label: 'IP Intel', icon: <Server size={20} />, color: 'text-pulse-orange' },
  { id: 'web-intel', label: 'Web Intel', icon: <Link size={20} />, color: 'text-pulse-yellow' },
  { id: 'canvas', label: 'Canvas', icon: <Shapes size={20} />, color: 'text-pulse-accent' },
  { id: 'vuln-scanner', label: 'Vuln Scanner', icon: <Shield size={20} />, color: 'text-pulse-red' },
  { id: 'http-client', label: 'HTTP Client', icon: <Link2 size={20} />, color: 'text-pulse-yellow' },
  { id: 'cyber-tools', label: 'Cyber Tools', icon: <Wrench size={20} />, color: 'text-pulse-purple' },
  { id: 'settings', label: 'Settings', icon: <Settings size={20} />, color: 'text-pulse-muted' },
];

function BrowserSidebar({
  currentSidebarPage,
  onNavigate,
  onOpenHistory,
  incognitoMode,
}: BrowserSidebarProps) {
  const isBrowserMode = currentSidebarPage === null;

  return (
    <aside className="flex flex-col bg-pulse-bg border-r border-pulse-border/50 w-14">
      <nav className="flex flex-col items-center gap-1 py-2.5 px-2 flex-1 overflow-y-auto">
        {/* Browser button */}
        <button
          onClick={() => onNavigate('browser')}
          style={{ animationDelay: '0ms' }}
          className={`group sb-in relative w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 flex-shrink-0 active:scale-90 ${
            isBrowserMode
              ? 'bg-pulse-accent/12 text-pulse-accent shadow-glow'
              : 'text-pulse-muted hover:bg-pulse-panel/60 hover:text-pulse-cream hover:-translate-y-px'
          }`}
          title="Browser"
        >
          {isBrowserMode && (
            <motion.span
              layoutId="sidebar-active-bar"
              className="absolute left-0 top-[10px] h-5 w-[2px] rounded-full bg-pulse-accent shadow-glow"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          <span className="transition-transform duration-200 group-hover:scale-110 group-active:scale-90"><Globe size={20} /></span>
        </button>

        {/* Tool pages */}
        {navItems.map((item, i) => {
          const isActive = currentSidebarPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              style={{ animationDelay: `${(i + 1) * 40}ms` }}
              className={`group sb-in relative w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 flex-shrink-0 active:scale-90 ${
                isActive
                  ? 'bg-pulse-accent/12 text-pulse-accent shadow-glow'
                  : 'text-pulse-muted hover:bg-pulse-panel/60 hover:text-pulse-cream hover:-translate-y-px'
              }`}
              title={item.label}
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-bar"
                  className="absolute left-0 top-[10px] h-5 w-[2px] rounded-full bg-pulse-accent shadow-glow"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className={`transition-transform duration-200 group-hover:scale-110 group-active:scale-90 ${isActive ? 'text-pulse-accent' : ''}`}>{item.icon}</span>
            </button>
          );
        })}

        {/* Separator */}
        <div className="w-5 h-px bg-pulse-border/50 my-1.5 flex-shrink-0" />

        {/* Quick tools */}
        <button
          onClick={() => onNavigate('passwords')}
          style={{ animationDelay: '440ms' }}
          className={`group sb-in relative w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 flex-shrink-0 active:scale-90 ${
            currentSidebarPage === 'passwords'
              ? 'bg-pulse-accent/12 text-pulse-accent shadow-glow'
              : 'text-pulse-muted hover:bg-pulse-panel/60 hover:text-pulse-accent hover:-translate-y-px'
          }`}
          title="Password Manager"
        >
          {currentSidebarPage === 'passwords' && (
            <motion.span
              layoutId="sidebar-active-bar"
              className="absolute left-0 top-[10px] h-5 w-[2px] rounded-full bg-pulse-accent shadow-glow"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          <span className="transition-transform duration-200 group-hover:scale-110 group-active:scale-90"><Key size={18} /></span>
        </button>
        <button
          onClick={onOpenHistory}
          style={{ animationDelay: '480ms' }}
          className="group sb-in relative w-10 h-10 flex items-center justify-center rounded-xl text-pulse-muted hover:bg-pulse-panel/60 hover:text-pulse-yellow hover:-translate-y-px transition-all duration-200 flex-shrink-0 active:scale-90"
          title="History"
        >
          <span className="transition-transform duration-200 group-hover:scale-110 group-active:scale-90"><Clock size={18} /></span>
        </button>
        <button
          onClick={() => onNavigate('browser')}
          style={{ animationDelay: '520ms' }}
          className="group sb-in relative w-10 h-10 flex items-center justify-center rounded-xl text-pulse-muted hover:bg-pulse-panel/60 hover:text-pulse-purple hover:-translate-y-px transition-all duration-200 flex-shrink-0 active:scale-90"
          title="Downloads"
        >
          <span className="transition-transform duration-200 group-hover:scale-110 group-active:scale-90"><Download size={18} /></span>
        </button>
      </nav>

      {/* Incognito badge - gold */}
      {incognitoMode && (
        <div className="mx-1.5 mb-2 px-2 py-1.5 bg-pulse-accent/12 border border-pulse-accent/30 rounded-full backdrop-blur-md shadow-glow flex items-center justify-center" title="Private Mode">
          <EyeOff size={14} className="text-pulse-accent" />
        </div>
      )}
    </aside>
  );
}

export default memo(BrowserSidebar);
