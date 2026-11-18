/**
 * Pulse Browser — Built-in Ad & Tracker Blocker
 *
 * Loads lightweight filter lists and intercepts web requests
 * via Electron's session.webRequest API.
 * Also tracks per-site/per-tab blocked requests for Privacy Dashboard.
 */

const { session } = require('electron');

// ── Bundled filter patterns ─────────────────────────────────
// Compact regex-safe patterns for common ad/tracker domains
const AD_DOMAINS = [
  // Major ad networks
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'adnxs.com', 'adsrvr.org', 'advertising.com', 'adskeeper.com',
  'adsafeprotected.com', 'adform.net', 'adjug.com', 'adroll.com',
  // Social trackers
  'facebook.com/tr', 'facebook.net/rfbeacon', 'connect.facebook.net',
  'analytics.twitter.com', 'ads.twitter.com', 'platform.twitter.com',
  'pixel.facebook.com', 'snap.licdn.com',
  // Tracking pixels & analytics
  'hotjar.com', 'mouseflow.com', 'crazyegg.com', 'clicktale.com',
  'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com',
  'heap.io', 'fullstory.com', 'logrocket.com', 'sentry.io',
  'bugsnag.com', 'newrelic.com', 'chartbeat.com', 'parsely.com',
  'quantserve.com', 'scorecardresearch.com', 'bluekai.com',
  'demdex.net', 'omtrdc.net', 'everesttech.net', 'rlcdn.com',
  'liadm.com', 'bidswitch.net', 'rubiconproject.com',
  'pubmatic.com', 'openx.net', 'criteo.com', 'criteo.net',
  'taboola.com', 'outbrain.com', 'yieldmo.com', 'sharethrough.com',
  // Crypto miners
  'coinhive.com', 'coin-hive.com', 'cryptaloot.pro',
  // Fingerprinting
  'fingerprint.com', 'fpjs.io',
];

// ── URL filter patterns (regex-safe strings) ────────────────
const AD_URL_PATTERNS = [
  // Generic ad paths
  '/ads/', '/ad/', '/advert/', '/adverts/', '/advertising/',
  '/banner/', '/banners/', '/popup/', '/popunder/',
  '/tracking/', '/track/', '/pixel/', '/beacon/',
  '/analytics/', '/collect', '/event?', '/events?',
  '/pagead/', '/adsense/', '/doubleclick/',
  // Social tracking
  '/tr?', '/fbeacon?', '/pixel?',
  // Analytics
  '/analytics.js', '/gtag/', '/ga.js', '/gtm.js',
];

// ── Tracker domains that should be fully blocked ────────────
const TRACKER_DOMAINS = [
  'facebook.com/tr', 'facebook.net/rfbeacon',
  'analytics.twitter.com', 'ads.twitter.com',
  'snap.licdn.com',
];

// ── Categorized domains for Privacy Dashboard ───────────────
const CATEGORY_DEFS = {
  ads: [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'googletagservices.com', 'adnxs.com', 'adsrvr.org', 'advertising.com',
    'adskeeper.com', 'adsafeprotected.com', 'adform.net', 'adjug.com', 'adroll.com',
    'pubmatic.com', 'openx.net', 'criteo.com', 'criteo.net',
    'taboola.com', 'outbrain.com', 'yieldmo.com', 'sharethrough.com',
    'bidswitch.net', 'rubiconproject.com', 'quantserve.com', 'scorecardresearch.com',
    'bluekai.com', 'demdex.net', 'omtrdc.net', 'everesttech.net', 'rlcdn.com',
    'liadm.com',
  ],
  analytics: [
    'google-analytics.com', 'googletagmanager.com',
    'hotjar.com', 'mouseflow.com', 'crazyegg.com', 'clicktale.com',
    'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com',
    'heap.io', 'fullstory.com', 'logrocket.com', 'sentry.io',
    'bugsnag.com', 'newrelic.com', 'chartbeat.com', 'parsely.com',
  ],
  social: [
    // host-only part for social; path-specific handled via full-match
    'connect.facebook.net', 'platform.twitter.com',
    'facebook.com', 'facebook.net', // will match via full string for tr/rfbeacon
    'analytics.twitter.com', 'ads.twitter.com',
    'pixel.facebook.com', 'snap.licdn.com',
  ],
  crypto: [
    'coinhive.com', 'coin-hive.com', 'cryptaloot.pro',
  ],
  other: [
    'fingerprint.com', 'fpjs.io',
  ],
};

const SOCIAL_FULL_PATTERNS = [
  'facebook.com/tr', 'facebook.net/rfbeacon',
  'analytics.twitter.com', 'ads.twitter.com',
  'snap.licdn.com', 'pixel.facebook.com',
];

const PATTERN_CATEGORY_MAP = {
  '/ads/': 'ads', '/ad/': 'ads', '/advert/': 'ads', '/adverts/': 'ads', '/advertising/': 'ads',
  '/banner/': 'ads', '/banners/': 'ads', '/popup/': 'ads', '/popunder/': 'ads',
  '/pagead/': 'ads', '/adsense/': 'ads', '/doubleclick/': 'ads',
  '/tracking/': 'analytics', '/track/': 'analytics', '/pixel/': 'analytics', '/beacon/': 'analytics',
  '/analytics/': 'analytics', '/collect': 'analytics', '/event?': 'analytics', '/events?': 'analytics',
  '/tr?': 'social', '/fbeacon?': 'social', '/pixel?': 'social',
  '/analytics.js': 'analytics', '/gtag/': 'analytics', '/ga.js': 'analytics', '/gtm.js': 'analytics',
};

class AdBlocker {
  constructor() {
    this.enabled = true;
    this.blockCount = 0;
    this.sessionPartition = 'persist:main';
    this.sessionPartitions = ['persist:main', 'persist:private', 'private'];

    this.adDomainSet = new Set(AD_DOMAINS);
    this.trackerDomainSet = new Set(TRACKER_DOMAINS);

    const escaped = AD_URL_PATTERNS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    this.urlPattern = new RegExp(`(${escaped.join('|')})`, 'i');

    this.perSiteMap = new Map();
    this.disabledSites = new Set();
    this.mainWindowGetter = null;
    this.recentGlobal = [];
  }

  setMainWindowGetter(fn) {
    this.mainWindowGetter = fn;
  }

  getCategoryForBlockedUrl(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const full = host + parsed.pathname;
      const pathLower = parsed.pathname.toLowerCase() + parsed.search.toLowerCase();
      const fullLower = full.toLowerCase();

      for (const pat of SOCIAL_FULL_PATTERNS) {
        if (fullLower.includes(pat.toLowerCase())) return { category: 'social', domain: host };
      }
      for (const d of CATEGORY_DEFS.crypto) {
        if (host === d || host.endsWith('.' + d)) return { category: 'crypto', domain: host };
      }
      for (const d of CATEGORY_DEFS.social) {
        if (host === d || host.endsWith('.' + d)) return { category: 'social', domain: host };
      }
      for (const d of CATEGORY_DEFS.analytics) {
        if (host === d || host.endsWith('.' + d)) return { category: 'analytics', domain: host };
      }
      for (const d of CATEGORY_DEFS.other) {
        if (host === d || host.endsWith('.' + d)) return { category: 'other', domain: host };
      }
      for (const d of CATEGORY_DEFS.ads) {
        if (host === d || host.endsWith('.' + d)) return { category: 'ads', domain: host };
      }
      // fallback to generic AD_DOMAINS suffix check -> ads
      for (const domain of this.adDomainSet) {
        if (domain.includes('/')) continue;
        if (host === domain || host.endsWith('.' + domain)) {
          // try to infer better but default ads
          return { category: 'ads', domain: host };
        }
      }
      if (this.trackerDomainSet.has(fullLower) || SOCIAL_FULL_PATTERNS.some(p=>fullLower.includes(p))) {
        return { category: 'social', domain: host };
      }
      // URL patterns
      const lowerUrl = url.toLowerCase();
      for (const pat of AD_URL_PATTERNS) {
        if (lowerUrl.includes(pat.toLowerCase())) {
          const cat = PATTERN_CATEGORY_MAP[pat] || 'ads';
          return { category: cat, domain: host };
        }
      }
      return { category: 'other', domain: host };
    } catch {
      return { category: 'other', domain: url };
    }
  }

  getBlockInfo(url, resourceType) {
    if (!this.enabled || !url) return { blocked: false, category: null, domain: null };
    if (resourceType === 'mainFrame' || resourceType === 'mainframe') return { blocked: false, category: null, domain: null };
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const full = host + parsed.pathname;
      const fullLower = full.toLowerCase();

      if (this.trackerDomainSet.has(fullLower)) {
        const info = this.getCategoryForBlockedUrl(url);
        return { blocked: true, category: info.category, domain: host };
      }
      for (const domain of this.adDomainSet) {
        if (domain.includes('/')) {
          if (fullLower.includes(domain.toLowerCase())) {
            const info = this.getCategoryForBlockedUrl(url);
            return { blocked: true, category: info.category, domain: host };
          }
        } else {
          if (host === domain || host.endsWith('.' + domain)) {
            const info = this.getCategoryForBlockedUrl(url);
            return { blocked: true, category: info.category, domain: host };
          }
        }
      }
      if (this.urlPattern.test(url)) {
        const path = parsed.pathname.toLowerCase();
        if (path.startsWith('/api/') || path.startsWith('/v1/') || path.startsWith('/v2/') || path.startsWith('/graphql')) {
          return { blocked: false, category: null, domain: null };
        }
        const info = this.getCategoryForBlockedUrl(url);
        return { blocked: true, category: info.category, domain: host };
      }
      return { blocked: false, category: null, domain: null };
    } catch {
      return { blocked: false, category: null, domain: null };
    }
  }

  shouldBlock(url, resourceType) {
    const info = this.getBlockInfo(url, resourceType);
    return info.blocked;
  }

  serializeEntry(entry) {
    const domainsObj = {};
    const sortedDomains = [...entry.domains.entries()].sort((a,b)=>b[1].count - a[1].count);
    for (const [d, v] of sortedDomains) {
      domainsObj[d] = { count: v.count, category: v.category };
    }
    return {
      hostname: entry.hostname,
      count: entry.count,
      categories: { ...entry.categories },
      domains: domainsObj,
      recent: entry.recent.slice(0, 20),
      lastBlockedAt: entry.lastBlockedAt,
      blocked: entry.count,
    };
  }

  getPerSiteStats() {
    const arr = [];
    for (const entry of this.perSiteMap.values()) {
      if (entry.hostname === '__global__') continue;
      arr.push(this.serializeEntry(entry));
    }
    arr.sort((a,b)=>b.count - a.count);
    return arr;
  }

  getSiteStats(hostname) {
    if (!hostname) return null;
    const key = hostname.toLowerCase();
    const entry = this.perSiteMap.get(key);
    if (!entry) return { hostname: key, count: 0, categories: { ads:0, analytics:0, social:0, crypto:0, other:0 }, domains: {}, recent: [], lastBlockedAt: null, blocked: 0 };
    return this.serializeEntry(entry);
  }

  getAllStats() {
    const perSite = this.getPerSiteStats();
    return {
      enabled: this.enabled,
      blockCount: this.blockCount,
      filterCount: AD_DOMAINS.length + AD_URL_PATTERNS.length + TRACKER_DOMAINS.length,
      perSite,
      disabledSites: [...this.disabledSites],
      recentGlobal: this.recentGlobal.slice(0, 50),
    };
  }

  toggleSite(hostname, enabled) {
    if (!hostname) return;
    const key = hostname.toLowerCase();
    if (enabled) {
      this.disabledSites.delete(key);
    } else {
      this.disabledSites.add(key);
    }
    // notify renderer about site toggle
    try {
      const win = this.mainWindowGetter ? this.mainWindowGetter() : null;
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('adblocker-site-toggle', { hostname: key, enabled: !this.disabledSites.has(key) });
      }
    } catch {}
  }

  isSiteEnabled(hostname) {
    if (!hostname) return true;
    return !this.disabledSites.has(hostname.toLowerCase());
  }

  clearSite(hostname) {
    if (!hostname) return;
    const key = hostname.toLowerCase();
    this.perSiteMap.delete(key);
    // adjust global count? we keep global but we could subtract? For now keep global, just clear per-site.
    // Also remove from recentGlobal those that match siteHost
    this.recentGlobal = this.recentGlobal.filter(r => r.siteHost !== key);
    try {
      const win = this.mainWindowGetter ? this.mainWindowGetter() : null;
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('adblocker-update', { siteHost: key, cleared: true, globalCount: this.blockCount, siteStats: this.getSiteStats(key) });
      }
    } catch {}
  }

  clearAll() {
    this.perSiteMap.clear();
    this.recentGlobal = [];
    this.blockCount = 0;
    try {
      const win = this.mainWindowGetter ? this.mainWindowGetter() : null;
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('adblocker-update', { clearedAll: true, globalCount: 0 });
      }
    } catch {}
  }

  attachToSession(ses) {
    if (!ses) return;
    ses.webRequest.onBeforeRequest(
      {
        urls: ['*://*/*'],
      },
      (details, callback) => {
        const info = this.getBlockInfo(details.url, details.resourceType);
        if (!info.blocked) {
          callback({ cancel: false });
          return;
        }

        // per-site disable check
        let siteHost = null;
        try {
          if (details.webContentsId) {
            try {
              const { webContents } = require('electron');
              const contents = webContents.fromId(details.webContentsId);
              if (contents) {
                const pageUrl = contents.getURL();
                if (pageUrl && pageUrl !== 'about:blank' && !pageUrl.startsWith('devtools://')) {
                  try { siteHost = new URL(pageUrl).hostname.toLowerCase(); } catch {}
                }
                if (!siteHost && contents.getURL) {
                  // fallback to referrer from details
                }
              }
            } catch {}
          }
          if (!siteHost && details.referrer) {
            try { siteHost = new URL(details.referrer).hostname.toLowerCase(); } catch {}
          }
          const initiator = details.initiator || details.documentURL;
          if (!siteHost && initiator) {
            try { siteHost = new URL(initiator).hostname.toLowerCase(); } catch {}
          }
        } catch {}

        if (!siteHost) siteHost = '__global__';

        if (siteHost !== '__global__' && this.disabledSites.has(siteHost)) {
          callback({ cancel: false });
          return;
        }

        this.blockCount++;

        let entry = this.perSiteMap.get(siteHost);
        if (!entry) {
          entry = { hostname: siteHost, count: 0, domains: new Map(), categories: { ads: 0, analytics: 0, social: 0, crypto: 0, other: 0 }, recent: [], lastBlockedAt: Date.now() };
          this.perSiteMap.set(siteHost, entry);
        }
        entry.count++;
        entry.lastBlockedAt = Date.now();
        const cat = info.category || 'other';
        if (entry.categories[cat] !== undefined) entry.categories[cat]++;
        else entry.categories['other']++;

        const d = info.domain || (()=>{ try{return new URL(details.url).hostname.toLowerCase();}catch{return details.url;}})();
        const prev = entry.domains.get(d) || { count: 0, category: cat };
        prev.count++;
        prev.category = cat;
        entry.domains.set(d, prev);

        const rec = { url: details.url, domain: d, category: cat, timestamp: Date.now(), siteHost };
        entry.recent.unshift(rec);
        if (entry.recent.length > 100) entry.recent.pop();

        this.recentGlobal.unshift(rec);
        if (this.recentGlobal.length > 500) this.recentGlobal.pop();

        try {
          const win = this.mainWindowGetter ? this.mainWindowGetter() : null;
          if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.send('adblocker-update', {
              siteHost,
              url: details.url,
              domain: d,
              category: cat,
              count: entry.count,
              blocked: entry.count,
              globalCount: this.blockCount,
              siteStats: this.serializeEntry(entry),
            });
          }
        } catch {}

        callback({ cancel: true });
      }
    );
  }

  detachFromSession(ses) {
    if (!ses) return;
    try {
      ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
        callback({ cancel: false });
      });
    } catch {}
  }

  startIntercepting() {
    for (const part of this.sessionPartitions) {
      try {
        const ses = session.fromPartition(part);
        this.attachToSession(ses);
      } catch {}
    }
  }

  stopIntercepting() {
    for (const part of this.sessionPartitions) {
      try {
        const ses = session.fromPartition(part);
        this.detachFromSession(ses);
      } catch {}
    }
  }

  toggle(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.startIntercepting();
    } else {
      this.stopIntercepting();
    }
    try {
      const win = this.mainWindowGetter ? this.mainWindowGetter() : null;
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('adblocker-toggle', { enabled });
      }
    } catch {}
  }

  getStats() {
    return {
      enabled: this.enabled,
      blockCount: this.blockCount,
      filterCount: AD_DOMAINS.length + AD_URL_PATTERNS.length + TRACKER_DOMAINS.length,
    };
  }

  resetCount() {
    this.blockCount = 0;
    this.perSiteMap.clear();
    this.recentGlobal = [];
    try {
      const win = this.mainWindowGetter ? this.mainWindowGetter() : null;
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('adblocker-update', { clearedAll: true, globalCount: 0 });
      }
    } catch {}
  }
}

module.exports = { AdBlocker };
