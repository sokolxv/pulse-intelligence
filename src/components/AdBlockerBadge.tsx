import { useState, useEffect, memo, useCallback } from 'react';
import { Shield, ShieldOff, ShieldCheck, RotateCw } from 'lucide-react';

const AdBlockerBadge = memo(function AdBlockerBadge() {
  const [stats, setStats] = useState<import('../types').AdBlockerStats>({
    enabled: true,
    blockCount: 0,
    filterCount: 0,
  });
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (window.electronAPI) {
        const s = await window.electronAPI.getAdBlockerStats();
        setStats(s);
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = useCallback(() => {
    const newEnabled = !stats.enabled;
    setStats((prev) => ({ ...prev, enabled: newEnabled }));
    window.electronAPI?.toggleAdBlocker(newEnabled);
  }, [stats.enabled]);

  const handleReset = useCallback(() => {
    window.electronAPI?.resetAdBlockerCount();
    setStats((prev) => ({ ...prev, blockCount: 0 }));
  }, []);

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-mono tnum transition-colors ${
          stats.enabled
            ? 'bg-pulse-green/10 border-pulse-green/20 text-pulse-green hover:bg-pulse-green/15'
            : 'bg-pulse-panel/60 border-pulse-border/50 text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel/70'
        }`}
        title={stats.enabled ? 'Ad blocker ON — click to disable' : 'Ad blocker OFF — click to enable'}
      >
        {stats.enabled ? (
          <Shield size={11} />
        ) : (
          <ShieldOff size={11} />
        )}
        <span>{stats.enabled ? 'ON' : 'OFF'}</span>
        {stats.blockCount > 0 && (
          <span className="px-1.5 py-0 rounded-full bg-pulse-green/10 border border-pulse-green/20 text-pulse-green text-[10px] tnum">
            {stats.blockCount}
          </span>
        )}
      </button>

      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 glass rounded-xl shadow-card p-3 z-50 rise-in">
          <div className="text-xs font-semibold text-pulse-text mb-2 flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-pulse-green opacity-80" />
            Ad & Tracker Blocker
          </div>
          <div className="space-y-1.5 text-[11px] font-mono tnum">
            <div className="flex justify-between">
              <span className="text-pulse-muted">Status</span>
              <span className={stats.enabled ? 'text-pulse-green' : 'text-pulse-muted'}>
                {stats.enabled ? 'Active' : 'Disabled'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-pulse-muted">Blocked</span>
              <span>{stats.blockCount} requests</span>
            </div>
            <div className="flex justify-between">
              <span className="text-pulse-muted">Filters</span>
              <span>{stats.filterCount}</span>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-pulse-muted hover:text-pulse-text border border-pulse-border/50 rounded-lg hover:bg-pulse-panel/60 transition-colors"
            >
              <RotateCw size={9} /> Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default AdBlockerBadge;
