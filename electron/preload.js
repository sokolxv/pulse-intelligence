const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Window controls ─────────────────────────────────────
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // ── External links ─────────────────────────────────────
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // ── Ad blocker ─────────────────────────────────────────
  getAdBlockerStats: () => ipcRenderer.invoke('adblocker-get-stats'),
  getPerSiteStats: () => ipcRenderer.invoke('adblocker-get-per-site-stats'),
  getSiteStats: (host) => ipcRenderer.invoke('adblocker-get-site-stats', host),
  getAllAdBlockerStats: () => ipcRenderer.invoke('adblocker-get-all-stats'),
  toggleAdBlocker: (enabled) => ipcRenderer.send('adblocker-toggle', enabled),
  toggleSiteBlocking: (host, enabled) => ipcRenderer.invoke('adblocker-toggle-site', host, enabled),
  clearSiteStats: (host) => ipcRenderer.invoke('adblocker-clear-site', host),
  clearAllStats: () => ipcRenderer.invoke('adblocker-clear-all'),
  resetAdBlockerCount: () => ipcRenderer.send('adblocker-reset-count'),
  onAdBlockerUpdate: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('adblocker-update', h);
    return () => ipcRenderer.removeListener('adblocker-update', h);
  },
  onAdBlockerToggle: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('adblocker-toggle', h);
    return () => ipcRenderer.removeListener('adblocker-toggle', h);
  },
  onAdBlockerSiteToggle: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('adblocker-site-toggle', h);
    return () => ipcRenderer.removeListener('adblocker-site-toggle', h);
  },

  // ── User Agent ─────────────────────────────────────────
  getUserAgent: () => ipcRenderer.invoke('get-user-agent'),
  regenerateUserAgent: () => ipcRenderer.invoke('get-random-ua'),

  // ── Shortcuts from webview ─────────────────────────────
  onShortcut: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on('shortcut', handler);
    return () => ipcRenderer.removeListener('shortcut', handler);
  },

  // ── Webview ────────────────────────────────────────────
  openWebviewDevtools: (id) => ipcRenderer.send('webview-devtools', id),

  // ── Platform info ──────────────────────────────────────
  platform: process.platform,

  // ══════════════════════════════════════════════════════════
  // REAL TOOL IPC BRIDGES
  // ══════════════════════════════════════════════════════════

  // ── Execute shell command (Terminal) ────────────────────
  execCommand: (command, timeoutMs) =>
    ipcRenderer.invoke('exec-command', command, timeoutMs),
  httpRequest: (request) => ipcRenderer.invoke('http-request', request),

  // ── System info ────────────────────────────────────────
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),

  // ── ARP table ──────────────────────────────────────────
  getArpTable: () => ipcRenderer.invoke('get-arp-table'),

  // ── DNS ────────────────────────────────────────────────
  dnsResolve: (hostname, type) => ipcRenderer.invoke('dns-resolve', hostname, type),
  dnsReverse: (ip) => ipcRenderer.invoke('dns-reverse', ip),

  // ── Port scanning ──────────────────────────────────────
  scanPort: (host, port, timeoutMs) => ipcRenderer.invoke('scan-port', host, port, timeoutMs),
  scanPorts: (host, ports, concurrency, timeoutMs) =>
    ipcRenderer.invoke('scan-ports', host, ports, concurrency, timeoutMs),

  // ── Ping ───────────────────────────────────────────────
  pingHost: (host, count) => ipcRenderer.invoke('ping-host', host, count),

  // ── Whois ──────────────────────────────────────────────
  whoisLookup: (domain) => ipcRenderer.invoke('whois-lookup', domain),

  // ── Traceroute ─────────────────────────────────────────
  traceroute: (host) => ipcRenderer.invoke('traceroute', host),

  // ── Privacy: proxy checks ─────────────────────────
  checkTorProxy: (proxyUrl) => ipcRenderer.invoke('check-privacy-proxy', proxyUrl),
  checkPrivacyProxy: (proxyUrl) => ipcRenderer.invoke('check-privacy-proxy', proxyUrl),
  getPrivacyStatus: (opts) => ipcRenderer.invoke('get-privacy-status', opts),
  setTorProxy: (enabled, proxyUrl) => ipcRenderer.invoke('set-privacy-proxy', enabled, proxyUrl),
  setPrivacyProxy: (enabled, proxyUrl) => ipcRenderer.invoke('set-privacy-proxy', enabled, proxyUrl),

  // ── Privacy: hidden routing & New Identity ───────────────
  privacyNewIdentity: () => ipcRenderer.invoke('privacy-new-identity'),
  privacyStatus: () => ipcRenderer.invoke('privacy-status'),
  privacyEnableRouting: () => ipcRenderer.invoke('privacy-enable-routing'),
  privacyClearRouting: () => ipcRenderer.invoke('privacy-clear-routing'),
  clearPrivateSession: () => ipcRenderer.invoke('clear-private-session'),
  clearPrivateData: () => ipcRenderer.invoke('clear-private-data'),
  onPrivacyIdentityChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on('privacy-identity-changed', h);
    return () => ipcRenderer.removeListener('privacy-identity-changed', h);
  },
  onPrivacyRoutingEnabled: (cb) => {
    const h = () => cb();
    ipcRenderer.on('privacy-routing-enabled', h);
    return () => ipcRenderer.removeListener('privacy-routing-enabled', h);
  },
  onPrivacyRoutingFailed: (cb) => {
    const h = (_e, info) => cb(info);
    ipcRenderer.on('privacy-routing-failed', h);
    return () => ipcRenderer.removeListener('privacy-routing-failed', h);
  },

  // ── Webview preload (autofill) ─────────────────────────
  webviewPreloadPath: (() => {
    try {
      // eslint-disable-next-line
      const pa = require('path');
      // eslint-disable-next-line
      const { pathToFileURL } = require('url');
      const p = pa.join(__dirname, 'webview-preload.js');
      return pathToFileURL(p).href;
    } catch {
      try {
        // eslint-disable-next-line
        const pa = require('path');
        const p = pa.join(__dirname, 'webview-preload.js');
        return `file://${p.replace(/\\/g, '/')}`;
      } catch { return ''; }
    }
  })(),

  // ── Encrypted password manager storage ───────────────────
  credentialsRead: () => ipcRenderer.invoke('credentials:read'),
  credentialsSave: (credentials) => ipcRenderer.invoke('credentials:save', credentials),

  // ── Bookmarks ────────────────────────────────────────────
  bookmarksRead: (p) => ipcRenderer.invoke('bookmarks:read', p),
  bookmarksImportDialog: () => ipcRenderer.invoke('bookmarks:import-dialog'),
  bookmarksExport: (data, name) => ipcRenderer.invoke('bookmarks:export', data, name),

  // ── Network Graph (CDP collector bridge) ─────────────────
  netgraph: {
    bind: (tabId, wcId) => ipcRenderer.invoke('netgraph:bind', tabId, wcId),
    unbind: (tabId, wcId) => ipcRenderer.send('netgraph:unbind', tabId, wcId),
    setStreaming: (on) => ipcRenderer.send('netgraph:streaming', Boolean(on)),
    clear: (tabId) => ipcRenderer.send('netgraph:clear', tabId),
    status: () => ipcRenderer.invoke('netgraph:status'),
    getBody: (wcId, cdpRequestId, kind) => ipcRenderer.invoke('netgraph:body', wcId, cdpRequestId, kind),
    onBatch: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('netgraph:batch', h);
      return () => ipcRenderer.removeListener('netgraph:batch', h);
    },
    onPage: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('netgraph:page', h);
      return () => ipcRenderer.removeListener('netgraph:page', h);
    },
    onStatus: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('netgraph:status-event', h);
      return () => ipcRenderer.removeListener('netgraph:status-event', h);
    },
  },
});
console.log('[preload] loaded OK');
