/**
 * Module Result Cache — stores OSINT module results in localStorage with TTL
 */

const CACHE_PREFIX = 'pulse-osint-cache:';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 200;

interface CacheEntry {
  key: string;
  moduleId: string;
  input: string;
  result: Record<string, any>;
  timestamp: number;
  expiresAt: number;
}

function getCacheKey(moduleId: string, input: string): string {
  return `${moduleId}::${input.toLowerCase().trim()}`;
}

export function getCachedResult(moduleId: string, input: string): Record<string, any> | null {
  try {
    const key = getCacheKey(moduleId, input);
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;

    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }

    return entry.result;
  } catch {
    return null;
  }
}

export function setCachedResult(
  moduleId: string,
  input: string,
  result: Record<string, any>,
  ttlMs: number = DEFAULT_TTL
): void {
  try {
    const key = getCacheKey(moduleId, input);
    const entry: CacheEntry = {
      key,
      moduleId,
      input,
      result,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };

    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));

    // Evict old entries if cache is too large
    evictOldEntries();
  } catch {
    // localStorage full — clear oldest entries
    clearExpiredEntries();
  }
}

function evictOldEntries(): void {
  const entries: { key: string; timestamp: number }[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (storageKey?.startsWith(CACHE_PREFIX)) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const entry: CacheEntry = JSON.parse(raw);
          entries.push({ key: storageKey, timestamp: entry.timestamp });
        }
      } catch {}
    }
  }

  if (entries.length > MAX_CACHE_ENTRIES) {
    entries.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);
    for (const e of toRemove) {
      localStorage.removeItem(e.key);
    }
  }
}

function clearExpiredEntries(): void {
  const now = Date.now();
  const toRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (storageKey?.startsWith(CACHE_PREFIX)) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const entry: CacheEntry = JSON.parse(raw);
          if (now > entry.expiresAt) {
            toRemove.push(storageKey);
          }
        }
      } catch {
        toRemove.push(storageKey!);
      }
    }
  }

  for (const key of toRemove) {
    localStorage.removeItem(key);
  }
}

export function clearModuleCache(moduleId?: string): number {
  let cleared = 0;
  const toRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (storageKey?.startsWith(CACHE_PREFIX)) {
      if (!moduleId) {
        toRemove.push(storageKey);
      } else {
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) {
            const entry: CacheEntry = JSON.parse(raw);
            if (entry.moduleId === moduleId) {
              toRemove.push(storageKey);
            }
          }
        } catch {
          toRemove.push(storageKey);
        }
      }
    }
  }

  for (const key of toRemove) {
    localStorage.removeItem(key);
    cleared++;
  }
  return cleared;
}

export function getCacheStats(): { totalEntries: number; totalSize: number } {
  let totalEntries = 0;
  let totalSize = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (storageKey?.startsWith(CACHE_PREFIX)) {
      totalEntries++;
      totalSize += (localStorage.getItem(storageKey) || '').length;
    }
  }

  return { totalEntries, totalSize };
}
