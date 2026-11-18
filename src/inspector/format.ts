import type { NetworkBodyResult, NetworkRequest } from '../network/types';

const REASON_PHRASES: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

function trimDecimal(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

export function formatBytes(n?: number): string {
  if (!isNum(n)) return '—';
  if (n === 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${trimDecimal(n / 1024, 1)} KB`;
  return `${trimDecimal(n / (1024 * 1024), 1)} MB`;
}

export function formatDuration(ms?: number): string {
  if (!isNum(ms)) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${trimDecimal(ms / 1000, 2)} s`;
}

export function statusLabel(
  status?: number,
  statusText?: string,
  state?: NetworkRequest['state'],
): string {
  if (!isNum(status)) {
    if (state === 'failed' || state === 'canceled') return 'Failed';
    return 'Pending';
  }
  const given = typeof statusText === 'string' ? statusText.trim() : '';
  const reason = given || REASON_PHRASES[status] || '';
  return reason ? `${status} ${reason}` : `${status}`;
}

export type StatusTone = 'ok' | 'redirect' | 'warn' | 'error' | 'muted' | 'pending';

export function statusTone(status?: number, state?: NetworkRequest['state']): StatusTone {
  if (state === 'failed' || state === 'canceled') return 'error';
  if (state === 'pending') return 'pending';
  if (!isNum(status)) return 'muted';
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'redirect';
  if (status >= 400 && status < 500) return 'warn';
  if (status >= 500) return 'error';
  return 'muted';
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

export function queryParams(url: string): Array<{ name: string; value: string }> {
  if (!url) return [];
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return [];
  const query = url.slice(qIndex + 1).split('#')[0];
  if (!query) return [];
  const out: Array<{ name: string; value: string }> = [];
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawName = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    out.push({ name: safeDecode(rawName), value: safeDecode(rawValue) });
  }
  return out;
}

export interface TimelineSegment {
  key: string;
  label: string;
  start: number;
  end: number;
  tone: 'block' | 'dns' | 'connect' | 'secure' | 'send' | 'wait' | 'download';
}

export function buildTimeline(request: NetworkRequest): {
  total: number;
  segments: TimelineSegment[];
} {
  const timing = request.timing;
  const duration = request.duration;
  const segments: TimelineSegment[] = [];

  const push = (
    key: string,
    label: string,
    start: number | undefined,
    end: number | undefined,
    tone: TimelineSegment['tone'],
  ) => {
    if (!isNum(start) || !isNum(end)) return;
    if (end <= start) return;
    segments.push({ key, label, start, end, tone });
  };

  if (timing) {
    push('dns', 'DNS', timing.dnsStart, timing.dnsEnd, 'dns');

    if (isNum(timing.connectStart) && isNum(timing.connectEnd)) {
      const splitAt =
        isNum(timing.sslStart) && timing.sslStart > timing.connectStart && timing.sslStart < timing.connectEnd
          ? timing.sslStart
          : undefined;
      if (splitAt !== undefined) {
        push('connect', 'Connect', timing.connectStart, splitAt, 'connect');
        push('secure', 'TLS', timing.sslStart, timing.sslEnd, 'secure');
      } else {
        push('connect', 'Connect', timing.connectStart, timing.connectEnd, 'connect');
      }
    }

    push('send', 'Send', timing.sendStart, timing.sendEnd, 'send');

    const waitEnd = timing.receiveHeadersEnd ?? duration;
    const waitStart = isNum(timing.sendEnd)
      ? timing.sendEnd
      : segments.length
        ? segments[segments.length - 1].end
        : 0;
    push('wait', 'Waiting', waitStart, waitEnd, 'wait');

    if (isNum(timing.receiveHeadersEnd) && isNum(duration)) {
      push('download', 'Download', timing.receiveHeadersEnd, duration, 'download');
    }
  }

  if (segments.length === 0 && isNum(duration)) {
    segments.push({ key: 'total', label: 'Total', start: 0, end: duration, tone: 'block' });
  }

  const total = isNum(duration)
    ? duration
    : segments.length
      ? segments[segments.length - 1].end
      : 0;

  return { total, segments };
}

export function prettyHeaders(headers?: Record<string, string>): Array<{ name: string; value: string }> {
  if (!headers) return [];
  return Object.entries(headers)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => {
      const byLower = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return byLower !== 0 ? byLower : a.name.localeCompare(b.name);
    });
}

export function parseCookies(headerValue?: string): Array<{ name: string; value: string }> {
  if (!headerValue) return [];
  const out: Array<{ name: string; value: string }> = [];
  for (const chunk of headerValue.split(';')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      out.push({ name: trimmed, value: '' });
    } else {
      out.push({ name: trimmed.slice(0, eq).trim(), value: trimmed.slice(eq + 1).trim() });
    }
  }
  return out;
}

const BODY_LIMIT = 200_000;
const TRUNCATION_SUFFIX = '\n… (truncated)';

export function prettyBody(
  body: string,
  mimeType?: string,
): { text: string; isJson: boolean; truncated: boolean } {
  const mime = (mimeType ?? '').toLowerCase();
  const trimmedStart = body.trimStart();
  const looksJson =
    mime.includes('json') || trimmedStart.startsWith('{') || trimmedStart.startsWith('[');

  let text = body;
  let isJson = false;
  if (looksJson) {
    try {
      text = JSON.stringify(JSON.parse(body), null, 2);
      isJson = true;
    } catch {
      text = body;
    }
  }

  let truncated = false;
  if (text.length > BODY_LIMIT) {
    text = `${text.slice(0, BODY_LIMIT)}${TRUNCATION_SUFFIX}`;
    truncated = true;
  }

  return { text, isJson, truncated };
}

export function decodeBody(result: NetworkBodyResult): string {
  const body = result.body;
  if (!body) return '';
  if (!result.base64Encoded) return body;
  try {
    const binary = atob(body);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

export function urlPath(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url.split('#')[0];
  }
}

export function protocolLabel(protocol?: string): string {
  switch (protocol) {
    case 'h2':
      return 'HTTP/2';
    case 'h3':
      return 'HTTP/3';
    case 'http/1.0':
      return 'HTTP/1.0';
    case 'ws':
    case 'wss':
      return 'WS';
    default:
      return 'HTTP/1.1';
  }
}
