import { MAX_REQUESTS_PER_TAB } from '../graph/types';
import type {
  IRequestStore,
  NetworkPageInfo,
  NetworkRequest,
  RequestStoreStats,
} from './types';
import { isThirdParty } from './DomainResolver';

type StoreListener = (tabId?: string) => void;

interface TabState {
  requests: Map<string, NetworkRequest>;
  page: NetworkPageInfo | null;
  truncated: boolean;
  stats: RequestStoreStats;
  statsValid: boolean;
}

const EMPTY_STATS: RequestStoreStats = {
  total: 0,
  pending: 0,
  errors: 0,
  thirdParty: 0,
  truncated: false,
};

function isErrored(r: NetworkRequest): boolean {
  return r.state === 'failed' || r.state === 'canceled' || (r.status ?? 0) >= 400;
}

export class RequestStore implements IRequestStore {
  private tabs = new Map<string, TabState>();
  private listeners = new Set<StoreListener>();
  private pendingNotify = new Set<string>();
  private notifyScheduled = false;

  private getTab(tabId: string): TabState {
    let tab = this.tabs.get(tabId);
    if (!tab) {
      tab = { requests: new Map(), page: null, truncated: false, stats: { ...EMPTY_STATS }, statsValid: false };
      this.tabs.set(tabId, tab);
    }
    return tab;
  }

  private invalidate(tab: TabState): void {
    tab.statsValid = false;
  }

  private scheduleNotify(tabId: string): void {
    this.pendingNotify.add(tabId);
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      const affected = Array.from(this.pendingNotify);
      this.pendingNotify.clear();
      for (const id of affected) this.emit(id);
    });
  }

  private emit(tabId?: string): void {
    for (const listener of this.listeners) listener(tabId);
  }

  ingestBatch(tabId: string, pageLoadId: number, requests: NetworkRequest[]): void {
    const tab = this.getTab(tabId);
    let changed = false;
    if (tab.page && tab.page.loadId !== pageLoadId) {
      tab.requests.clear();
      tab.page = { url: '', loadId: pageLoadId };
      tab.truncated = false;
      this.invalidate(tab);
      changed = true;
    } else if (!tab.page) {
      tab.page = { url: '', loadId: pageLoadId };
      this.invalidate(tab);
      changed = true;
    }

    if (requests.length) {
      this.invalidate(tab);
      for (const record of requests) {
        tab.requests.set(record.id, record);
        while (tab.requests.size > MAX_REQUESTS_PER_TAB) {
          const oldest = tab.requests.keys().next();
          if (oldest.done) break;
          tab.requests.delete(oldest.value);
          tab.truncated = true;
        }
      }
      changed = true;
    }

    if (changed) this.scheduleNotify(tabId);
  }

  startPage(tabId: string, pageLoadId: number, url: string): void {
    const tab = this.getTab(tabId);
    tab.requests.clear();
    tab.page = { url, loadId: pageLoadId };
    tab.truncated = false;
    this.invalidate(tab);
    this.emit(tabId);
  }

  clear(tabId?: string): void {
    if (tabId === undefined) {
      this.tabs.clear();
      this.emit(undefined);
      return;
    }
    if (!this.tabs.delete(tabId)) return;
    this.emit(tabId);
  }

  getRequests(tabId: string): NetworkRequest[] {
    const tab = this.tabs.get(tabId);
    if (!tab) return [];
    return Array.from(tab.requests.values());
  }

  getPage(tabId: string): NetworkPageInfo | null {
    return this.tabs.get(tabId)?.page ?? null;
  }

  getStats(tabId: string): RequestStoreStats {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ...EMPTY_STATS };
    if (!tab.statsValid) {
      const page = tab.page;
      let pending = 0;
      let errors = 0;
      let thirdParty = 0;
      for (const record of tab.requests.values()) {
        if (record.state === 'pending') pending += 1;
        if (isErrored(record)) errors += 1;
        if (page && isThirdParty(page.url, record.url)) thirdParty += 1;
      }
      tab.stats = {
        total: tab.requests.size,
        pending,
        errors,
        thirdParty,
        truncated: tab.truncated,
      };
      tab.statsValid = true;
    }
    return { ...tab.stats };
  }

  listTabs(): string[] {
    return Array.from(this.tabs.keys());
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const requestStore: IRequestStore = new RequestStore();
