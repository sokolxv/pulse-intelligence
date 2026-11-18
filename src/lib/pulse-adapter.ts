/**
 * Pulse Adapter — bridges globalThis.Pulse API to browser environment
 * Provides: http (fetch), config (localStorage), utils, registry
 */

// ── HTTP layer ──────────────────────────────────────────────
interface HttpGetOptions {
  timeoutMs?: number;
  timeout?: number;
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  method?: string;
  json?: any;
  body?: string;
}

interface HttpResponse {
  status: number;
  text: string;
  url: string;
}

function buildUrl(url: string, params?: Record<string, string | number>): string {
  if (!params) return url;
  const sep = url.includes('?') ? '&' : '?';
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return url + sep + qs;
}

async function httpGet(url: string, options: HttpGetOptions = {}): Promise<HttpResponse> {
  const timeout = options.timeoutMs || options.timeout || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const finalUrl = buildUrl(url, options.params);
    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      headers: options.headers || {},
      signal: controller.signal,
      redirect: 'follow',
    };

    if (options.json) {
      fetchOptions.method = 'POST';
      (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.json);
    } else if (options.body !== undefined) {
      fetchOptions.body = options.body;
    }

    const resp = await fetch(finalUrl, fetchOptions);
    const text = await resp.text();
    return { status: resp.status, text, url: resp.url };
  } catch (e: any) {
    return { status: 0, text: '', url };
  } finally {
    clearTimeout(timer);
  }
}

async function httpJson(url: string, options: HttpGetOptions = {}): Promise<any> {
  const resp = await httpGet(url, options);
  if (!resp || resp.status === 0) throw new Error('Network error');
  if (resp.status >= 400) throw new Error(`HTTP ${resp.status}`);
  return JSON.parse(resp.text);
}

// ── Config layer (localStorage) ─────────────────────────────
interface PulseConfig {
  requestTimeout: number;
  vtKey: string;
  intelxKey: string;
  abuseIpDbKey: string;
  greyNoiseKey: string;
  abuseChKey: string;
  intelxInstance: string;
  userAgent: string;
}

const CONFIG_KEY = 'pulse-osint-config';
const DEFAULT_CONFIG: PulseConfig = {
  requestTimeout: 15000,
  vtKey: '',
  intelxKey: '',
  abuseIpDbKey: '',
  greyNoiseKey: '',
  abuseChKey: '',
  intelxInstance: 'free.intelx.io',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PulseBrowser/1.0',
};

function getConfig(): PulseConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}

function setConfig(patch: Partial<PulseConfig>): void {
  const current = getConfig();
  const updated = { ...current, ...patch };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
}

// ── Utils ───────────────────────────────────────────────────
function compact(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') {
      result[k] = v;
    }
  }
  return result;
}

function extractDomain(input: string): string {
  let str = String(input || '').trim();
  if (!str) return '';
  // Remove protocol
  str = str.replace(/^https?:\/\//i, '');
  // Remove path
  str = str.split('/')[0];
  // Remove port
  str = str.split(':')[0];
  // Remove www.
  str = str.replace(/^www\./i, '');
  return str.toLowerCase();
}

function isIp(str: string): boolean {
  const s = String(str || '').trim();
  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)) return true;
  // IPv6
  if (/^[0-9a-fA-F:]+$/.test(s) && s.includes(':')) return true;
  return false;
}

// ── Registry ────────────────────────────────────────────────
interface PulseModule {
  id: string;
  name: string;
  category: string;
  description: string;
  targets: string[];
  region: string;
  tags: string[];
  confidence: number;
  freeTier: string;
  wants: (query: any) => boolean;
  run: (query: any) => Promise<Record<string, any>>;
}

const registeredModules: PulseModule[] = [];

function registerModule(module: PulseModule): void {
  if (!registeredModules.find(m => m.id === module.id)) {
    registeredModules.push(module);
  }
}

function getModules(): PulseModule[] {
  return [...registeredModules];
}

// ── Global Pulse object ─────────────────────────────────────
const Pulse = {
  http: { httpGet, httpJson },
  config: {
    get: async () => getConfig(),
    set: setConfig,
  },
  utils: { compact, extractDomain, isIp },
  registry: { register: registerModule },
  modules: { register: registerModule },
};

// Set on globalThis
(globalThis as any).Pulse = Pulse;

export { Pulse, getModules, registerModule, getConfig, setConfig };
export type { PulseModule, PulseConfig };
