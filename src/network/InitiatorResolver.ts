import type { InitiatorFrame, NetworkRequest } from './types';
import { shortLabel } from './DomainResolver';

const MAX_CHAIN_DEPTH = 24;
const MAX_FRAME_LINES = 6;

export interface InitiatorChainEntry {
  requestId?: string;
  url: string;
  label: string;
  frame?: InitiatorFrame;
  method?: string;
  depth: number;
}

function basename(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    const withoutHash = url.split('#')[0] ?? '';
    path = (withoutHash.split('?')[0] ?? '').trim();
  }
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base) return base;
  return shortLabel(url) || url;
}

function pickMatch(
  requests: NetworkRequest[],
  url: string,
  preferredLoadId: number | undefined,
  excludeIds: ReadonlySet<string>,
): NetworkRequest | undefined {
  let best: NetworkRequest | undefined;
  let bestSameLoad = false;
  for (const candidate of requests) {
    if (candidate.url !== url || excludeIds.has(candidate.id)) continue;
    const sameLoad = preferredLoadId !== undefined && candidate.pageLoadId === preferredLoadId;
    if (!best) {
      best = candidate;
      bestSameLoad = sameLoad;
      continue;
    }
    if (sameLoad && !bestSameLoad) {
      best = candidate;
      bestSameLoad = true;
      continue;
    }
    if (sameLoad === bestSameLoad && candidate.startTime >= best.startTime) {
      best = candidate;
    }
  }
  return best;
}

export function resolveInitiatorChain(
  request: NetworkRequest,
  requests: NetworkRequest[],
  pageUrl: string | null,
): InitiatorChainEntry[] {
  const chain: InitiatorChainEntry[] = [];
  const visitedUrls = new Set<string>();
  const visitedIds = new Set<string>([request.id]);

  let current = request;
  let depth = 0;

  while (depth < MAX_CHAIN_DEPTH) {
    const info = current.initiatorInfo;
    if (!info) break;

    const nextUrl = info.frames[0]?.url || info.url || '';
    if (!nextUrl) break;

    const frame = info.frames[0];

    if (pageUrl && nextUrl === pageUrl) {
      chain.push({ url: nextUrl, label: shortLabel(nextUrl), frame, depth });
      break;
    }

    if (visitedUrls.has(nextUrl)) break;

    if (info.kind === 'redirect') {
      const prevId = current.redirectedFrom;
      const prev = prevId ? requests.find((r) => r.id === prevId) : undefined;
      if (!prev || visitedIds.has(prev.id)) break;
      chain.push({
        requestId: prev.id,
        url: nextUrl,
        label: shortLabel(nextUrl),
        frame,
        method: prev.method,
        depth,
      });
      visitedUrls.add(nextUrl);
      visitedIds.add(prev.id);
      current = prev;
      depth += 1;
      continue;
    }

    const match = pickMatch(requests, nextUrl, current.pageLoadId, visitedIds);
    if (!match) {
      const known = requests.some((r) => r.url === nextUrl);
      if (known) break;
      chain.push({ url: nextUrl, label: shortLabel(nextUrl), frame, depth });
      break;
    }

    chain.push({
      requestId: match.id,
      url: nextUrl,
      label: shortLabel(nextUrl),
      frame,
      method: match.method,
      depth,
    });
    visitedUrls.add(nextUrl);
    visitedIds.add(match.id);
    current = match;
    depth += 1;
  }

  return chain;
}

export function formatFrames(
  request: NetworkRequest,
): Array<{ depth: number; text: string; url: string; requestId?: string }> {
  let target: string;
  try {
    const parsed = new URL(request.url);
    target = parsed.pathname + parsed.search;
  } catch {
    target = shortLabel(request.url);
  }

  const lines: Array<{ depth: number; text: string; url: string; requestId?: string }> = [
    { depth: 0, text: `${request.method} ${target}`, url: request.url, requestId: request.id },
  ];

  const frames = request.initiatorInfo?.frames ?? [];
  for (let i = 0; i < frames.length && i < MAX_FRAME_LINES; i += 1) {
    const frame = frames[i];
    if (!frame) continue;
    const location = frame.lineNumber !== undefined
      ? `${basename(frame.url)}:${frame.lineNumber + 1}`
      : basename(frame.url);
    const name = frame.functionName;
    const text = name ? `${name} (${location})` : location;
    lines.push({ depth: i + 1, text, url: frame.url });
  }

  return lines;
}
