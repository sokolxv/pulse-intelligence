import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Shield, ShieldAlert, Clock, Zap, EyeOff, RefreshCw, Network } from 'lucide-react';
import AdBlockerBadge from './AdBlockerBadge';
import { useNetworkGraphStore } from '../graph/store';

interface StatusBarProps {
  incognitoMode?: boolean;
  isSecure?: boolean;
  currentUrl?: string;
  onOpenNetworkGraph?: () => void;
}

type PrivacyMode = 'checking' | 'active' | 'inactive' | 'unavailable';

export default memo(function StatusBar({ incognitoMode, isSecure, currentUrl, onOpenNetworkGraph }: StatusBarProps) {
  const [timeStr, setTimeStr] = useState(() => new Date().toLocaleTimeString('en-US', { hour12: false }));
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('checking');
  const [privacyDetail, setPrivacyDetail] = useState<string>('');
  const [changing, setChanging] = useState(false);
  const retryTimerRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const privacyCheckInFlight = useRef(false);

  useEffect(() => {
    const timers = retryTimerRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      retryTimerRef.current = [];
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString('en-US', { hour12: false }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const checkPrivacy = useCallback(async () => {
    if (privacyCheckInFlight.current) return;
    privacyCheckInFlight.current = true;
    const api: any = (window as any).electronAPI;
    if (!api) {
      setPrivacyMode('unavailable');
      setPrivacyDetail('Electron API недоступен');
      privacyCheckInFlight.current = false;
      return;
    }
    setPrivacyMode('checking');
    try {
      if (api.privacyStatus) {
        const s = await api.privacyStatus();
        if (s?.routed && s?.running) {
          setPrivacyMode('active');
          setPrivacyDetail(`Маршрут через защищённую сеть • ${s.proxy || 'socks5://127.0.0.1:9150'}`);
        } else if (s?.running && (s?.ready || s?.bootstrap === 100)) {
          setPrivacyMode('active');
          setPrivacyDetail('Защищённый маршрут готов');
        } else {
          setPrivacyMode('inactive');
          setPrivacyDetail(
            typeof s?.bootstrap === 'number' && s.bootstrap >= 0
              ? `Tor не готов (${s.bootstrap}%) — прямое соединение`
              : 'Защищённый маршрут неактивен — прямое соединение'
          );
        }
        return;
      }
      setPrivacyMode('inactive');
      setPrivacyDetail('Проверка недоступна');
    } catch (e: any) {
      setPrivacyMode('unavailable');
      setPrivacyDetail(e?.message || 'Ошибка проверки');
    } finally {
      privacyCheckInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    checkPrivacy();
    const id = setInterval(checkPrivacy, 15000);
    const onFocus = () => checkPrivacy();
    window.addEventListener('focus', onFocus);
    const api: any = (window as any).electronAPI;
    let offPriv: any = null;
    if (api?.onPrivacyIdentityChanged) {
      offPriv = api.onPrivacyIdentityChanged(() => checkPrivacy());
    } else {
      const custom = () => checkPrivacy();
      window.addEventListener('privacy-identity-changed', custom as any);
      offPriv = () => window.removeEventListener('privacy-identity-changed', custom as any);
    }
    let offFail: any = null;
    if (api?.onPrivacyRoutingFailed) {
      offFail = api.onPrivacyRoutingFailed((info: any) => {
        setPrivacyMode('inactive');
        setPrivacyDetail(
          info?.reason === 'tor-bootstrap'
            ? `Tor заблокирован/не готов${typeof info?.bootstrap === 'number' && info.bootstrap >= 0 ? ` (${info.bootstrap}%)` : ''} — прямое соединение`
            : 'Защищённый маршрут недоступен — прямое соединение'
        );
        retryTimerRef.current.push(setTimeout(checkPrivacy, 3000));
      });
    }
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      if (offPriv) offPriv();
      if (offFail) offFail();
    };
  }, [checkPrivacy]);

  // Тумблер Settings → Network → usePrivacy: выкл = прямое соединение
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (!api) return;
    const applyPrivacyPref = () => {
      try {
        const raw = localStorage.getItem('pulse-settings');
        const usePrivacy = raw ? JSON.parse(raw)?.network?.usePrivacy : true;
        if (usePrivacy === false) {
          if (api.privacyClearRouting) api.privacyClearRouting().catch(() => {});
        } else {
          if (api.privacyEnableRouting) api.privacyEnableRouting().catch(() => {});
        }
      } catch {}
      checkPrivacy();
    };
    applyPrivacyPref();
    const onSettings = () => applyPrivacyPref();
    window.addEventListener('pulse-settings-changed', onSettings);
    // Если main включил роутинг позже (долгий bootstrap), а в настройках выкл — перебиваем
    let offEnabled: any = null;
    if (api?.onPrivacyRoutingEnabled) {
      offEnabled = api.onPrivacyRoutingEnabled(() => {
        try {
          const raw = localStorage.getItem('pulse-settings');
          const usePrivacy = raw ? JSON.parse(raw)?.network?.usePrivacy : true;
          if (usePrivacy === false && api.privacyClearRouting) api.privacyClearRouting().catch(() => {});
        } catch {}
        checkPrivacy();
      });
    }
    return () => {
      window.removeEventListener('pulse-settings-changed', onSettings);
      if (offEnabled) offEnabled();
    };
  }, [checkPrivacy]);

  const handleNewIdentity = async () => {
    const api: any = (window as any).electronAPI;
    if (!api?.privacyNewIdentity) return;
    setChanging(true);
    try {
      const r = await api.privacyNewIdentity();
      if (r?.success) {
        setPrivacyDetail('Маршрут обновлён • новая личность');
        retryTimerRef.current.push(setTimeout(checkPrivacy, 1200));
        window.dispatchEvent(new CustomEvent('webview-reload'));
      } else {
        setPrivacyDetail(r?.error || 'Не удалось сменить маршрут');
      }
    } catch {}
    setChanging(false);
    retryTimerRef.current.push(setTimeout(checkPrivacy, 2000));
  };

  const privacyColor =
    privacyMode === 'active' ? 'text-pulse-green' : privacyMode === 'inactive' ? 'text-pulse-yellow' : privacyMode === 'checking' ? 'text-pulse-yellow' : 'text-pulse-muted';
  const privacyLabel =
    privacyMode === 'active' ? 'Защита: Вкл' : privacyMode === 'inactive' ? 'Защита: Выкл' : privacyMode === 'checking' ? 'Защита: Проверка…' : 'Защита: —';
  const privacyTitle = privacyDetail ? `${privacyLabel} — ${privacyDetail}` : privacyLabel;

  const isNewTab = !currentUrl || currentUrl === 'pulse://newtab';
  const encryptedLabel = isNewTab ? '—' : isSecure ? 'Шифрование' : 'Без шифрования';
  const encryptedColor = isNewTab ? 'text-pulse-muted' : isSecure ? 'text-pulse-green' : 'text-pulse-yellow';
  const EncryptedIcon = isSecure ? Shield : ShieldAlert;

  return (
    <div className={`flex items-center justify-between h-7 px-3 border-t border-pulse-border/80 text-[11px] font-mono text-pulse-muted chrome-grain liquid-bar ${incognitoMode ? 'bg-[#14141A]' : 'bg-pulse-surface/95 backdrop-blur-md'}`}>
      <div className="flex items-center gap-3">
        {incognitoMode && (
          <div className="badge-gold flex items-center gap-1.5 rounded-full px-2 py-px">
            <EyeOff size={12} />
            <span>Приватно</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 rounded-full border border-pulse-border/60 bg-pulse-bg/40 px-2 py-px" title={isNewTab ? 'Нет страницы' : isSecure ? `HTTPS — ${currentUrl}` : `HTTP — ${currentUrl}`}>
          <EncryptedIcon size={12} className={encryptedColor} />
          <span className={encryptedColor !== 'text-pulse-muted' ? encryptedColor : ''}>{encryptedLabel}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-pulse-border/60 bg-pulse-bg/40 px-2 py-px" title={privacyTitle}>
          <div className={`w-1.5 h-1.5 rounded-full ${privacyMode === 'active' ? 'bg-pulse-green status-dot shadow-[0_0_8px_rgba(140,165,138,0.8)]' : privacyMode === 'inactive' ? 'bg-pulse-yellow shadow-[0_0_8px_rgba(200,168,126,0.7)]' : privacyMode === 'checking' ? 'bg-pulse-yellow animate-pulse shadow-[0_0_8px_rgba(200,168,126,0.6)]' : 'bg-pulse-muted'}`} />
          <span className={privacyMode === 'active' ? 'text-pulse-green' : privacyMode === 'inactive' ? 'text-pulse-yellow' : ''}>{privacyLabel}</span>
          <button
            onClick={handleNewIdentity}
            disabled={changing || privacyMode === 'checking'}
            className="btn-ghost ml-1 flex items-center gap-1 px-2 py-px rounded-full text-[10px] transition-all duration-150 active:scale-95 disabled:opacity-40"
            title="Сменить личность — новый защищённый маршрут и очистка сессии"
          >
            <RefreshCw size={10} className={changing ? 'animate-spin' : ''} />
            {changing ? 'Смена…' : 'Сменить личность'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-full border border-pulse-border/60 bg-pulse-bg/40 px-2 py-px" title="Фоновые задачи">
          <Zap size={12} className="text-pulse-accent" />
          <span>0 задач</span>
        </div>
        {onOpenNetworkGraph && <NetGraphBadge onOpen={onOpenNetworkGraph} />}
      </div>

      <div className="flex items-center gap-3">
        <AdBlockerBadge />
        <div className="flex items-center gap-1.5 rounded-full border border-pulse-border/60 bg-pulse-bg/40 px-2 py-px">
          <Clock size={12} />
          <span className="tnum">{timeStr}</span>
        </div>
      </div>
    </div>
  );
});

function NetGraphBadge({ onOpen }: { onOpen: () => void }) {
  const total = useNetworkGraphStore((s) => s.stats.total);
  const source = useNetworkGraphStore((s) => s.source);
  const dot =
    source === 'live' ? 'bg-pulse-green' : source === 'demo' ? 'bg-pulse-yellow' : 'bg-pulse-muted';
  return (
    <button
      onClick={onOpen}
      title="Network Graph — зависимости запросов страницы (⌘⇧G)"
      className="flex items-center gap-1.5 rounded-full border border-pulse-border/60 bg-pulse-bg/40 px-2 py-px hover:text-pulse-text hover:border-pulse-accent/40 transition-colors"
    >
      <Network size={12} className="text-pulse-accent" />
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="tnum">{total > 0 ? `${total} req` : 'Graph'}</span>
    </button>
  );
}
