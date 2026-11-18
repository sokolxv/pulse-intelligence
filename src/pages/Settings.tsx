import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Settings as SettingsIcon,
  Monitor,
  Shield,
  Palette,
  ShieldCheck,
  LayoutGrid,
  ImagePlus,
} from 'lucide-react';
import { loadSettings, saveSettings, type PulseSettings } from '../lib/settings-store';

interface SettingSection {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const sections: SettingSection[] = [
  { id: 'general', label: 'General', icon: <Monitor size={16} /> },
  { id: 'privacy', label: 'Ad Blocker', icon: <ShieldCheck size={16} /> },
  { id: 'security', label: 'Security', icon: <Shield size={16} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
  { id: 'newtab', label: 'New Tab', icon: <LayoutGrid size={16} /> },
];

export default function Settings() {
  const [activeSection, setActiveSection] = useState('general');
  const [settings, setSettings] = useState<PulseSettings>(() => loadSettings());

  useEffect(() => {
    saveSettings(settings);
    try { window.dispatchEvent(new CustomEvent('pulse-settings-changed', { detail: settings })); } catch {}
  }, [settings]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex gap-6 h-full"
    >
      {/* Left: Section List */}
      <div className="w-56 flex flex-col gap-1">
        <div className="flex items-center gap-2 px-3 py-2 mb-2">
          <SettingsIcon size={16} className="text-pulse-muted" />
          <span className="text-sm font-semibold">Settings</span>
        </div>
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all ${
              activeSection === section.id
                ? 'bg-pulse-panel text-pulse-accent font-medium border border-pulse-borderStrong'
                : 'text-pulse-muted hover:bg-pulse-surfaceHover hover:text-pulse-text border border-transparent'
            }`}
          >
            {section.icon}
            {section.label}
          </button>
        ))}
      </div>

      {/* Right: Settings Content */}
      <div className="flex-1 bg-pulse-surface border border-pulse-border rounded-xl p-6 overflow-auto">
        {activeSection === 'general' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold tracking-tight mb-4">General Settings</h2>
              <div className="space-y-4">
                <SettingToggle
                  label="Auto-update"
                  description="Automatically check for updates"
                  checked={settings.general.autoUpdate}
                  onChange={(v) => setSettings((prev) => ({ ...prev, general: { ...prev.general, autoUpdate: v } }))}
                />
                <SettingToggle
                  label="Telemetry"
                  description="Send anonymous usage data"
                  checked={settings.general.telemetry}
                  onChange={(v) => setSettings((prev) => ({ ...prev, general: { ...prev.general, telemetry: v } }))}
                />
                <SettingToggle
                  label="Show notifications"
                  description="Display scan completion alerts"
                  checked={settings.general.showNotifications}
                  onChange={(v) => setSettings((prev) => ({ ...prev, general: { ...prev.general, showNotifications: v } }))}
                />
                <SettingToggle
                  label="Remember sessions"
                  description="Save terminal and scan history"
                  checked={settings.general.rememberSessions}
                  onChange={(v) => setSettings((prev) => ({ ...prev, general: { ...prev.general, rememberSessions: v } }))}
                />
              </div>
            </div>
          </div>
        )}

        {activeSection === 'privacy' && <AdBlockerSettings />}

        {activeSection === 'security' && (
          <div className="space-y-6">
            <h2 className="text-base font-semibold tracking-tight mb-4">Security Settings</h2>
            <div className="space-y-4">
              <SettingToggle
                label="Stealth mode"
                description="Use randomized user agents and timing"
                checked={settings.security.stealthMode}
                onChange={(v) => setSettings((prev) => ({ ...prev, security: { ...prev.security, stealthMode: v } }))}
              />
              <SettingToggle
                label="MAC randomization"
                description="Spoof MAC address during scans"
                checked={settings.security.macRandomization}
                onChange={(v) => setSettings((prev) => ({ ...prev, security: { ...prev.security, macRandomization: v } }))}
              />
              <SettingToggle
                label="Scan detection avoidance"
                description="Rate-limit and randomize scan timing"
                checked={settings.security.scanAvoidance}
                onChange={(v) => setSettings((prev) => ({ ...prev, security: { ...prev.security, scanAvoidance: v } }))}
              />
              <SettingInput
                label="Custom User-Agent"
                placeholder="Mozilla/5.0 ..."
                value={settings.security.customUserAgent}
                onChange={(v) => setSettings((prev) => ({ ...prev, security: { ...prev.security, customUserAgent: v } }))}
              />
            </div>
          </div>
        )}

        {activeSection === 'appearance' && (
          <div className="space-y-6">
            <h2 className="text-base font-semibold tracking-tight mb-4">Appearance</h2>
            <div className="space-y-4">
              <SettingToggle
                label="Animations"
                description="Enable UI animations"
                checked={settings.appearance.animations}
                onChange={(v) => setSettings((prev) => ({ ...prev, appearance: { ...prev.appearance, animations: v } }))}
              />
              <SettingToggle
                label="Compact mode"
                description="Reduce spacing and padding"
                checked={settings.appearance.compactMode}
                onChange={(v) => setSettings((prev) => ({ ...prev, appearance: { ...prev.appearance, compactMode: v } }))}
              />
            </div>
          </div>
        )}

        {activeSection === 'newtab' && (
          <div className="space-y-6">
            <h2 className="text-base font-semibold tracking-tight mb-4">New Tab</h2>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-pulse-muted mb-2">Wallpaper</div>
              <div className="grid grid-cols-6 gap-2 mb-4">
                {(
                  [
                    { id: 'obsidian', style: { background: 'radial-gradient(circle at 50% 30%, #F5F5F7 0%, #0A0A0C 70%)' } },
                    { id: 'ember', style: { background: 'radial-gradient(circle at 50% 30%, rgba(185,127,112,0.25) 0%, #2A1610 70%)' } },
                    { id: 'abyss', style: { background: 'radial-gradient(circle at 50% 30%, rgba(91,122,153,0.25) 0%, #0B1220 70%)' } },
                    { id: 'dune', style: { background: 'radial-gradient(circle at 50% 30%, rgba(200,168,126,0.22) 0%, #171310 70%)' } },
                    { id: 'nebula', style: { background: 'radial-gradient(circle at 50% 30%, rgba(167,155,178,0.22) 0%, #12101A 70%)' } },
                  ] as const
                ).map((w) => (
                  <button
                    key={w.id}
                    onClick={() => setSettings((prev) => ({ ...prev, newtab: { ...prev.newtab, wallpaper: w.id } }))}
                    title={w.id}
                    style={w.style}
                    className={`w-16 h-10 rounded-lg border border-pulse-border transition-all ${
                      settings.newtab.wallpaper === w.id ? 'ring-2 ring-pulse-accent' : 'hover:border-pulse-borderStrong'
                    }`}
                  />
                ))}
                <button
                  onClick={() => setSettings((prev) => ({ ...prev, newtab: { ...prev.newtab, wallpaper: 'custom' } }))}
                  title="custom"
                  className={`w-16 h-10 rounded-lg border border-pulse-border bg-pulse-panel flex items-center justify-center text-pulse-muted transition-all ${
                    settings.newtab.wallpaper === 'custom' ? 'ring-2 ring-pulse-accent' : 'hover:border-pulse-borderStrong'
                  }`}
                >
                  <ImagePlus size={16} />
                </button>
              </div>
              <SettingInput
                label="Custom wallpaper URL"
                placeholder="https://..."
                value={settings.newtab.customWallpaper}
                onChange={(v) => setSettings((prev) => ({ ...prev, newtab: { ...prev.newtab, customWallpaper: v } }))}
              />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-pulse-muted mb-2">Search bar</div>
              <div className="space-y-2">
                <div className="flex gap-1 bg-pulse-panel rounded-xl p-1">
                  {(
                    [
                      { id: 'top', label: 'Top' },
                      { id: 'center', label: 'Center' },
                      { id: 'bottom', label: 'Bottom' },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setSettings((prev) => ({ ...prev, newtab: { ...prev.newtab, searchPosition: o.id } }))}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-sm transition-all ${
                        settings.newtab.searchPosition === o.id
                          ? 'bg-pulse-surface text-pulse-accentSoft'
                          : 'text-pulse-muted hover:text-pulse-text'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 bg-pulse-panel rounded-xl p-1">
                  {(
                    [
                      { id: 'sm', label: 'S' },
                      { id: 'md', label: 'M' },
                      { id: 'lg', label: 'L' },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setSettings((prev) => ({ ...prev, newtab: { ...prev.newtab, searchSize: o.id } }))}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-sm transition-all ${
                        settings.newtab.searchSize === o.id
                          ? 'bg-pulse-surface text-pulse-accentSoft'
                          : 'text-pulse-muted hover:text-pulse-text'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <SettingToggle
                label="Show logo"
                description="Display logo on the new tab page"
                checked={settings.newtab.showLogo}
                onChange={(v) => setSettings((prev) => ({ ...prev, newtab: { ...prev.newtab, showLogo: v } }))}
              />
              <SettingToggle
                label="Show shortcuts"
                description="Display shortcut tiles on the new tab page"
                checked={settings.newtab.showShortcuts}
                onChange={(v) => setSettings((prev) => ({ ...prev, newtab: { ...prev.newtab, showShortcuts: v } }))}
              />
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Ad Blocker Settings ────────────────────────────────
function AdBlockerSettings() {
  const [stats, setStats] = useState<import('../types').AdBlockerStats>({
    enabled: true,
    blockCount: 0,
    filterCount: 0,
  });

  // Load stats on mount
  useEffect(() => {
    (async () => {
      if (window.electronAPI) {
        const s = await window.electronAPI.getAdBlockerStats();
        setStats(s);
      }
    })();
  }, []);

  const handleToggle = (enabled: boolean) => {
    setStats((prev) => ({ ...prev, enabled }));
    window.electronAPI?.toggleAdBlocker(enabled);
  };

  const handleReset = () => {
    window.electronAPI?.resetAdBlockerCount();
    setStats((prev) => ({ ...prev, blockCount: 0 }));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <ShieldCheck size={20} className="text-pulse-accent" />
        Ad & Tracker Blocker
      </h2>

      {/* Toggle */}
      <div className="bg-pulse-bg border border-pulse-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Block ads & trackers</div>
            <div className="text-xs text-pulse-muted">
              Intercepts network requests to known ad servers and tracking domains
            </div>
          </div>
          <button
            onClick={() => handleToggle(!stats.enabled)}
            className={`w-12 h-6 rounded-full transition-all ${
              stats.enabled ? 'bg-pulse-accent' : 'bg-pulse-panel border border-pulse-border'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white transition-transform mt-0.5 ${
                stats.enabled ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-pulse-bg border border-pulse-border rounded-xl p-4">
          <div className="text-2xl font-bold font-mono text-pulse-green">{stats.blockCount}</div>
          <div className="text-xs text-pulse-muted mt-1">Requests blocked</div>
        </div>
        <div className="bg-pulse-bg border border-pulse-border rounded-xl p-4">
          <div className="text-2xl font-bold font-mono text-pulse-accent">{stats.filterCount}</div>
          <div className="text-xs text-pulse-muted mt-1">Filter rules</div>
        </div>
        <div className="bg-pulse-bg border border-pulse-border rounded-xl p-4">
          <div className={`text-2xl font-bold font-mono ${stats.enabled ? 'text-pulse-green' : 'text-pulse-red'}`}>
            {stats.enabled ? 'ON' : 'OFF'}
          </div>
          <div className="text-xs text-pulse-muted mt-1">Blocker status</div>
        </div>
      </div>

      {/* Reset */}
      <button
        onClick={handleReset}
        className="px-4 py-2 text-sm text-pulse-muted border border-pulse-border rounded-lg hover:bg-pulse-panel hover:text-pulse-text transition-colors"
      >
        Reset block counter
      </button>

      {/* Filter list info */}
      <div className="bg-pulse-bg border border-pulse-border rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3">Active filter categories</h3>
        <div className="space-y-2">
          {[
            { name: 'Ad networks', desc: 'Google Ads, DoubleClick, AdRoll, Criteo, Taboola...', count: '40+' },
            { name: 'Analytics trackers', desc: 'Google Analytics, Hotjar, Mixpanel, Segment...', count: '20+' },
            { name: 'Social trackers', desc: 'Facebook pixel, Twitter analytics, LinkedIn...', count: '10+' },
            { name: 'Crypto miners', desc: 'CoinHive, CryptoLoot...', count: '3' },
            { name: 'URL patterns', desc: '/ads/, /tracking/, /analytics/, /pixel/...', count: '25+' },
          ].map((cat) => (
            <div key={cat.name} className="flex items-center justify-between py-1.5">
              <div>
                <div className="text-xs font-medium">{cat.name}</div>
                <div className="text-[10px] text-pulse-muted/60">{cat.desc}</div>
              </div>
              <span className="text-[10px] font-mono text-pulse-muted bg-pulse-panel px-2 py-0.5 rounded">
                {cat.count} rules
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-pulse-muted">{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-10 h-5 rounded-full transition-all ${
          checked ? 'bg-pulse-accent' : 'bg-pulse-panel border border-pulse-border'
        }`}
      >
        <div
          className={`w-4 h-4 rounded-full bg-white transition-transform mt-0.5 ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function SettingInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-sm text-pulse-muted block mb-1.5">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
      />
    </div>
  );
}
