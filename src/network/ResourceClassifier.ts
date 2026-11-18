import type { NetworkResourceType } from './types';

const CDP_TYPE_MAP: Record<string, NetworkResourceType> = {
  Document: 'document',
  Script: 'script',
  Stylesheet: 'stylesheet',
  Image: 'image',
  Font: 'font',
  Media: 'media',
  XHR: 'xhr',
  Fetch: 'fetch',
  Prefetch: 'fetch',
  EventSource: 'fetch',
  SignedExchange: 'fetch',
  WebSocket: 'websocket',
};

const EXTENSION_MAP: Record<string, NetworkResourceType> = {
  '.js': 'script',
  '.mjs': 'script',
  '.cjs': 'script',
  '.css': 'stylesheet',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.ico': 'image',
  '.avif': 'image',
  '.bmp': 'image',
  '.woff': 'font',
  '.woff2': 'font',
  '.ttf': 'font',
  '.otf': 'font',
  '.eot': 'font',
  '.mp4': 'media',
  '.webm': 'media',
  '.ogg': 'media',
  '.mp3': 'media',
  '.wav': 'media',
  '.mov': 'media',
  '.m4a': 'media',
  '.m3u8': 'media',
  '.json': 'other',
  '.xml': 'other',
  '.txt': 'other',
};

const ASSET_TYPES: ReadonlySet<NetworkResourceType> = new Set<NetworkResourceType>([
  'script',
  'stylesheet',
  'image',
  'font',
  'media',
]);

export function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    const withoutHash = url.split('#')[0] ?? '';
    const withoutQuery = withoutHash.split('?')[0] ?? '';
    const schemeIdx = withoutQuery.indexOf('://');
    if (schemeIdx >= 0) {
      const rest = withoutQuery.slice(schemeIdx + 3);
      const slash = rest.indexOf('/');
      return slash >= 0 ? rest.slice(slash) : '/';
    }
    return withoutQuery;
  }
}

function getExtension(url: string): string {
  const pathname = getPathname(url);
  const base = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

function classifyByMime(mime: string): NetworkResourceType | undefined {
  if (!mime) return undefined;
  if (mime.includes('javascript')) return 'script';
  if (mime.includes('text/css')) return 'stylesheet';
  if (mime.includes('image/')) return 'image';
  if (mime.includes('font/') || mime.includes('fonts/')) return 'font';
  if (mime.includes('audio/') || mime.includes('video/')) return 'media';
  if (mime.includes('text/html')) return 'document';
  if (mime.includes('json') || mime.includes('xml')) return 'other';
  return undefined;
}

export function classifyResourceType(input: {
  url: string;
  cdpType?: string;
  mimeType?: string;
  method?: string;
}): NetworkResourceType {
  const fromCdp = input.cdpType ? CDP_TYPE_MAP[input.cdpType] : undefined;
  if (fromCdp) return fromCdp;

  const fromExt = EXTENSION_MAP[getExtension(input.url)];
  if (fromExt) return fromExt;

  const fromMime = classifyByMime((input.mimeType ?? '').toLowerCase());
  if (fromMime) return fromMime;

  return 'other';
}

export function isApiLike(req: {
  url: string;
  type: NetworkResourceType;
  method?: string;
  mimeType?: string;
}): boolean {
  if (req.type === 'xhr' || req.type === 'fetch') return true;

  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const ext = getExtension(req.url);
    const assetExt = ext ? EXTENSION_MAP[ext] : undefined;
    const assetLike = (assetExt !== undefined && ASSET_TYPES.has(assetExt)) || ASSET_TYPES.has(req.type);
    if (!assetLike) return true;
  }

  const pathname = getPathname(req.url).toLowerCase();
  if (/(\/|^)(api|graphql|rest|v[0-9]+)(\/|$)/.test(pathname)) return true;

  const mime = (req.mimeType ?? '').toLowerCase();
  if ((mime.includes('json') || mime.includes('xml')) && !getExtension(req.url)) return true;

  return false;
}
