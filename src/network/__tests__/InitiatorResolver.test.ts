import { describe, expect, it } from 'vitest';
import { formatFrames, resolveInitiatorChain } from '../InitiatorResolver';
import type { NetworkRequest } from '../types';

const PAGE = 'https://site.test/app';
const ORIGIN = 'https://site.test';
const APP_JS = `${ORIGIN}/static/js/app.js`;

function req(partial: Partial<NetworkRequest> & { id: string; url: string }): NetworkRequest {
  return {
    method: 'GET',
    type: 'other',
    domain: 'site.test',
    startTime: 1000,
    state: 'finished',
    status: 200,
    pageLoadId: 1,
    ...partial,
  };
}

describe('resolveInitiatorChain', () => {
  it('walks script → script → page', () => {
    const pageDoc = req({ id: 'r0', url: PAGE, type: 'document' });
    const script = req({
      id: 'r1',
      url: APP_JS,
      type: 'script',
      initiatorInfo: { kind: 'parser', url: PAGE, frames: [] },
    });
    const api = req({
      id: 'r2',
      url: `${ORIGIN}/api/user`,
      type: 'fetch',
      initiatorInfo: {
        kind: 'script',
        url: APP_JS,
        frames: [{ url: APP_JS, functionName: 'loadUsers', lineNumber: 100, columnNumber: 2 }],
      },
    });

    const chain = resolveInitiatorChain(api, [pageDoc, script, api], PAGE);

    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({
      requestId: 'r1',
      url: APP_JS,
      label: 'app.js',
      method: 'GET',
      depth: 0,
    });
    expect(chain[0].frame?.functionName).toBe('loadUsers');
    expect(chain[1]).toMatchObject({ url: PAGE, depth: 1 });
    expect(chain[1].requestId).toBeUndefined();
  });

  it('prefers the same pageLoadId, then the latest startTime', () => {
    const api = req({
      id: 'r2',
      url: `${ORIGIN}/api/user`,
      initiatorInfo: { kind: 'script', url: APP_JS, frames: [] },
    });
    const sameLoadOld = req({ id: 'x1', url: APP_JS, pageLoadId: 1, startTime: 500 });
    const otherLoadNew = req({ id: 'x2', url: APP_JS, pageLoadId: 2, startTime: 900 });

    const chain = resolveInitiatorChain(api, [otherLoadNew, sameLoadOld, api], PAGE);
    expect(chain[0].requestId).toBe('x1');

    const older = req({ id: 'x3', url: APP_JS, pageLoadId: 1, startTime: 100 });
    const newer = req({ id: 'x4', url: APP_JS, pageLoadId: 1, startTime: 900 });
    const chain2 = resolveInitiatorChain(api, [older, newer, api], PAGE);
    expect(chain2[0].requestId).toBe('x4');
  });

  it('stops on cycles without repeating entries', () => {
    const a = req({
      id: 'ra',
      url: `${ORIGIN}/a`,
      initiatorInfo: { kind: 'script', url: `${ORIGIN}/b`, frames: [] },
    });
    const b = req({
      id: 'rb',
      url: `${ORIGIN}/b`,
      initiatorInfo: { kind: 'script', url: `${ORIGIN}/a`, frames: [] },
    });

    const chain = resolveInitiatorChain(a, [a, b], PAGE);
    expect(chain).toHaveLength(1);
    expect(chain[0].requestId).toBe('rb');
  });

  it('does not loop on a self initiator', () => {
    const self = req({
      id: 'self',
      url: `${ORIGIN}/self`,
      initiatorInfo: { kind: 'script', url: `${ORIGIN}/self`, frames: [] },
    });
    const chain = resolveInitiatorChain(self, [self], PAGE);
    expect(chain).toHaveLength(0);
  });

  it('follows redirectedFrom for redirect initiators', () => {
    const script = req({
      id: 'rs',
      url: APP_JS,
      initiatorInfo: { kind: 'parser', url: PAGE, frames: [] },
    });
    const hopA = req({
      id: 'r1',
      url: `${ORIGIN}/old`,
      initiatorInfo: {
        kind: 'script',
        url: APP_JS,
        frames: [{ url: APP_JS, functionName: 'go', lineNumber: 10 }],
      },
    });
    const hopB = req({
      id: 'r2',
      url: `${ORIGIN}/new`,
      redirectedFrom: 'r1',
      initiatorInfo: { kind: 'redirect', url: `${ORIGIN}/old`, frames: [] },
    });

    const chain = resolveInitiatorChain(hopB, [script, hopA, hopB], PAGE);

    expect(chain).toHaveLength(3);
    expect(chain[0]).toMatchObject({ requestId: 'r1', url: `${ORIGIN}/old`, depth: 0 });
    expect(chain[1]).toMatchObject({ requestId: 'rs', url: APP_JS, depth: 1 });
    expect(chain[2]).toMatchObject({ url: PAGE, depth: 2 });
    expect(chain[2].requestId).toBeUndefined();
  });

  it('returns an empty chain when there is no initiator', () => {
    const plain = req({ id: 'p1', url: `${ORIGIN}/x` });
    expect(resolveInitiatorChain(plain, [plain], PAGE)).toEqual([]);

    const empty = req({
      id: 'p2',
      url: `${ORIGIN}/y`,
      initiatorInfo: { kind: 'other', frames: [] },
    });
    expect(resolveInitiatorChain(empty, [empty], PAGE)).toEqual([]);
  });

  it('caps the chain at 24 levels', () => {
    const list: NetworkRequest[] = [];
    for (let i = 0; i < 30; i += 1) {
      list.push(req({
        id: `c${i}`,
        url: `${ORIGIN}/l${i}`,
        initiatorInfo: { kind: 'script', url: `${ORIGIN}/l${i + 1}`, frames: [] },
      }));
    }
    const chain = resolveInitiatorChain(list[0], list, PAGE);
    expect(chain.length).toBeLessThanOrEqual(24);
    expect(chain[0].url).toBe(`${ORIGIN}/l1`);
  });

  it('stops at the page even for script initiators', () => {
    const pageDoc = req({ id: 'r0', url: PAGE, type: 'document' });
    const inline = req({
      id: 'r1',
      url: `${ORIGIN}/inline`,
      initiatorInfo: { kind: 'script', url: PAGE, frames: [{ url: PAGE, lineNumber: 5 }] },
    });
    const chain = resolveInitiatorChain(inline, [pageDoc, inline], PAGE);
    expect(chain).toHaveLength(1);
    expect(chain[0].url).toBe(PAGE);
    expect(chain[0].requestId).toBeUndefined();
    expect(chain[0].frame?.lineNumber).toBe(5);
  });
});

describe('formatFrames', () => {
  it('renders the request line plus initiator frames with 1-based lines', () => {
    const api = req({
      id: 'r1',
      url: `${ORIGIN}/api/user?page=2`,
      type: 'fetch',
      initiatorInfo: {
        kind: 'script',
        url: APP_JS,
        frames: [
          { url: APP_JS, functionName: 'loadUsers', lineNumber: 2840, columnNumber: 3 },
          { url: APP_JS, functionName: '', lineNumber: 119 },
          { url: `${ORIGIN}/index.html`, lineNumber: 2840 },
        ],
      },
    });

    const lines = formatFrames(api);

    expect(lines[0]).toEqual({
      depth: 0,
      text: 'GET /api/user?page=2',
      url: `${ORIGIN}/api/user?page=2`,
      requestId: 'r1',
    });
    expect(lines[1]).toMatchObject({ depth: 1, text: 'loadUsers (app.js:2841)', url: APP_JS });
    expect(lines[2].text).toBe('app.js:120');
    expect(lines[3].text).toBe('index.html:2841');
  });

  it('returns only the request line when there is no initiator info', () => {
    const plain = req({ id: 'q1', url: `${ORIGIN}/x`, method: 'POST' });
    const lines = formatFrames(plain);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('POST /x');
    expect(lines[0].depth).toBe(0);
  });

  it('falls back to the short label for unparseable urls', () => {
    const broken = req({ id: 'q2', url: 'not a url', method: 'GET' });
    const lines = formatFrames(broken);
    expect(lines[0].text).toBe('GET not a url');
  });

  it('caps rendered frames at six', () => {
    const frames = Array.from({ length: 8 }, (_, i) => ({
      url: `${ORIGIN}/s.js`,
      functionName: `fn${i}`,
      lineNumber: i,
    }));
    const tracked = req({
      id: 'q3',
      url: `${ORIGIN}/data`,
      initiatorInfo: { kind: 'script', url: APP_JS, frames },
    });
    const lines = formatFrames(tracked);
    expect(lines).toHaveLength(7);
    expect(lines[6].text).toBe('fn5 (s.js:6)');
  });
});
