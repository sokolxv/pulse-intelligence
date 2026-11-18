import { describe, expect, it } from 'vitest';
import type { NetworkRequest } from '../../network/types';
import {
  buildTimeline,
  decodeBody,
  formatBytes,
  formatDuration,
  parseCookies,
  prettyBody,
  prettyHeaders,
  queryParams,
  statusLabel,
  statusTone,
} from '../format';

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/user',
    method: 'GET',
    type: 'xhr',
    domain: 'api.example.com',
    startTime: 1_700_000_000_000,
    state: 'finished',
    ...overrides,
  };
}

describe('formatBytes', () => {
  it('returns em dash for undefined', () => {
    expect(formatBytes(undefined)).toBe('—');
  });

  it('formats zero and byte values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(420)).toBe('420 B');
  });

  it('formats kilobytes with one decimal', () => {
    expect(formatBytes(4301)).toBe('4.2 KB');
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(formatBytes(1_363_149)).toBe('1.3 MB');
    expect(formatBytes(1_048_576)).toBe('1 MB');
  });
});

describe('formatDuration', () => {
  it('returns em dash for undefined', () => {
    expect(formatDuration(undefined)).toBe('—');
  });

  it('handles sub-millisecond values', () => {
    expect(formatDuration(0)).toBe('<1 ms');
    expect(formatDuration(0.4)).toBe('<1 ms');
  });

  it('formats milliseconds', () => {
    expect(formatDuration(142)).toBe('142 ms');
    expect(formatDuration(999)).toBe('999 ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1420)).toBe('1.42 s');
    expect(formatDuration(2500)).toBe('2.5 s');
    expect(formatDuration(1000)).toBe('1 s');
  });
});

describe('statusLabel', () => {
  it('uses statusText when given', () => {
    expect(statusLabel(200, 'OK')).toBe('200 OK');
    expect(statusLabel(403, 'Forbidden')).toBe('403 Forbidden');
  });

  it('falls back to reason phrases', () => {
    expect(statusLabel(200)).toBe('200 OK');
    expect(statusLabel(201)).toBe('201 Created');
    expect(statusLabel(404)).toBe('404 Not Found');
    expect(statusLabel(503)).toBe('503 Service Unavailable');
  });

  it('returns bare code for unknown statuses', () => {
    expect(statusLabel(599)).toBe('599');
    expect(statusLabel(599, '  ')).toBe('599');
  });

  it('handles missing status by state', () => {
    expect(statusLabel(undefined)).toBe('Pending');
    expect(statusLabel(undefined, undefined, 'pending')).toBe('Pending');
    expect(statusLabel(undefined, undefined, 'failed')).toBe('Failed');
    expect(statusLabel(undefined, undefined, 'canceled')).toBe('Failed');
  });
});

describe('statusTone', () => {
  it('maps failed and canceled states to error', () => {
    expect(statusTone(undefined, 'failed')).toBe('error');
    expect(statusTone(200, 'canceled')).toBe('error');
  });

  it('maps pending state', () => {
    expect(statusTone(undefined, 'pending')).toBe('pending');
  });

  it('maps status classes', () => {
    expect(statusTone(200, 'finished')).toBe('ok');
    expect(statusTone(204)).toBe('ok');
    expect(statusTone(302)).toBe('redirect');
    expect(statusTone(404)).toBe('warn');
    expect(statusTone(500)).toBe('error');
    expect(statusTone(undefined, 'finished')).toBe('muted');
  });
});

describe('queryParams', () => {
  it('returns empty for empty url and urls without query', () => {
    expect(queryParams('')).toEqual([]);
    expect(queryParams('https://example.com/page')).toEqual([]);
  });

  it('parses names, values and decoding', () => {
    expect(queryParams('https://x.com/p?a=1&b=two%20words&flag')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'two words' },
      { name: 'flag', value: '' },
    ]);
  });

  it('ignores the hash part', () => {
    expect(queryParams('https://x.com/p?a=1#section')).toEqual([{ name: 'a', value: '1' }]);
  });
});

describe('buildTimeline', () => {
  it('builds all phases from full timing', () => {
    const request = makeRequest({
      duration: 500,
      timing: {
        dnsStart: 1,
        dnsEnd: 11,
        connectStart: 11,
        connectEnd: 61,
        sslStart: 21,
        sslEnd: 51,
        sendStart: 62,
        sendEnd: 65,
        receiveHeadersEnd: 300,
      },
    });
    const { total, segments } = buildTimeline(request);
    expect(total).toBe(500);
    expect(segments.map((s) => s.key)).toEqual([
      'dns',
      'connect',
      'secure',
      'send',
      'wait',
      'download',
    ]);
    const tls = segments.find((s) => s.key === 'secure');
    expect(tls).toMatchObject({ start: 21, end: 51, label: 'TLS' });
    const wait = segments.find((s) => s.key === 'wait');
    expect(wait).toMatchObject({ start: 65, end: 300, label: 'Waiting' });
    const download = segments.find((s) => s.key === 'download');
    expect(download).toMatchObject({ start: 300, end: 500 });
  });

  it('handles partial timing', () => {
    const request = makeRequest({
      timing: { sendStart: 0, sendEnd: 5, receiveHeadersEnd: 120 },
    });
    const { total, segments } = buildTimeline(request);
    expect(segments.map((s) => s.key)).toEqual(['send', 'wait']);
    expect(segments[1]).toMatchObject({ start: 5, end: 120 });
    expect(total).toBe(120);
  });

  it('skips degenerate segments', () => {
    const request = makeRequest({
      duration: 100,
      timing: {
        dnsStart: 10,
        dnsEnd: 10,
        connectStart: 20,
        connectEnd: 15,
        sendStart: 5,
        sendEnd: 5,
      },
    });
    const { total, segments } = buildTimeline(request);
    const keys = segments.map((s) => s.key);
    expect(keys).not.toContain('dns');
    expect(keys).not.toContain('connect');
    expect(keys).not.toContain('send');
    expect(total).toBe(100);
  });

  it('falls back to a total segment when no timing but duration known', () => {
    const { total, segments } = buildTimeline(makeRequest({ duration: 250 }));
    expect(total).toBe(250);
    expect(segments).toEqual([
      { key: 'total', label: 'Total', start: 0, end: 250, tone: 'block' },
    ]);
  });

  it('returns empty segments and zero total without timing or duration', () => {
    const { total, segments } = buildTimeline(makeRequest());
    expect(total).toBe(0);
    expect(segments).toEqual([]);
  });
});

describe('prettyHeaders', () => {
  it('sorts alphabetically by name', () => {
    expect(
      prettyHeaders({
        'content-type': 'application/json',
        accept: '*/*',
        'x-custom': '1',
      }),
    ).toEqual([
      { name: 'accept', value: '*/*' },
      { name: 'content-type', value: 'application/json' },
      { name: 'x-custom', value: '1' },
    ]);
  });

  it('returns empty array for missing headers', () => {
    expect(prettyHeaders(undefined)).toEqual([]);
  });
});

describe('parseCookies', () => {
  it('parses cookie pairs', () => {
    expect(parseCookies('a=1; b=2; c=')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'c', value: '' },
    ]);
  });

  it('keeps equals signs inside values', () => {
    expect(parseCookies('session=abc=def')).toEqual([{ name: 'session', value: 'abc=def' }]);
  });

  it('handles empty and missing input', () => {
    expect(parseCookies('')).toEqual([]);
    expect(parseCookies(undefined)).toEqual([]);
  });
});

describe('prettyBody', () => {
  it('pretty prints valid JSON', () => {
    const result = prettyBody('{"a":1}', 'application/json');
    expect(result.isJson).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe('{\n  "a": 1\n}');
  });

  it('keeps invalid JSON as-is', () => {
    const result = prettyBody('not-json', 'application/json');
    expect(result.isJson).toBe(false);
    expect(result.text).toBe('not-json');
  });

  it('detects JSON by content even without json mime', () => {
    const result = prettyBody('[1,2]');
    expect(result.isJson).toBe(true);
    expect(result.text).toBe('[\n  1,\n  2\n]');
  });

  it('truncates bodies above 200k chars', () => {
    const result = prettyBody('x'.repeat(300_000), 'text/plain');
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('x'.repeat(200_000))).toBe(true);
    expect(result.text.endsWith('\n… (truncated)')).toBe(true);
  });

  it('does not truncate small bodies', () => {
    const result = prettyBody('hello', 'text/plain');
    expect(result.truncated).toBe(false);
    expect(result.text).toBe('hello');
  });
});

describe('decodeBody', () => {
  it('returns plain body unchanged', () => {
    expect(decodeBody({ ok: true, body: 'hello' })).toBe('hello');
  });

  it('decodes base64 bodies as UTF-8', () => {
    const encoded = Buffer.from('héllo', 'utf-8').toString('base64');
    expect(decodeBody({ ok: true, body: encoded, base64Encoded: true })).toBe('héllo');
  });

  it('returns empty string on invalid base64', () => {
    expect(decodeBody({ ok: true, body: '!!!not-base64!!!', base64Encoded: true })).toBe('');
  });

  it('returns empty string when body missing', () => {
    expect(decodeBody({ ok: false })).toBe('');
  });
});
