import { describe, expect, it } from 'vitest';
import { classifyResourceType, isApiLike } from '../ResourceClassifier';

describe('classifyResourceType', () => {
  it('maps cdp types first', () => {
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'Document' })).toBe('document');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'Script' })).toBe('script');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'Stylesheet' })).toBe('stylesheet');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'Image' })).toBe('image');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'Font' })).toBe('font');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'Media' })).toBe('media');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'XHR' })).toBe('xhr');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'Fetch' })).toBe('fetch');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'EventSource' })).toBe('fetch');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'Prefetch' })).toBe('fetch');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'SignedExchange' })).toBe('fetch');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'WebSocket' })).toBe('websocket');
  });

  it('falls through to extension for unmapped cdp types', () => {
    expect(classifyResourceType({ url: 'https://x/app.js', cdpType: 'Other' })).toBe('script');
    expect(classifyResourceType({ url: 'https://x/a.bin', cdpType: 'Ping' })).toBe('other');
  });

  it('classifies by file extension', () => {
    expect(classifyResourceType({ url: 'https://x/lib/app.mjs' })).toBe('script');
    expect(classifyResourceType({ url: 'https://x/lib/app.cjs' })).toBe('script');
    expect(classifyResourceType({ url: 'https://x/style.css?v=3' })).toBe('stylesheet');
    expect(classifyResourceType({ url: 'https://x/img/photo.JPEG' })).toBe('image');
    expect(classifyResourceType({ url: 'https://x/img/icon.svg' })).toBe('image');
    expect(classifyResourceType({ url: 'https://x/f/inter.woff2' })).toBe('font');
    expect(classifyResourceType({ url: 'https://x/v/clip.mp4' })).toBe('media');
    expect(classifyResourceType({ url: 'https://x/v/stream.m3u8' })).toBe('media');
    expect(classifyResourceType({ url: 'https://x/data.json' })).toBe('other');
    expect(classifyResourceType({ url: 'https://x/data.xml' })).toBe('other');
    expect(classifyResourceType({ url: 'https://x/notes.txt' })).toBe('other');
  });

  it('ignores query and hash when reading the extension', () => {
    expect(classifyResourceType({ url: 'https://x/app.js#L10' })).toBe('script');
    expect(classifyResourceType({ url: 'https://x/img.png?width=100' })).toBe('image');
  });

  it('classifies by mime type when no extension matches', () => {
    expect(classifyResourceType({ url: 'https://x/endpoint', mimeType: 'application/javascript' })).toBe('script');
    expect(classifyResourceType({ url: 'https://x/endpoint', mimeType: 'text/css; charset=utf-8' })).toBe('stylesheet');
    expect(classifyResourceType({ url: 'https://x/endpoint', mimeType: 'image/webp' })).toBe('image');
    expect(classifyResourceType({ url: 'https://x/endpoint', mimeType: 'font/woff2' })).toBe('font');
    expect(classifyResourceType({ url: 'https://x/endpoint', mimeType: 'audio/mpeg' })).toBe('media');
    expect(classifyResourceType({ url: 'https://x/endpoint', mimeType: 'video/mp4' })).toBe('media');
    expect(classifyResourceType({ url: 'https://x/endpoint', mimeType: 'text/html' })).toBe('document');
    expect(classifyResourceType({ url: 'https://x/endpoint', mimeType: 'application/json' })).toBe('other');
  });

  it('returns other as the last resort', () => {
    expect(classifyResourceType({ url: 'https://x/some/path' })).toBe('other');
    expect(classifyResourceType({ url: 'not a url' })).toBe('other');
  });
});

describe('isApiLike', () => {
  it('is true for xhr and fetch types', () => {
    expect(isApiLike({ url: 'https://x/some/path', type: 'xhr', method: 'GET' })).toBe(true);
    expect(isApiLike({ url: 'https://x/some/path', type: 'fetch', method: 'GET' })).toBe(true);
  });

  it('is true for non-GET/HEAD verbs on non-asset urls', () => {
    expect(isApiLike({ url: 'https://x/submit', type: 'document', method: 'POST' })).toBe(true);
    expect(isApiLike({ url: 'https://x/thing', type: 'other', method: 'DELETE' })).toBe(true);
    expect(isApiLike({ url: 'https://x/submit', type: 'document', method: 'post' })).toBe(true);
  });

  it('is false for non-GET/HEAD verbs on asset urls', () => {
    expect(isApiLike({ url: 'https://x/static/app.js', type: 'script', method: 'POST' })).toBe(false);
    expect(isApiLike({ url: 'https://x/img.png', type: 'image', method: 'PUT' })).toBe(false);
  });

  it('is false for GET/HEAD on plain paths', () => {
    expect(isApiLike({ url: 'https://x/about', type: 'document', method: 'GET' })).toBe(false);
    expect(isApiLike({ url: 'https://x/img.png', type: 'image', method: 'HEAD' })).toBe(false);
  });

  it('detects api-ish pathnames case-insensitively', () => {
    expect(isApiLike({ url: 'https://x/api/users', type: 'other', method: 'GET' })).toBe(true);
    expect(isApiLike({ url: 'https://x/API/Users', type: 'other', method: 'GET' })).toBe(true);
    expect(isApiLike({ url: 'https://x/graphql', type: 'other', method: 'GET' })).toBe(true);
    expect(isApiLike({ url: 'https://x/rest/item', type: 'other', method: 'GET' })).toBe(true);
    expect(isApiLike({ url: 'https://x/v2/users', type: 'other', method: 'GET' })).toBe(true);
    expect(isApiLike({ url: 'https://x/users', type: 'document', method: 'GET' })).toBe(false);
    expect(isApiLike({ url: 'https://x/apiary', type: 'document', method: 'GET' })).toBe(false);
  });

  it('detects json/xml mime without file extension', () => {
    expect(isApiLike({ url: 'https://x/feed', type: 'other', method: 'GET', mimeType: 'application/json' })).toBe(true);
    expect(isApiLike({ url: 'https://x/feed', type: 'other', method: 'GET', mimeType: 'application/xml' })).toBe(true);
    expect(isApiLike({ url: 'https://x/data.json', type: 'other', method: 'GET', mimeType: 'application/json' })).toBe(false);
  });
});
