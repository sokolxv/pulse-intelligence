import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestStore } from '../RequestStore';
import { MAX_REQUESTS_PER_TAB } from '../../graph/types';
import type { NetworkRequest } from '../types';

function make(id: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id,
    url: `https://site.test/${id}`,
    method: 'GET',
    type: 'other',
    domain: 'site.test',
    startTime: 1000,
    state: 'finished',
    status: 200,
    ...overrides,
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  requestStore.clear();
});

describe('RequestStore', () => {
  it('upserts by id and keeps insertion order', () => {
    const tab = 't-upsert';
    requestStore.startPage(tab, 1, 'https://site.test/');
    requestStore.ingestBatch(tab, 1, [
      make('a', { state: 'pending', status: undefined }),
      make('b'),
    ]);
    requestStore.ingestBatch(tab, 1, [make('a', { state: 'finished', status: 200, endTime: 5 })]);

    const list = requestStore.getRequests(tab);
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
    expect(list[0].state).toBe('finished');
    expect(list[0].status).toBe(200);
    expect(list[0].endTime).toBe(5);
  });

  it('keeps insertion order across batches', () => {
    const tab = 't-order';
    requestStore.startPage(tab, 1, 'https://site.test/');
    requestStore.ingestBatch(tab, 1, [make('b'), make('a')]);
    requestStore.ingestBatch(tab, 1, [make('c')]);
    expect(requestStore.getRequests(tab).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('enforces the ring buffer cap and flags truncation', () => {
    const tab = 't-ring';
    requestStore.startPage(tab, 1, 'https://site.test/');
    const batch = Array.from({ length: MAX_REQUESTS_PER_TAB + 5 }, (_, i) => make(`r${i}`));
    requestStore.ingestBatch(tab, 1, batch);

    const list = requestStore.getRequests(tab);
    expect(list).toHaveLength(MAX_REQUESTS_PER_TAB);
    expect(list[0].id).toBe('r5');
    expect(list[list.length - 1].id).toBe(`r${MAX_REQUESTS_PER_TAB + 4}`);
    expect(requestStore.getStats(tab).truncated).toBe(true);
  });

  it('resets data when the page load id changes', () => {
    const tab = 't-page';
    requestStore.startPage(tab, 1, 'https://site.test/one');
    requestStore.ingestBatch(tab, 1, [make('a')]);
    expect(requestStore.getRequests(tab)).toHaveLength(1);

    requestStore.ingestBatch(tab, 2, [make('b')]);
    expect(requestStore.getRequests(tab).map((r) => r.id)).toEqual(['b']);
    expect(requestStore.getPage(tab)).toEqual({ url: '', loadId: 2 });

    requestStore.startPage(tab, 2, 'https://site.test/two');
    expect(requestStore.getPage(tab)).toEqual({ url: 'https://site.test/two', loadId: 2 });
    expect(requestStore.getRequests(tab)).toHaveLength(0);

    requestStore.ingestBatch(tab, 2, [make('c')]);
    expect(requestStore.getPage(tab)?.url).toBe('https://site.test/two');
  });

  it('computes stats incl. third party and refreshes them on upsert', () => {
    const tab = 't-stats';
    requestStore.startPage(tab, 1, 'https://site.test/');
    requestStore.ingestBatch(tab, 1, [
      make('ok', { url: 'https://site.test/a' }),
      make('failed', { url: 'https://site.test/b', state: 'failed', status: undefined, errorText: 'boom' }),
      make('canceled', { url: 'https://site.test/c', state: 'canceled' }),
      make('http500', { url: 'https://site.test/d', status: 500 }),
      make('pending', { url: 'https://site.test/e', state: 'pending', status: undefined }),
      make('third', { url: 'https://cdn.analytics.other.net/x' }),
    ]);

    expect(requestStore.getStats(tab)).toEqual({
      total: 6,
      pending: 1,
      errors: 3,
      thirdParty: 1,
      truncated: false,
    });

    requestStore.ingestBatch(tab, 1, [make('ok', { url: 'https://site.test/a', state: 'failed', status: undefined })]);
    const stats = requestStore.getStats(tab);
    expect(stats.errors).toBe(4);
    expect(stats.total).toBe(6);

    requestStore.startPage(tab, 3, '');
    expect(requestStore.getStats(tab).thirdParty).toBe(0);
  });

  it('returns zeroed stats for unknown tabs', () => {
    expect(requestStore.getStats('missing')).toEqual({
      total: 0,
      pending: 0,
      errors: 0,
      thirdParty: 0,
      truncated: false,
    });
    expect(requestStore.getRequests('missing')).toEqual([]);
    expect(requestStore.getPage('missing')).toBeNull();
  });

  it('notifies subscribers once per batch tick with the affected tab id', async () => {
    const tab = 't-sub';
    const listener = vi.fn();
    const unsubscribe = requestStore.subscribe(listener);

    requestStore.startPage(tab, 1, 'https://site.test/');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(tab);

    requestStore.ingestBatch(tab, 1, [make('a')]);
    requestStore.ingestBatch(tab, 1, [make('b')]);
    expect(listener).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(tab);

    requestStore.clear(tab);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith(tab);

    requestStore.clear();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenLastCalledWith(undefined);

    unsubscribe();
    requestStore.startPage(tab, 9, 'https://site.test/');
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('lists tabs and clears them', () => {
    requestStore.startPage('x1', 1, 'https://site.test/one');
    requestStore.startPage('x2', 1, 'https://site.test/two');
    expect(requestStore.listTabs().sort()).toEqual(['x1', 'x2']);

    requestStore.clear('x1');
    expect(requestStore.listTabs()).toEqual(['x2']);
    expect(requestStore.getRequests('x1')).toEqual([]);
    expect(requestStore.getPage('x1')).toBeNull();

    requestStore.clear();
    expect(requestStore.listTabs()).toEqual([]);
  });
});
