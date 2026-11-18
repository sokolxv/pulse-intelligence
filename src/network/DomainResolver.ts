const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.br',
  'com.cn',
  'com.tw',
  'co.in',
  'co.nz',
  'co.za',
  'com.mx',
  'com.ar',
  'com.tr',
  'com.sg',
  'com.hk',
  'co.kr',
]);

const MAX_LABEL = 60;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function isIpLiteral(host: string): boolean {
  if (!host) return false;
  if (host.startsWith('[') && host.endsWith(']')) return true;
  if (host.includes(':')) return true;
  return /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(host);
}

function hostFromInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return getHost(trimmed);
  const cut = trimmed.search(/[/?#]/);
  const host = cut >= 0 ? trimmed.slice(0, cut) : trimmed;
  return /^[^:]+:[0-9]+$/.test(host) ? host.slice(0, host.lastIndexOf(':')) : host;
}

export function getHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function getOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function normalizeHost(host: string): string {
  let value = host.trim().toLowerCase();
  while (value.endsWith('.')) value = value.slice(0, -1);
  if (value.startsWith('www.')) value = value.slice(4);
  return value;
}

export function registrableDomain(host: string): string {
  const normalized = normalizeHost(host);
  if (!normalized) return '';
  if (isIpLiteral(normalized)) return normalized;
  const labels = normalized.split('.').filter(Boolean);
  if (labels.length <= 2) return normalized;
  const pair = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
  if (MULTI_LABEL_SUFFIXES.has(pair)) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

export function isThirdParty(pageUrlOrHost: string, urlOrHost: string): boolean {
  const pageDomain = registrableDomain(hostFromInput(pageUrlOrHost));
  if (!pageDomain) return false;
  const targetDomain = registrableDomain(hostFromInput(urlOrHost));
  if (!targetDomain) return false;
  return pageDomain !== targetDomain;
}

export function shortLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return truncate(url, MAX_LABEL);
  }

  const pathname = parsed.pathname;
  const base = pathname.slice(pathname.lastIndexOf('/') + 1);
  const lowerBase = base.toLowerCase();

  if (pathname === '/' || /\.html?$/.test(lowerBase)) {
    return truncate(parsed.hostname, MAX_LABEL);
  }

  const extDot = lowerBase.lastIndexOf('.');
  if (extDot > 0) {
    const ext = lowerBase.slice(extDot);
    if (
      ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.css' ||
      ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' ||
      ext === '.webp' || ext === '.svg' || ext === '.ico' || ext === '.avif' ||
      ext === '.bmp' || ext === '.woff' || ext === '.woff2' || ext === '.ttf' ||
      ext === '.otf' || ext === '.eot' || ext === '.mp4' || ext === '.webm' ||
      ext === '.ogg' || ext === '.mp3' || ext === '.wav' || ext === '.mov' ||
      ext === '.m4a' || ext === '.m3u8'
    ) {
      return truncate(base, MAX_LABEL);
    }
  }

  const full = pathname + parsed.search;
  if (full.length <= MAX_LABEL) return full;
  if (pathname.length <= MAX_LABEL) return pathname;
  return truncate(pathname, MAX_LABEL);
}

export function parseQuery(url: string): Array<{ name: string; value: string }> {
  let search = '';
  try {
    search = new URL(url).search;
  } catch {
    const queryIdx = url.indexOf('?');
    if (queryIdx >= 0) search = url.slice(queryIdx);
  }
  const params = new URLSearchParams(search);
  const out: Array<{ name: string; value: string }> = [];
  params.forEach((value, name) => {
    out.push({ name, value });
  });
  return out;
}
