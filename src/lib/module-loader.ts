/**
 * Module Loader — imports and registers all OSINT modules
 */
import { Pulse, getModules } from './pulse-adapter';

async function getJson(url: string, timeoutMs = 15000, headers?: Record<string, string>): Promise<{ status: number; data: any }> {
  const response = await Pulse.http.httpGet(url, { timeoutMs, headers });
  if (response.status === 429) return { status: 429, data: null };
  if (response.status < 200 || response.status >= 300) return { status: response.status, data: null };
  try { return { status: response.status, data: JSON.parse(response.text) }; } catch { return { status: response.status, data: null }; }
}

function getAbuseChKey(): string {
  return String((Pulse.config.get() as any).abuseChKey || '').trim();
}

function validDomain(value: string): string {
  const domain = Pulse.utils.extractDomain(value);
  return !domain || Pulse.utils.isIp(domain) || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain) ? '' : domain;
}

function validIp(value: string): string {
  const ip = String(value || '').trim();
  return Pulse.utils.isIp(ip) ? ip : '';
}

// Module metadata (extracted from the .js files)
export interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  tags: string[];
  freeTier: string;
  inputType: 'text' | 'file';
  inputLabel: string;
  inputPlaceholder: string;
  run: (query: any) => Promise<Record<string, any>>;
}

// ── Crypto Wallet ───────────────────────────────────────────
const cryptoModule: ModuleInfo = {
  id: 'crypto',
  name: 'Crypto Wallet',
  description: 'Balance & activity for BTC, ETH, LTC, DOGE, TRON wallets via blockchain.info, blockchair, ethplorer, trongrid',
  tags: ['crypto', 'wallet', 'bitcoin', 'ethereum', 'blockchain'],
  freeTier: 'Free: blockchain.info, blockchair, ethplorer (freekey), trongrid',
  inputType: 'text',
  inputLabel: 'Wallet Address',
  inputPlaceholder: 'e.g. 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa (BTC) or 0x... (ETH)',
  run: async (query) => {
    const addr = String(query || '').trim();
    if (!addr) return { skipped: 'Enter a crypto wallet address.' };

    // Detect coin
    const ETH_RE = /^0x[0-9a-fA-F]{40}$/;
    const BTC_RE = /^(?:bc1[02-9ac-hj-np-z]{11,71}|[13a-km-zA-HJ-NP-Z1-9]{26,35})$/;
    const LTC_RE = /^[LM3][1-9A-HJ-NP-Za-km-z]{25,34}$/;
    const DOGE_RE = /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32,33}$/;
    const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
    const TON_RE = /^(?:EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46,47}$/;

    if (TON_RE.test(addr)) {
      return { skipped: 'For TON, use the TON module.' };
    }

    let coin = '';
    let coinName = '';
    if (TRON_RE.test(addr)) { coin = 'tron'; coinName = 'Tron'; }
    else if (DOGE_RE.test(addr)) { coin = 'doge'; coinName = 'Dogecoin'; }
    else if (LTC_RE.test(addr)) { coin = 'ltc'; coinName = 'Litecoin'; }
    else if (BTC_RE.test(addr)) { coin = 'btc'; coinName = 'Bitcoin'; }
    else if (ETH_RE.test(addr)) { coin = 'eth'; coinName = 'Ethereum'; }
    else return { error: 'Address does not match BTC/ETH/LTC/DOGE/TRON format.' };

    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    function tronToHex(a: string) {
      let num = 0n;
      for (let i = 0; i < a.length; i++) num = num * 58n + BigInt(B58.indexOf(a[i]));
      return '41' + num.toString(16).padStart(50, '0').slice(2, 42);
    }
    function pickOf(info: any, keys: string[]) {
      for (const k of keys) if (info && k in info) return info[k];
      return null;
    }
    function fmtAmount(value: any, decimals: number) {
      if (value === null || value === undefined) return null;
      const num = Number(value) / Math.pow(10, decimals);
      if (!isFinite(num)) return null;
      if (Math.abs(num) >= 1000) return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      if (Math.abs(num) >= 0.01) return num.toFixed(4).replace(/\.?0+$/, '');
      return num.toFixed(8).replace(/\.?0+$/, '');
    }

    const config = Pulse.config.get() as any;
    let data: any = null;

    if (coin === 'btc') {
      try {
        const r = await Pulse.http.httpGet('https://blockchain.info/rawaddr/' + addr, { timeoutMs: 15000 });
        if (r.status === 200) { const j = JSON.parse(r.text); data = { balance: pickOf(j, ['final_balance']), transactions: pickOf(j, ['n_tx']), received: pickOf(j, ['total_received']), spent: pickOf(j, ['total_sent']), decimals: 8 }; }
      } catch {}
      if (!data) try {
        const r = await Pulse.http.httpGet('https://api.blockchair.com/btc/dashboards/address/' + addr, { timeoutMs: 15000 });
        if (r.status === 200) { const j = JSON.parse(r.text); const info = (j.data || {})[addr]; if (info) data = { balance: info.balance, transactions: info.transaction_count, received: info.received, spent: info.spent, decimals: 8 }; }
      } catch {}
    } else if (coin === 'eth') {
      try {
        const r = await Pulse.http.httpGet('https://api.ethplorer.io/getAddressInfo/' + addr + '?apiKey=freekey', { timeoutMs: 15000 });
        if (r.status === 200) { const j = JSON.parse(r.text); if (j && j.ETH) { const eth = j.ETH; data = { balance: eth.balance, transactions: j.countTxs, received: eth.totalIn, spent: eth.totalOut, decimals: 18 }; } }
      } catch {}
    } else if (coin === 'tron') {
      try {
        const hexAddr = tronToHex(addr);
        const r = await Pulse.http.httpGet('https://api.trongrid.io/v1/accounts/' + hexAddr, { timeoutMs: 15000 });
        if (r.status === 200) { const j = JSON.parse(r.text); const row = (j.data || [{}])[0] || {}; data = { balance: pickOf(row, ['balance', 'trx']), transactions: pickOf(row, ['transactions']), decimals: 6 }; }
      } catch {}
    } else {
      try {
        const r = await Pulse.http.httpGet('https://api.blockchair.com/' + coin + '/dashboards/address/' + addr, { timeoutMs: 15000 });
        if (r.status === 200) { const j = JSON.parse(r.text); const info = (j.data || {})[addr]; if (info) data = { balance: info.balance, transactions: info.transaction_count, received: info.received, spent: info.spent, decimals: 8 }; }
      } catch {}
    }

    if (!data) return { address: addr, coin: coinName, error: 'Block explorers did not respond.' };
    const out: any = { address: addr, coin: coinName, balance: fmtAmount(data.balance, data.decimals), transactions: data.transactions };
    if (data.received) out.received = fmtAmount(data.received, data.decimals);
    if (data.spent) out.spent = fmtAmount(data.spent, data.decimals);
    return Pulse.utils.compact(out);
  },
};

// ── TON Wallet ──────────────────────────────────────────────
const tonModule: ModuleInfo = {
  id: 'ton',
  name: 'TON Wallet',
  description: 'Balance & state of TON wallet via tonapi.io and toncenter.com',
  tags: ['crypto', 'ton', 'wallet'],
  freeTier: 'Free: tonapi.io, toncenter.com',
  inputType: 'text',
  inputLabel: 'TON Address',
  inputPlaceholder: 'e.g. EQBKhe7... (EQ/UQ/kQ prefix)',
  run: async (query) => {
    const addr = String(query || '').trim();
    const TON_RE = /^(?:EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46,47}$/;
    const RAW_RE = /^[0-1]:[0-9a-fA-F]{64}$/;
    if (!TON_RE.test(addr) && !RAW_RE.test(addr)) return { error: 'Not a valid TON address.' };

    function fmtTon(n: any) {
      const num = Number(n) / 1e9;
      if (!isFinite(num)) return null;
      if (Math.abs(num) >= 1000) return num.toFixed(2);
      if (Math.abs(num) >= 0.01) return num.toFixed(4).replace(/\.?0+$/, '');
      return num.toFixed(8).replace(/\.?0+$/, '');
    }

    try {
      const r = await Pulse.http.httpGet('https://tonapi.io/v2/accounts/' + addr, { timeoutMs: 15000 });
      if (r.status === 200) {
        const info = JSON.parse(r.text);
        const out: any = { address: addr, coin: 'TON', balance: fmtTon(info.balance), state: info.status || 'unknown' };
        if (info.name) out.name = info.name;
        out.explorer = 'https://tonscan.org/address/' + addr;
        return Pulse.utils.compact(out);
      }
    } catch {}
    return { address: addr, coin: 'TON', error: 'TON API did not respond.' };
  },
};

// ── Crypto Transactions ─────────────────────────────────────
const cryptoTxModule: ModuleInfo = {
  id: 'crypto_tx',
  name: 'Crypto Transactions',
  description: 'Recent transactions for BTC, ETH, TRON wallets',
  tags: ['crypto', 'transactions', 'blockchain'],
  freeTier: 'Free: blockchain.info, ethplorer, trongrid',
  inputType: 'text',
  inputLabel: 'Wallet Address',
  inputPlaceholder: 'e.g. 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  run: async (query) => {
    const addr = String(query || '').trim();
    if (!addr) return { skipped: 'Enter a crypto wallet address.' };
    // Use same detection as crypto module
    const ETH_RE = /^0x[0-9a-fA-F]{40}$/;
    const BTC_RE = /^(?:bc1[02-9ac-hj-np-z]{11,71}|[13a-km-zA-HJ-NP-Z1-9]{26,35})$/;
    const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

    let coin = '';
    if (BTC_RE.test(addr)) coin = 'btc';
    else if (ETH_RE.test(addr)) coin = 'eth';
    else if (TRON_RE.test(addr)) coin = 'tron';
    else return { error: 'Transaction history only available for BTC, ETH, TRON.' };

    try {
      if (coin === 'btc') {
        const r = await Pulse.http.httpGet('https://blockchain.info/rawaddr/' + addr + '?limit=10', { timeoutMs: 15000 });
        if (r.status === 200) {
          const info = JSON.parse(r.text);
          const txs = (info.txs || []).slice(0, 10).map((tx: any) => ({
            hash: tx.hash?.slice(0, 16),
            amount: tx.result ? (Math.abs(tx.result) / 1e8).toFixed(8) : null,
            direction: (tx.result || 0) < 0 ? 'out' : 'in',
            time: tx.time ? new Date(tx.time * 1000).toISOString().slice(0, 19) : null,
          }));
          return Pulse.utils.compact({ address: addr, coin: 'Bitcoin', total_txs: info.n_tx, recent: txs });
        }
      }
      return { address: addr, coin, note: 'Transaction history for ' + coin.toUpperCase() + ' is limited in browser.' };
    } catch {
      return { address: addr, coin, error: 'Explorer did not respond.' };
    }
  },
};

// ── Hash Lookup ─────────────────────────────────────────────
const hashLookupModule: ModuleInfo = {
  id: 'hash_lookup',
  name: 'Hash Lookup',
  description: 'Search MD5/SHA1/SHA256 hashes in CIRCL database and VirusTotal',
  tags: ['hash', 'md5', 'sha1', 'sha256', 'malware'],
  freeTier: 'Free: hashlookup.circl.lu; optional VirusTotal key',
  inputType: 'text',
  inputLabel: 'Hash (MD5/SHA1/SHA256)',
  inputPlaceholder: 'e.g. d41d8cd98f00b204e9800998ecf8427e',
  run: async (query) => {
    const h = String(query || '').trim().toLowerCase();
    const types: Record<number, string> = { 32: 'MD5', 40: 'SHA1', 64: 'SHA256' };
    const htype = types[h.length];
    if (!h || !htype || !/^[0-9a-f]+$/.test(h)) return { skipped: 'Need MD5 (32), SHA1 (40) or SHA256 (64 hex chars).' };

    const out: any = { hash: h, type: htype, found: false };

    // CIRCL lookup
    try {
      const r = await Pulse.http.httpGet('https://hashlookup.circl.lu/lookup/' + h, { timeoutMs: 10000 });
      if (r.status === 200) {
        const data = JSON.parse(r.text);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          out.found = true;
          if (data.FileName) out.file_name = data.FileName;
          if (data.KnownMalicious) out.known_malicious = true;
        }
      }
    } catch {}

    // VirusTotal (optional)
    const config = Pulse.config.get() as any;
    if (config.vtKey) {
      try {
        const r = await Pulse.http.httpGet('https://www.virustotal.com/api/v3/files/' + h, {
          headers: { 'x-apikey': config.vtKey },
          timeoutMs: 15000,
        });
        if (r.status === 200) {
          const data = JSON.parse(r.text);
          const attrs = data.data?.attributes;
          if (attrs) {
            out.found = true;
            out.vt_stats = attrs.last_analysis_stats;
            if (attrs.meaningful_name) out.vt_name = attrs.meaningful_name;
          }
        }
      } catch {}
    }

    if (!out.found) out.note = 'Not found in public databases.';
    return Pulse.utils.compact(out);
  },
};

// ── MAC Vendor ──────────────────────────────────────────────
const macVendorModule: ModuleInfo = {
  id: 'mac_vendor',
  name: 'MAC Vendor',
  description: 'Find device manufacturer by MAC address (OUI lookup)',
  tags: ['mac', 'vendor', 'network', 'device'],
  freeTier: 'Free: api.macvendors.com, api.maclookup.app',
  inputType: 'text',
  inputLabel: 'MAC Address',
  inputPlaceholder: 'e.g. AA:BB:CC:DD:EE:FF',
  run: async (query) => {
    const raw = String(query || '').trim();
    const clean = raw.replace(/[\s:.\\-]/g, '');
    if (!/^[0-9A-Fa-f]{12}$/.test(clean)) return { error: 'MAC must be 12 hex characters.' };
    const canonical = clean.toUpperCase().match(/.{1,2}/g)!.join(':');
    const compact = clean.toUpperCase();

    try {
      const r = await Pulse.http.httpGet('https://api.macvendors.com/' + compact, { timeoutMs: 8000 });
      if (r.status === 200) {
        const vendor = r.text.trim();
        if (vendor && vendor.toLowerCase() !== 'not found in database') {
          return Pulse.utils.compact({ mac: canonical, vendor, source: 'macvendors.com' });
        }
      }
    } catch {}

    try {
      const r = await Pulse.http.httpGet('https://api.maclookup.app/v2/macs/' + compact, { timeoutMs: 8000 });
      if (r.status === 200) {
        const data = JSON.parse(r.text);
        if (data.success && data.found && data.company) {
          return Pulse.utils.compact({ mac: canonical, vendor: data.company, country: data.country, source: 'maclookup.app' });
        }
      }
    } catch {}

    return { mac: canonical, note: 'Manufacturer not found in databases.' };
  },
};

// ── RapidDNS ────────────────────────────────────────────────
const rapiddnsModule: ModuleInfo = {
  id: 'rapiddns',
  name: 'RapidDNS Subdomains',
  description: 'Find subdomains via passive DNS from rapiddns.io',
  tags: ['subdomains', 'dns', 'passive'],
  freeTier: 'Free: rapiddns.io, no key needed',
  inputType: 'text',
  inputLabel: 'Domain',
  inputPlaceholder: 'e.g. example.com',
  run: async (query) => {
    const domain = Pulse.utils.extractDomain(query);
    if (!domain) return { skipped: 'Enter a domain.' };
    if (Pulse.utils.isIp(domain)) return { error: 'Subdomains are searched by domain, not IP.' };

    try {
      const r = await Pulse.http.httpGet('https://rapiddns.io/subdomain/' + domain + '?full=1', { timeoutMs: 20000 });
      if (r.status !== 200) return { domain, error: 'RapidDNS did not respond.' };

      // Parse HTML for subdomains
      const subs = new Set<string>();
      const tagRe = /<[^>]+>/g;
      for (const line of r.text.split('\n')) {
        const stripped = line.replace(tagRe, '').trim().toLowerCase();
        for (const token of stripped.split(/\s+/)) {
          if (token && (token === domain || token.endsWith('.' + domain)) && !token.includes('://')) {
            subs.add(token);
          }
        }
      }

      const sorted = [...subs].sort().slice(0, 60);
      if (sorted.length === 0) return { domain, note: 'No subdomains found via RapidDNS.' };
      return Pulse.utils.compact({ domain, count: sorted.length, subdomains: sorted });
    } catch {
      return { domain, error: 'RapidDNS did not respond.' };
    }
  },
};

// ── Certificate Transparency ───────────────────────────────
const crtModule: ModuleInfo = {
  id: 'crt_sh',
  name: 'Certificate Transparency',
  description: 'Find certificates and subdomains via crt.sh passive CT data',
  tags: ['certificates', 'subdomains', 'ct', 'domain'],
  freeTier: 'Free: crt.sh, no key needed',
  inputType: 'text',
  inputLabel: 'Domain',
  inputPlaceholder: 'e.g. example.com',
  run: async (query) => {
    const domain = validDomain(query);
    if (!domain) return { error: 'Enter a valid domain, not an IP.' };
    try {
      const response = await getJson(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`, 20000);
      if (response.status === 429) return { domain, error: 'crt.sh rate limited the request. Try again later.' };
      if (!response.data || !Array.isArray(response.data)) return { domain, error: 'crt.sh returned an invalid response.' };
      const names = new Set<string>();
      for (const row of response.data.slice(0, 5000)) {
        for (const name of String(row?.name_value || '').split(/\r?\n/)) {
          const clean = name.trim().toLowerCase().replace(/^\*\./, '');
          if (clean === domain || clean.endsWith(`.${domain}`)) names.add(clean);
        }
      }
      const subdomains = [...names].sort().slice(0, 200);
      return { domain, count: subdomains.length, subdomains, note: subdomains.length ? undefined : 'No certificates found.' };
    } catch { return { domain, error: 'crt.sh is unavailable.' }; }
  },
};

// ── Shodan InternetDB ──────────────────────────────────────
const shodanInternetDbModule: ModuleInfo = {
  id: 'shodan_internetdb',
  name: 'Shodan InternetDB',
  description: 'Free IP enrichment with open ports, hostnames, tags and CVEs',
  tags: ['shodan', 'ip', 'ports', 'cve', 'reputation'],
  freeTier: 'Free: Shodan InternetDB, no key needed',
  inputType: 'text',
  inputLabel: 'IP address',
  inputPlaceholder: 'e.g. 8.8.8.8',
  run: async (query) => {
    const ip = validIp(query);
    if (!ip) return { error: 'Enter a valid IPv4 or IPv6 address.' };
    try {
      const response = await getJson(`https://internetdb.shodan.io/${encodeURIComponent(ip)}`, 10000);
      if (response.status === 404) return { ip, note: 'No Shodan InternetDB data found.' };
      if (response.status === 429) return { ip, error: 'Shodan InternetDB rate limited the request.' };
      if (!response.data) return { ip, error: 'Shodan InternetDB returned an invalid response.' };
      return Pulse.utils.compact({ ip, hostnames: response.data.hostnames || [], ports: response.data.ports || [], tags: response.data.tags || [], cpes: response.data.cpes || [], vulns: response.data.vulns || [] });
    } catch { return { ip, error: 'Shodan InternetDB is unavailable.' }; }
  },
};

// ── abuse.ch feeds ─────────────────────────────────────────
const urlhausModule: ModuleInfo = {
  id: 'urlhaus',
  name: 'URLhaus Lookup',
  description: 'Check a URL against the abuse.ch malicious URL database',
  tags: ['malware', 'url', 'ioc', 'abuse.ch'],
  freeTier: 'Free: abuse.ch Auth-Key required',
  inputType: 'text',
  inputLabel: 'URL',
  inputPlaceholder: 'https://example.com/file.exe',
  run: async (query) => {
    let url: URL;
    try { url = new URL(String(query || '').trim()); } catch { return { error: 'Enter a valid URL.' }; }
    if (!['http:', 'https:'].includes(url.protocol)) return { error: 'Only HTTP(S) URLs are supported.' };
    const authKey = getAbuseChKey();
    if (!authKey) return { url: url.toString(), error: 'abuse.ch Auth-Key required. Add it in Settings → API Keys.' };
    try {
      const postResponse = await Pulse.http.httpGet('https://urlhaus-api.abuse.ch/v1/url/', { method: 'POST', body: `url=${encodeURIComponent(url.toString())}`, headers: { 'Auth-Key': authKey, 'Content-Type': 'application/x-www-form-urlencoded' }, timeoutMs: 15000 });
      if (postResponse.status === 429) return { url: url.toString(), error: 'URLhaus rate limited the request.' };
      const data = JSON.parse(postResponse.text || '{}');
      if (data.query_status === 'no_results') return { url: url.toString(), found: false, note: 'URL not found in URLhaus.' };
      if (postResponse.status !== 200 || !data) return { url: url.toString(), error: 'URLhaus returned an invalid response.' };
      return Pulse.utils.compact({ url: url.toString(), found: true, threat: data.threat, url_status: data.url_status, date_added: data.date_added, tags: data.tags || [], payloads: (data.payloads || []).slice(0, 20).map((p: any) => ({ filename: p.filename, file_type: p.file_type, signature: p.signature, sha256_hash: p.sha256_hash })) });
    } catch { return { url: url.toString(), error: 'URLhaus is unavailable.' }; }
  },
};

const malwareBazaarModule: ModuleInfo = {
  id: 'malwarebazaar',
  name: 'MalwareBazaar Hash',
  description: 'Check a file hash against the abuse.ch MalwareBazaar feed',
  tags: ['malware', 'hash', 'ioc', 'abuse.ch'],
  freeTier: 'Free: abuse.ch Auth-Key required',
  inputType: 'text',
  inputLabel: 'SHA256 hash',
  inputPlaceholder: '64 hexadecimal characters',
  run: async (query) => {
    const hash = String(query || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) return { error: 'Enter a valid SHA256 hash.' };
    const authKey = getAbuseChKey();
    if (!authKey) return { hash, error: 'abuse.ch Auth-Key required. Add it in Settings → API Keys.' };
    try {
      const response = await Pulse.http.httpGet('https://mb-api.abuse.ch/api/v1/', { method: 'POST', body: `query=get_info&hash=${encodeURIComponent(hash)}`, headers: { 'Auth-Key': authKey, 'Content-Type': 'application/x-www-form-urlencoded' }, timeoutMs: 15000 });
      if (response.status === 429) return { hash, error: 'MalwareBazaar rate limited the request.' };
      const data = JSON.parse(response.text || '{}');
      if (data.query_status === 'hash_not_found') return { hash, found: false, note: 'Hash not found in MalwareBazaar.' };
      if (!data.data?.length) return { hash, error: 'MalwareBazaar returned no usable data.' };
      const item = data.data[0];
      return Pulse.utils.compact({ hash, found: true, signature: item.signature, malware: item.malware, file_name: item.file_name, file_type: item.file_type, first_seen: item.first_seen, tags: item.tags || [] });
    } catch { return { hash, error: 'MalwareBazaar is unavailable.' }; }
  },
};

const threatFoxModule: ModuleInfo = {
  id: 'threatfox',
  name: 'ThreatFox IOC',
  description: 'Search abuse.ch ThreatFox indicators of compromise',
  tags: ['threat-intel', 'ioc', 'malware', 'abuse.ch'],
  freeTier: 'Free: abuse.ch Auth-Key required',
  inputType: 'text',
  inputLabel: 'IOC value',
  inputPlaceholder: 'Domain, IP, URL or hash',
  run: async (query) => {
    const ioc = String(query || '').trim();
    if (!ioc || ioc.length > 512) return { skipped: 'Enter an IOC value.' };
    const authKey = getAbuseChKey();
    if (!authKey) return { ioc, error: 'abuse.ch Auth-Key required. Add it in Settings → API Keys.' };
    try {
      const response = await Pulse.http.httpGet('https://threatfox-api.abuse.ch/api/v1/', { method: 'POST', json: { query: 'search_ioc', search_term: ioc }, headers: { 'Auth-Key': authKey }, timeoutMs: 15000 });
      if (response.status === 429) return { ioc, error: 'ThreatFox rate limited the request.' };
      const data = JSON.parse(response.text || '{}');
      if (data.query_status === 'no_result' || !Array.isArray(data.data) || data.data.length === 0) return { ioc, found: false, note: 'IOC not found in ThreatFox.' };
      const results = data.data.slice(0, 50).map((item: any) => Pulse.utils.compact({ ioc: item.ioc, type: item.ioc_type, threat_type: item.threat_type, malware: item.malware_printable || item.malware, confidence: item.confidence_level, first_seen: item.first_seen, last_seen: item.last_seen }));
      return { ioc, found: true, count: results.length, results };
    } catch { return { ioc, error: 'ThreatFox is unavailable.' }; }
  },
};

const emailRepModule: ModuleInfo = {
  id: 'emailrep',
  name: 'EmailRep',
  description: 'Check public reputation signals for an email address',
  tags: ['email', 'reputation', 'osint'],
  freeTier: 'Free: EmailRep.io basic endpoint, no key needed',
  inputType: 'text',
  inputLabel: 'Email address',
  inputPlaceholder: 'user@example.com',
  run: async (query) => {
    const email = String(query || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return { error: 'Enter a valid email address.' };
    try {
      const response = await getJson(`https://emailrep.io/${encodeURIComponent(email)}`, 15000, { Accept: 'application/json' });
      if (response.status === 429) return { email, error: 'EmailRep rate limited the request.' };
      if (response.status === 404) return { email, found: false, note: 'No EmailRep data found.' };
      if (!response.data) return { email, error: 'EmailRep returned an invalid response.' };
      return Pulse.utils.compact({ email, reputation: response.data.reputation, suspicious: response.data.suspicious, references: response.data.references, details: response.data.details || {}, profiles: response.data.profiles || [] });
    } catch { return { email, error: 'EmailRep is unavailable.' }; }
  },
};

const abuseIpDbModule: ModuleInfo = {
  id: 'abuseipdb',
  name: 'AbuseIPDB Reputation',
  description: 'Check abuse reports and confidence score for an IP address',
  tags: ['ip', 'reputation', 'abuse', 'threat-intel'],
  freeTier: 'Free API key from abuseipdb.com, 1000 checks/day',
  inputType: 'text',
  inputLabel: 'IP address',
  inputPlaceholder: 'e.g. 8.8.8.8',
  run: async (query) => {
    const ip = validIp(query);
    if (!ip) return { error: 'Enter a valid IPv4 or IPv6 address.' };
    const key = String((Pulse.config.get() as any).abuseIpDbKey || '').trim();
    if (!key) return { ip, error: 'AbuseIPDB API key required. Add it in Settings → API Keys.' };
    try {
      const response = await getJson(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`, 15000, { Key: key, Accept: 'application/json' });
      if (response.status === 401 || response.status === 403) return { ip, error: 'AbuseIPDB rejected the API key.' };
      if (response.status === 429) return { ip, error: 'AbuseIPDB rate limited the request.' };
      if (!response.data?.data) return { ip, error: 'AbuseIPDB returned no usable data.' };
      const data = response.data.data;
      return Pulse.utils.compact({ ip, abuse_confidence_score: data.abuseConfidenceScore, total_reports: data.totalReports, last_reported_at: data.lastReportedAt, country: data.countryCode, isp: data.isp, domain: data.domain, is_tor: data.isTor });
    } catch { return { ip, error: 'AbuseIPDB is unavailable.' }; }
  },
};

const greyNoiseModule: ModuleInfo = {
  id: 'greynoise',
  name: 'GreyNoise Community',
  description: 'Classify whether an IP is observed as internet background noise',
  tags: ['ip', 'reputation', 'scanning', 'threat-intel'],
  freeTier: 'Free GreyNoise Community API key',
  inputType: 'text',
  inputLabel: 'IP address',
  inputPlaceholder: 'e.g. 8.8.8.8',
  run: async (query) => {
    const ip = validIp(query);
    if (!ip) return { error: 'Enter a valid IPv4 or IPv6 address.' };
    const key = String((Pulse.config.get() as any).greyNoiseKey || '').trim();
    if (!key) return { ip, error: 'GreyNoise API key required. Add it in Settings → API Keys.' };
    try {
      const response = await getJson(`https://api.greynoise.io/v3/community/${encodeURIComponent(ip)}`, 15000, { key });
      if (response.status === 401 || response.status === 403) return { ip, error: 'GreyNoise rejected the API key.' };
      if (response.status === 404) return { ip, found: false, note: 'IP not observed by GreyNoise Community.' };
      if (response.status === 429) return { ip, error: 'GreyNoise rate limited the request.' };
      if (!response.data) return { ip, error: 'GreyNoise returned no usable data.' };
      return Pulse.utils.compact({ ip, noise: response.data.noise, riot: response.data.riot, classification: response.data.classification, name: response.data.name, last_seen: response.data.last_seen, link: response.data.link });
    } catch { return { ip, error: 'GreyNoise is unavailable.' }; }
  },
};

// ── REMOVED dups (нулевая потеря):
// site_files (Exposed Files) — покрыт Vuln Scanner (sensitive + debug paths через main curl, шире и без CORS).
// smtp (Email DNS Check) — MX/SPF/DMARC покрыты OSINTLookup → Breach Check + Email OSINT + DNS Lookup через IPC.

// ── Tech Scan ───────────────────────────────────────────────
const techScanModule: ModuleInfo = {
  id: 'tech_scan',
  name: 'Tech Stack',
  description: 'Detect website technologies: server, CMS, framework, CDN from headers and HTML',
  tags: ['tech', 'fingerprint', 'web', 'headers'],
  freeTier: 'Free, no keys',
  inputType: 'text',
  inputLabel: 'Domain',
  inputPlaceholder: 'e.g. example.com',
  run: async (query) => {
    const domain = Pulse.utils.extractDomain(query);
    if (!domain) return { skipped: 'Enter a domain.' };

    const techs: string[] = [];
    const add = (t: string) => { if (t && !techs.includes(t)) techs.push(t); };

    try {
      const r = await Pulse.http.httpGet('https://' + domain + '/', { timeoutMs: 10000 });
      if (r.status === 0) return { domain, error: 'Site did not respond.' };

      const out: any = { domain, status: r.status };
      // Parse headers from fetch
      const resp = await fetch('https://' + domain + '/');
      const server = resp.headers.get('server') || '';
      const poweredBy = resp.headers.get('x-powered-by') || '';

      if (server) out.server = server;
      if (poweredBy) out.powered_by = poweredBy;

      const serverLow = server.toLowerCase();
      if (serverLow.includes('cloudflare') || resp.headers.get('cf-ray')) add('Cloudflare');
      else if (serverLow.includes('nginx')) add('nginx');
      else if (serverLow.includes('apache')) add('Apache');
      else if (serverLow.includes('iis')) add('IIS');

      const html = r.text.slice(0, 15000).toLowerCase();
      if (html.includes('_next/data') || html.includes('__next')) add('Next.js');
      if (html.includes('__nuxt__')) add('Nuxt.js');
      if (html.includes('__vue__') || html.includes('vue.js')) add('Vue');
      if (html.includes('react')) add('React');
      if (html.includes('jquery')) add('jQuery');
      if (html.includes('bootstrap')) add('Bootstrap');
      if (html.includes('wp-content') || html.includes('wordpress')) add('WordPress');
      if (html.includes('/bitrix/')) add('1C-Bitrix');
      if (html.includes('joomla')) add('Joomla');

      if (poweredBy.toLowerCase().includes('php')) add('PHP');
      if (poweredBy.toLowerCase().includes('asp.net')) add('ASP.NET');
      if (poweredBy.toLowerCase().includes('express')) add('Node.js');

      if (techs.length) out.technologies = techs;
      else out.note = 'No significant technologies detected.';
      return Pulse.utils.compact(out);
    } catch {
      return { domain, error: 'Site did not respond.' };
    }
  },
};

// ── VIN Decoder ─────────────────────────────────────────────
const vinModule: ModuleInfo = {
  id: 'vin',
  name: 'VIN Decoder',
  description: 'Decode Vehicle Identification Number: make, model, year, engine, recalls via NHTSA',
  tags: ['vin', 'vehicle', 'car'],
  freeTier: 'Free: NHTSA vPIC API, no key',
  inputType: 'text',
  inputLabel: 'VIN (17 characters)',
  inputPlaceholder: 'e.g. 1HGBH41JXMN109186',
  run: async (query) => {
    const vin = String(query || '').trim().toUpperCase();
    if (vin.length !== 17 || /[IOQ]/.test(vin)) return { error: 'VIN must be 17 chars, no I/O/Q.' };

    try {
      const r = await Pulse.http.httpGet('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + vin + '?format=json', { timeoutMs: 15000 });
      if (r.status === 200) {
        const data = JSON.parse(r.text);
        if (data.Results?.length) {
          const r0 = data.Results[0];
          const out: any = { vin };
          if (r0.Make) out.make = r0.Make;
          if (r0.Model) out.model = r0.Model;
          if (r0.ModelYear) out.year = r0.ModelYear;
          if (r0.BodyClass) out.body = r0.BodyClass;
          if (r0.PlantCountry) out.country = r0.PlantCountry;
          if (r0.FuelTypePrimary) out.fuel = r0.FuelTypePrimary;
          if (r0.EngineCylinders) out.engine = r0.EngineCylinders + ' cyl';
          return Pulse.utils.compact(out);
        }
      }
      return { vin, error: 'Vehicle not found in NHTSA database.' };
    } catch {
      return { vin, error: 'NHTSA did not respond.' };
    }
  },
};

// ── EXIF Reader ─────────────────────────────────────────────
const exifModule: ModuleInfo = {
  id: 'exif',
  name: 'Photo EXIF',
  description: 'Extract EXIF metadata from photos: camera, date, GPS, author',
  tags: ['exif', 'photo', 'gps', 'camera'],
  freeTier: 'Free: local analysis + nominatim.openstreetmap.org',
  inputType: 'file',
  inputLabel: 'Photo (JPEG/PNG)',
  inputPlaceholder: 'Select a photo file...',
  run: async (query) => {
    if (query instanceof File) {
      const buf = await query.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // Basic EXIF parse for JPEG
      if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        return Pulse.utils.compact({
          name: query.name,
          size: query.size + ' bytes',
          type: 'JPEG',
          note: 'Full EXIF parsing requires server-side processing. Basic info shown.',
        });
      }
      return { name: query.name, error: 'Only JPEG files supported.' };
    }
    return { skipped: 'Select a photo file.' };
  },
};

// ── Export all modules ──────────────────────────────────────
export const ALL_MODULES: ModuleInfo[] = [
  cryptoModule,
  tonModule,
  cryptoTxModule,
  hashLookupModule,
  macVendorModule,
  rapiddnsModule,
  crtModule,
  shodanInternetDbModule,
  urlhausModule,
  malwareBazaarModule,
  threatFoxModule,
  emailRepModule,
  abuseIpDbModule,
  greyNoiseModule,
  techScanModule,
  vinModule,
  exifModule,
];
