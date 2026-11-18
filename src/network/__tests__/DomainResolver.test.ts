import { describe, expect, it } from 'vitest';
import {
  getHost,
  getOrigin,
  isThirdParty,
  normalizeHost,
  parseQuery,
  registrableDomain,
  shortLabel,
} from '../DomainResolver';

describe('getHost / getOrigin', () => {
  it('extracts host and origin', () => {
    expect(getHost('https://www.example.com/path?q=1')).toBe('www.example.com');
    expect(getHost('https://example.com:8443/x')).toBe('example.com');
    expect(getOrigin('https://example.com:8443/x')).toBe('https://example.com:8443');
    expect(getOrigin('https://example.com/x')).toBe('https://example.com');
  });

  it('returns empty string on parse failure', () => {
    expect(getHost('not a url')).toBe('');
    expect(getOrigin('')).toBe('');
  });
});

describe('normalizeHost', () => {
  it('lowercases, trims trailing dots and strips www', () => {
    expect(normalizeHost('WWW.Example.COM')).toBe('example.com');
    expect(normalizeHost(' example.com. ')).toBe('example.com');
    expect(normalizeHost('www.example.com')).toBe('example.com');
    expect(normalizeHost('api.example.com')).toBe('api.example.com');
  });
});

describe('registrableDomain', () => {
  it('returns eTLD+1 for plain domains', () => {
    expect(registrableDomain('example.com')).toBe('example.com');
    expect(registrableDomain('www.example.com')).toBe('example.com');
    expect(registrableDomain('a.b.c.example.com')).toBe('example.com');
    expect(registrableDomain('sub.example.org')).toBe('example.org');
  });

  it('handles multi-label public suffixes', () => {
    expect(registrableDomain('www.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('foo.bar.gov.uk')).toBe('bar.gov.uk');
    expect(registrableDomain('shop.store.com.au')).toBe('store.com.au');
    expect(registrableDomain('x.ne.jp')).toBe('x.ne.jp');
    expect(registrableDomain('sub.domain.co.in')).toBe('domain.co.in');
  });

  it('returns IP literals and short hosts as-is', () => {
    expect(registrableDomain('192.168.1.1')).toBe('192.168.1.1');
    expect(registrableDomain('localhost')).toBe('localhost');
    expect(registrableDomain('example.com')).toBe('example.com');
    expect(registrableDomain('')).toBe('');
  });
});

describe('isThirdParty', () => {
  it('treats subdomains of the same registrable domain as first party', () => {
    expect(isThirdParty('https://www.example.com/home', 'https://api.example.com/users')).toBe(false);
    expect(isThirdParty('example.com', 'cdn.example.com')).toBe(false);
    expect(isThirdParty('https://example.co.uk/', 'https://www.example.co.uk/x')).toBe(false);
  });

  it('detects different registrable domains', () => {
    expect(isThirdParty('https://example.com/', 'https://analytics.com/collect')).toBe(true);
    expect(isThirdParty('example.com', 'example.net')).toBe(true);
    expect(isThirdParty('https://example.com/', 'https://sub.analytics.example.net/x')).toBe(true);
  });

  it('is false when the page side is empty', () => {
    expect(isThirdParty('', 'https://example.com/')).toBe(false);
    expect(isThirdParty('   ', 'example.com')).toBe(false);
  });

  it('accepts bare hosts and full urls on both sides', () => {
    expect(isThirdParty('example.com', 'https://cdn.example.com/app.js')).toBe(false);
    expect(isThirdParty('https://example.com/page', 'cdn.other.org')).toBe(true);
  });
});

describe('shortLabel', () => {
  it('returns the host for document-ish paths', () => {
    expect(shortLabel('https://example.com/')).toBe('example.com');
    expect(shortLabel('https://example.com/index.html')).toBe('example.com');
    expect(shortLabel('https://example.com/docs/page.htm')).toBe('example.com');
  });

  it('returns basename for assets', () => {
    expect(shortLabel('https://example.com/static/js/app.js')).toBe('app.js');
    expect(shortLabel('https://example.com/img/photo.png?v=2')).toBe('photo.png');
    expect(shortLabel('https://example.com/fonts/inter.woff2')).toBe('inter.woff2');
  });

  it('returns pathname for extensionless and json/xml paths', () => {
    expect(shortLabel('https://example.com/api/users')).toBe('/api/users');
    expect(shortLabel('https://example.com/data.json')).toBe('/data.json');
    expect(shortLabel('https://example.com/feed.xml?full=1')).toBe('/feed.xml?full=1');
    expect(shortLabel('https://example.com/api/users?page=2&q=abc')).toBe('/api/users?page=2&q=abc');
  });

  it('drops the query when the result would exceed 60 chars', () => {
    const long = `https://example.com/api/items?cursor=${'x'.repeat(80)}`;
    const label = shortLabel(long);
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label.startsWith('/api/items')).toBe(true);
  });

  it('returns truncated input on parse failure', () => {
    expect(shortLabel('not a url')).toBe('not a url');
    const long = 'y'.repeat(100);
    expect(shortLabel(long)).toBe('y'.repeat(60));
  });
});

describe('parseQuery', () => {
  it('parses query params into name/value pairs', () => {
    expect(parseQuery('https://example.com/p?a=1&b=two')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'two' },
    ]);
  });

  it('handles encoded values, duplicates and missing query', () => {
    expect(parseQuery('https://example.com/p?q=hello%20world')).toEqual([
      { name: 'q', value: 'hello world' },
    ]);
    expect(parseQuery('https://example.com/p?x=1&x=2')).toEqual([
      { name: 'x', value: '1' },
      { name: 'x', value: '2' },
    ]);
    expect(parseQuery('https://example.com/p')).toEqual([]);
    expect(parseQuery('')).toEqual([]);
  });

  it('parses query from urls the URL constructor rejects', () => {
    expect(parseQuery('relative?foo=bar')).toEqual([{ name: 'foo', value: 'bar' }]);
  });
});
