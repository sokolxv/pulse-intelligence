import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe,
  Database,
  Mail,
  User,
  Link2,
  Search,
  Copy,
  Check,
  ExternalLink,
  Shield,
  Server,
  Lock as LockIcon,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
} from 'lucide-react';
import type { LookupResult } from '../types';

interface LookupTool {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  placeholder: string;
  color: string;
  gradient: string;
  execute: (query: string, signal?: AbortSignal) => Promise<LookupResult>;
}

// ── Encoding fix: replace garbled chars ───────────────────
function cleanText(text: string): string {
  return text
    .replace(/\?{3,}/g, '')           // sequences of ???
    .replace(/[^\x00-\x7F\u0400-\u04FF\u0500-\u052F\u1E00-\u1EFF\u2DE0-\u2DFF\uA640-\uA69F\u1100-\u11FF\uAC00-\uD7AF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, '') // keep cyrillic, latin extended, CJK
    .trim();
}

// ── IPC helpers ───────────────────────────────────────────
async function execCmd(command: string, timeoutMs = 10000): Promise<string> {
  if (!window.electronAPI?.execCommand) throw new Error('Electron IPC not available');
  try {
    const result = await window.electronAPI.execCommand(command, timeoutMs);
    const out = result.stdout || result.stderr || '';
    if (!out && result.exitCode !== 0) throw new Error(cleanText(result.stderr) || 'Command failed');
    return cleanText(out) || '(no output)';
  } catch (err: any) {
    if (err.message?.includes('Electron IPC')) throw err;
    return '(command failed: ' + (err.message || 'unknown') + ')';
  }
}

// ── WhatsMyName cache (username tool, session-level) ─────
interface WmnSite {
  name: string;
  uri_check: string;
  post_body?: unknown;
  post_data?: unknown;
  method?: unknown;
}

let wmnSitesCache: WmnSite[] | null = null;

async function loadWmnSites(externalSignal?: AbortSignal): Promise<WmnSite[] | null> {
  if (wmnSitesCache) return wmnSitesCache;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const onExternalAbort = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      return null;
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const res = await fetch('https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json', { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const sites = (json as { sites?: unknown }).sites;
    if (!Array.isArray(sites)) return null;
    const filtered = (sites as Record<string, unknown>[]).filter((s) => {
      const name = s['name'];
      const uriCheck = s['uri_check'];
      if (typeof name !== 'string' || typeof uriCheck !== 'string') return false;
      if (!uriCheck.includes('{account}')) return false;
      if (s['post_body'] || s['post_data']) return false;
      const method = s['method'];
      if (typeof method === 'string' && method.toUpperCase() === 'POST') return false;
      return true;
    }) as unknown as WmnSite[];
    wmnSitesCache = filtered.slice(0, 500);
    return wmnSitesCache;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function wmnHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ── Status badge helper ───────────────────────────────────
function StatusBadge({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const isGood = lower.includes('yes') || lower.includes('[ok]') || lower.includes('present') || lower.includes('enabled') || lower.includes('set') || lower.includes('found');
  const isBad = lower.includes('no') || lower.includes('[fail]') || lower.includes('[warn]') || lower.includes('not found') || lower.includes('not set') || lower.includes('disabled');
  const isFound = lower.includes('found') && !lower.includes('not');

  if (isFound || (isGood && !isBad)) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pulse-green/15 text-pulse-green text-[10px] font-medium">{value}</span>;
  }
  if (isBad) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pulse-yellow/15 text-pulse-yellow text-[10px] font-medium">{value}</span>;
  }
  return <span className="text-pulse-text">{value}</span>;
}

// ── Lookup Tools ──────────────────────────────────────────
const lookupTools: LookupTool[] = [
  {
    id: 'whois',
    name: 'WHOIS Lookup',
    description: 'Domain registration information',
    icon: <Globe size={20} />,
    category: 'Domain',
    placeholder: 'example.com',
    color: 'text-pulse-accent',
    gradient: 'from-pulse-accent/10 to-transparent',
    execute: async (query) => {
      const domain = query.replace(/^(https?:\/\/)/, '').replace(/\/.*$/, '');
      const parsed: Record<string, string> = {};
      let raw = '';

      if (window.electronAPI?.whoisLookup) {
        const result = await window.electronAPI.whoisLookup(domain);
        raw = cleanText(result.data || result.error || '(no output)');
        if (result.error && !result.data) throw new Error(cleanText(result.error));
      } else {
        throw new Error('WHOIS requires Electron runtime');
      }

      raw.split('\n').forEach((line: string) => {
        const match = line.match(/^([^:]+):\s*(.+)/);
        if (match) parsed[match[1].trim()] = match[2].trim();
      });

      return { type: 'WHOIS', query, data: parsed, raw, timestamp: new Date() };
    },
  },
  {
    id: 'dns',
    name: 'DNS Lookup',
    description: 'DNS records enumeration',
    icon: <Database size={20} />,
    category: 'Domain',
    placeholder: 'example.com',
    color: 'text-pulse-accent',
    gradient: 'from-pulse-accent/10 to-transparent',
    execute: async (query, signal) => {
      const domain = query.replace(/^(https?:\/\/)/, '').replace(/\/.*$/, '');
      const types = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA'];
      const parsed: Record<string, string> = {};
      const rawParts: string[] = [];

      for (const type of types) {
        if (signal?.aborted) break;
        try {
          if (window.electronAPI?.dnsResolve) {
            const result = await window.electronAPI.dnsResolve(domain, type);
            if (result.error) continue;
            const records = result.records || [];
            if (records.length > 0) {
              let value: string;
              if (type === 'MX') {
                value = records.map((r: any) => `${r.exchange} (pri ${r.priority})`).join(', ');
              } else if (type === 'SOA') {
                const soa = records[0];
                value = soa ? `${soa.nsname} ${soa.hostmaster} serial:${soa.serial}` : '';
              } else {
                value = records.join(', ');
              }
              if (value) {
                parsed[type] = value;
                rawParts.push(`;; ${type} RECORDS:`);
                records.forEach((r: any) => {
                  rawParts.push(`  ${domain}  IN  ${type}  ${typeof r === 'string' ? r : JSON.stringify(r)}`);
                });
              }
            }
          }
        } catch {}
      }

      if (Object.keys(parsed).length === 0) {
        return { type: 'DNS', query, data: { Note: 'No DNS records found' }, raw: 'No records found', timestamp: new Date() };
      }

      return { type: 'DNS', query, data: parsed, raw: rawParts.join('\n'), timestamp: new Date() };
    },
  },

  {
    id: 'email-osint',
    name: 'Email OSINT',
    description: 'Email address intelligence',
    icon: <Mail size={20} />,
    category: 'Person',
    placeholder: 'user@example.com',
    color: 'text-pulse-green',
    gradient: 'from-pulse-panel to-transparent',
    execute: async (query) => {
      const domain = query.split('@')[1] || '';
      const parsed: Record<string, string> = { Email: query, Domain: domain };

      if (window.electronAPI?.dnsResolve) {
        try {
          const mxResult = await window.electronAPI.dnsResolve(domain, 'MX');
          if (!mxResult.error && mxResult.records?.length > 0) {
            parsed['MX Records'] = mxResult.records.map((r: any) => `${r.exchange} (pri ${r.priority})`).join(', ');
          }
        } catch {}
      }

      const disposables = ['guerrillamail.com', 'tempmail.com', 'throwaway.email', 'yopmail.com', 'mailinator.com', 'temp-mail.org', '10minutemail.com'];
      parsed['Disposable'] = disposables.some(d => domain.toLowerCase().endsWith(d)) ? 'Yes' : 'No';

      if (window.electronAPI?.dnsResolve) {
        try {
          const soaResult = await window.electronAPI.dnsResolve(domain, 'SOA');
          if (!soaResult.error && soaResult.records?.length > 0) {
            const soa = soaResult.records[0];
            if (soa) {
              parsed['Primary NS'] = soa.nsname || '-';
              parsed['Admin Email'] = soa.hostmaster || '-';
              parsed['Serial'] = soa.serial ? String(soa.serial) : '-';
            }
          }
        } catch {}
        try {
          const aResult = await window.electronAPI.dnsResolve(domain, 'A');
          if (!aResult.error && aResult.records?.length > 0) {
            parsed['Domain IP'] = aResult.records[0];
          }
        } catch {}
      }

      return { type: 'Email OSINT', query, data: parsed, raw: JSON.stringify(parsed, null, 2), timestamp: new Date() };
    },
  },
  {
    id: 'username',
    name: 'Username Search',
    description: 'Check username across platforms',
    icon: <User size={20} />,
    category: 'Person',
    placeholder: 'johndoe',
    color: 'text-pulse-green',
    gradient: 'from-pulse-panel to-transparent',
    execute: async (query, signal) => {
      const username = query.trim();
      const encoded = encodeURIComponent(username);
      const topPlatforms = [
        { name: 'GitHub', url: `https://github.com/${username}` },
        { name: 'GitLab', url: `https://gitlab.com/${username}` },
        { name: 'Reddit', url: `https://www.reddit.com/user/${username}` },
        { name: 'Twitter/X', url: `https://x.com/${username}` },
        { name: 'Instagram', url: `https://www.instagram.com/${username}/` },
        { name: 'YouTube', url: `https://www.youtube.com/@${username}` },
        { name: 'Twitch', url: `https://www.twitch.tv/${username}` },
        { name: 'Keybase', url: `https://keybase.io/${username}` },
        { name: 'HackerOne', url: `https://hackerone.com/${username}` },
        { name: 'TryHackMe', url: `https://tryhackme.com/p/${username}` },
      ];
      let deepList: { name: string; url: string }[] = topPlatforms;
      let profileUrls: string[] = [];
      try {
        const wmn = await loadWmnSites(signal);
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (wmn && wmn.length > 0) {
          profileUrls = wmn.map((s) => s.uri_check.replace(/\{account\}/g, encoded));
          const seen = new Set<string>(topPlatforms.map((p) => wmnHost(p.url)));
          const extras: { name: string; url: string }[] = [];
          for (const s of wmn) {
            if (extras.length >= 20) break;
            const url = s.uri_check.replace(/\{account\}/g, encoded);
            const host = wmnHost(url);
            if (!host || seen.has(host)) continue;
            seen.add(host);
            extras.push({ name: s.name, url });
          }
          deepList = [...topPlatforms, ...extras];
        }
      } catch {}
      const deepResults: Record<string, string> = {};
      const rawParts: string[] = [`Checking username: ${username}`, ''];
      const foundNames: string[] = [];

      for (const platform of deepList) {
        if (signal?.aborted) break;
        try {
          const output = await execCmd(
            `curl -s -o /dev/null -w "%{http_code}" -L --max-time 5 "${platform.url}"`,
            8000
          );
          const status = output.trim();
          const exists = status === '200';
          deepResults[platform.name] = exists ? `Found (HTTP ${status})` : `Not found (HTTP ${status})`;
          rawParts.push(`${platform.name}: ${exists ? 'FOUND' : 'NOT FOUND'} [${status}] (${platform.url})`);
          if (exists) foundNames.push(platform.name);
        } catch {
          deepResults[platform.name] = 'Unreachable';
          rawParts.push(`${platform.name}: UNREACHABLE (${platform.url})`);
        }
      }

      if (profileUrls.length > 0) {
        rawParts.push('');
        rawParts.push(`Profile URLs (${profileUrls.length}):`);
        for (const u of profileUrls) rawParts.push(u);
      }

      const parsed: Record<string, string> = {
        Username: username,
        Checked: `${deepList.length} deep + ${profileUrls.length} profile links`,
        Found: foundNames.length > 0 ? `${foundNames.length} (${foundNames.join(', ')})` : 'None',
        ...deepResults,
      };

      return { type: 'Username Search', query, data: parsed, raw: rawParts.join('\n'), timestamp: new Date() };
    },
  },
  {
    id: 'ip-lookup',
    name: 'IP Lookup',
    description: 'Full IP address information',
    icon: <Server size={20} />,
    category: 'Network',
    placeholder: '1.1.1.1',
    color: 'text-pulse-orange',
    gradient: 'from-pulse-panel to-transparent',
    execute: async (query, signal) => {
      const ip = query.replace(/[^0-9a-fA-F.:]/g, '');
      let data: Record<string, string> = {};
      let raw = '';

      // Primary: ipinfo via fetch (reliable in Electron renderer)
      try {
        const r = await fetch(`https://ipinfo.io/${ip}/json`, signal ? { signal } : {});
        if (r.ok) {
          const j = await r.json();
          raw = JSON.stringify(j, null, 2);
          const tmp: Record<string, string> = {};
          if (j.ip) tmp.IP = j.ip;
          if (j.hostname) tmp.Hostname = j.hostname;
          if (j.city) tmp.City = j.city;
          if (j.region) tmp.Region = j.region;
          if (j.country) tmp.Country = j.country;
          if (j.loc) tmp.Location = j.loc;
          if (j.org) tmp.Organization = j.org;
          if (j.timezone) tmp.Timezone = j.timezone;
          if (j.postal) tmp.Postal = j.postal;
          if (Object.keys(tmp).length > 0) {
            return { type: 'IP Lookup', query, data: tmp, raw, timestamp: new Date() };
          }
        }
      } catch {}

      // Fallback 1: ip-api.com
      try {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const r2 = await fetch(`https://ip-api.com/json/${ip}?fields=status,message,query,country,regionName,city,zip,lat,lon,timezone,isp,org,as`, signal ? { signal } : {});
        if (r2.ok) {
          const j2 = await r2.json();
          raw = JSON.stringify(j2, null, 2);
          if (j2.status === 'success') {
            const tmp2: Record<string, string> = {};
            if (j2.query) tmp2.IP = j2.query;
            if (j2.city) tmp2.City = j2.city;
            if (j2.regionName) tmp2.Region = j2.regionName;
            if (j2.country) tmp2.Country = j2.country;
            if (j2.lat && j2.lon) tmp2.Location = `${j2.lat},${j2.lon}`;
            if (j2.org) tmp2.Organization = j2.org;
            else if (j2.isp) tmp2.Organization = j2.isp;
            if (j2.timezone) tmp2.Timezone = j2.timezone;
            if (j2.zip) tmp2.Postal = j2.zip;
            if (j2.as) tmp2.AS = j2.as;
            if (Object.keys(tmp2).length > 0) {
              return { type: 'IP Lookup', query, data: tmp2, raw, timestamp: new Date() };
            }
          }
        }
      } catch {}

      // Fallback 2: curl via main process (for restricted fetch)
      try {
        const output = await execCmd(`curl -s "https://ipinfo.io/${ip}/json"`, 8000);
        if (output) {
          const json = JSON.parse(output);
          raw = JSON.stringify(json, null, 2);
          const tmp: Record<string, string> = {};
          if (json.ip) tmp.IP = json.ip;
          if (json.hostname) tmp.Hostname = json.hostname;
          if (json.city) tmp.City = json.city;
          if (json.region) tmp.Region = json.region;
          if (json.country) tmp.Country = json.country;
          if (json.loc) tmp.Location = json.loc;
          if (json.org) tmp.Organization = json.org;
          if (json.timezone) tmp.Timezone = json.timezone;
          if (json.postal) tmp.Postal = json.postal;
          if (Object.keys(tmp).length > 0) {
            return { type: 'IP Lookup', query, data: tmp, raw, timestamp: new Date() };
          }
        }
      } catch {}

      // Final fallback: reverse DNS via Electron IPC
      if (window.electronAPI?.dnsReverse) {
        try {
          const rev = await window.electronAPI.dnsReverse(ip);
          data['IP'] = ip;
          if (rev.hostnames?.length) data['Hostnames'] = rev.hostnames.join(', ');
          else data['Info'] = 'No reverse DNS, IP info services unreachable';
          raw = JSON.stringify({ ip, hostnames: rev.hostnames, fallback: true }, null, 2);
        } catch {}
      }
      if (Object.keys(data).length === 0) {
        data['IP'] = ip;
        data['Error'] = 'All IP info services failed (ipinfo, ip-api) — check internet/CORS';
        raw = raw || JSON.stringify({ error: 'no data', ip }, null, 2);
      }
      return { type: 'IP Lookup', query, data, raw: raw || JSON.stringify(data, null, 2), timestamp: new Date() };
    },
  },
  {
    id: 'url-check',
    name: 'URL Reputation',
    description: 'URL safety & redirect check',
    icon: <Link2 size={20} />,
    category: 'Web',
    placeholder: 'https://example.com',
    color: 'text-pulse-yellow',
    gradient: 'from-pulse-panel to-transparent',
    execute: async (query) => {
      let url = query;
      if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
      const parsed: Record<string, string> = { URL: url };

      try {
        const output = await execCmd(
          `curl -s -o /dev/null -w "%{http_code}|%{url_effective}|%{time_total}|%{size_download}|%{content_type}|%{redirect_url}" -L --max-time 10 -I "${url}"`,
          15000
        );
        const parts = output.trim().split('|');
        parsed['Status'] = parts[0] || '-';
        parsed['Final URL'] = parts[1] || url;
        parsed['Response Time'] = parts[2] ? `${(parseFloat(parts[2]) * 1000).toFixed(0)}ms` : '-';
        parsed['Content-Type'] = parts[4] || '-';
        parsed['Redirected'] = parts[5] && parts[5] !== url ? `Yes -> ${parts[5]}` : 'No';
      } catch (err: any) {
        parsed['Error'] = err.message;
      }

      try {
        const headers = await execCmd(`curl -s -I -L --max-time 10 "${url}"`, 12000);
        const hLower = headers.toLowerCase();
        parsed['HSTS'] = hLower.includes('strict-transport-security') ? 'Yes' : 'No';
        parsed['CSP'] = hLower.includes('content-security-policy') ? 'Yes' : 'No';
        parsed['X-Frame-Options'] = hLower.includes('x-frame-options') ? 'Yes' : 'No';
        parsed['X-Content-Type'] = hLower.includes('x-content-type-options') ? 'Yes' : 'No';
        const serverMatch = headers.match(/server:\s*(.+)/i);
        if (serverMatch) parsed['Server'] = serverMatch[1].trim();
      } catch {}

      return { type: 'URL Reputation', query, data: parsed, raw: JSON.stringify(parsed, null, 2), timestamp: new Date() };
    },
  },
  {
    id: 'breach-check',
    name: 'Breach Check',
    description: 'Email security & breach intelligence',
    icon: <Shield size={20} />,
    category: 'Security',
    placeholder: 'user@example.com',
    color: 'text-pulse-red',
    gradient: 'from-pulse-panel to-transparent',
    execute: async (query) => {
      const domain = query.includes('@') ? query.split('@')[1] : query;
      const parsed: Record<string, string> = {
        Query: query,
        Note: 'HIBP requires API key. Showing domain-level intelligence.',
      };

      if (window.electronAPI?.dnsResolve) {
        try {
          const mxResult = await window.electronAPI.dnsResolve(domain, 'MX');
          if (!mxResult.error && mxResult.records?.length > 0) {
            const mxRecords = mxResult.records.map((r: any) => r.exchange || String(r));
            parsed['MX Providers'] = mxRecords.join(', ');
            if (mxRecords.some((mx: string) => mx.includes('google'))) parsed['Email Provider'] = 'Google Workspace';
            else if (mxRecords.some((mx: string) => mx.includes('outlook') || mx.includes('microsoft'))) parsed['Email Provider'] = 'Microsoft 365';
            else if (mxRecords.some((mx: string) => mx.includes('protonmail'))) parsed['Email Provider'] = 'ProtonMail';
            else if (mxRecords.some((mx: string) => mx.includes('zoho'))) parsed['Email Provider'] = 'Zoho Mail';
            else parsed['Email Provider'] = 'Unknown';
          }
        } catch {}
      }

      if (window.electronAPI?.dnsResolve) {
        try {
          const dmarcResult = await window.electronAPI.dnsResolve(`_dmarc.${domain}`, 'TXT');
          if (!dmarcResult.error && dmarcResult.records?.length > 0) {
            parsed['DMARC'] = 'Present';
            const dmarcText = dmarcResult.records[0];
            if (typeof dmarcText === 'string') {
              const policyMatch = dmarcText.match(/p=(\w+)/);
              if (policyMatch) parsed['DMARC Policy'] = policyMatch[1];
            }
          } else {
            parsed['DMARC'] = 'Not found';
          }
        } catch {}
      }

      if (window.electronAPI?.dnsResolve) {
        try {
          const spfResult = await window.electronAPI.dnsResolve(domain, 'TXT');
          if (!spfResult.error && spfResult.records?.length > 0) {
            const spf = spfResult.records.find((r: string) => r.includes('v=spf1'));
            parsed['SPF'] = spf ? 'Present' : 'Not found';
          }
        } catch {}
      }

      return { type: 'Breach Check', query, data: parsed, raw: JSON.stringify(parsed, null, 2), timestamp: new Date() };
    },
  },
  {
    id: 'ssl-check',
    name: 'SSL/TLS Check',
    description: 'Certificate information',
    icon: <LockIcon size={20} />,
    category: 'Security',
    placeholder: 'example.com',
    color: 'text-pulse-red',
    gradient: 'from-pulse-panel to-transparent',
    execute: async (query) => {
      const domain = query.replace(/^(https?:\/\/)/, '').replace(/\/.*$/, '');
      const parsed: Record<string, string> = { Domain: domain };

      try {
        const output = await execCmd(`curl -s -I -L --max-time 10 "https://${domain}"`, 12000);
        parsed['Protocol'] = 'HTTPS';
        parsed['Server'] = (output.match(/server:\s*(.+)/i) || [])[1]?.trim() || '-';
        parsed['HSTS'] = output.toLowerCase().includes('strict-transport-security') ? 'Enabled' : 'Disabled';
        parsed['X-Frame-Options'] = (output.match(/x-frame-options:\s*(.+)/i) || [])[1]?.trim() || 'Not set';
        parsed['X-Content-Type-Options'] = (output.match(/x-content-type-options:\s*(.+)/i) || [])[1]?.trim() || 'Not set';
        parsed['CSP'] = output.toLowerCase().includes('content-security-policy') ? 'Set' : 'Not set';
      } catch (err: any) {
        parsed['HTTP Error'] = err.message;
      }

      try {
        const certOutput = await execCmd(
          `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -subject -issuer -dates -fingerprint 2>/dev/null`,
          10000
        );
        const subjectMatch = certOutput.match(/subject=(.+)/);
        const issuerMatch = certOutput.match(/issuer=(.+)/);
        const notBeforeMatch = certOutput.match(/notBefore=(.+)/);
        const notAfterMatch = certOutput.match(/notAfter=(.+)/);
        const fpMatch = certOutput.match(/SHA1 Fingerprint=(.+)/);

        if (subjectMatch) parsed['Certificate Subject'] = cleanText(subjectMatch[1].trim());
        if (issuerMatch) parsed['Issuer'] = cleanText(issuerMatch[1].trim());
        if (notBeforeMatch) parsed['Valid From'] = notBeforeMatch[1].trim();
        if (notAfterMatch) {
          parsed['Valid Until'] = notAfterMatch[1].trim();
          const expiry = new Date(notAfterMatch[1].trim());
          const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          parsed['Days Until Expiry'] = daysLeft > 0 ? `${daysLeft} days` : `EXPIRED`;
        }
        if (fpMatch) parsed['SHA1 Fingerprint'] = fpMatch[1].trim();
      } catch {
        parsed['SSL'] = 'Could not retrieve certificate info';
      }

      return { type: 'SSL/TLS Check', query, data: parsed, raw: JSON.stringify(parsed, null, 2), timestamp: new Date() };
    },
  },
];

const categories = ['All', ...new Set(lookupTools.map((t) => t.category))];

export default function OSINTLookupPage() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTool, setActiveTool] = useState<string>(lookupTools[0].id);
  const [toolInput, setToolInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resultSearch, setResultSearch] = useState('');
  const [rawExpanded, setRawExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleStop = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const filteredTools = lookupTools.filter((tool) => {
    const matchesCategory = activeCategory === 'All' || tool.category === activeCategory;
    const matchesSearch =
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const currentTool = lookupTools.find((t) => t.id === activeTool)!;

  // Filter result data by search - hide empty/dash fields (geolocation only where exists)
  const filteredData = useMemo(() => {
    if (!result?.data) return {};
    const isValid = (v: string) => v && String(v).trim() !== '' && String(v).trim() !== '-' && String(v).trim().toLowerCase() !== 'none' && String(v).trim().toLowerCase() !== 'n/a';
    const clean = Object.fromEntries(Object.entries(result.data).filter(([, v]) => isValid(String(v)))) as Record<string, string>;
    if (!resultSearch.trim()) return clean;
    const q = resultSearch.toLowerCase();
    const filtered: Record<string, string> = {};
    Object.entries(clean).forEach(([key, value]) => {
      if (key.toLowerCase().includes(q) || String(value).toLowerCase().includes(q)) {
        filtered[key] = value;
      }
    });
    return filtered;
  }, [result, resultSearch]);

  const handleRun = async () => {
    if (!toolInput.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setLoading(true);
    setResult(null);
    setError(null);
    setResultSearch('');
    setRawExpanded(false);
    try {
      const r = await currentTool.execute(toolInput.trim(), signal);
      if (signal.aborted) return;
      setResult(r);
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') return;
      setError(err.message || 'Lookup failed');
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  };

  const copyResult = async () => {
    if (result) {
      try {
        await navigator.clipboard.writeText(result.raw);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {}
    }
  };

  const validCount = result?.data ? Object.entries(result.data).filter(([, v]) => v && String(v).trim() !== '' && String(v).trim() !== '-' && String(v).trim().toLowerCase() !== 'none' && String(v).trim().toLowerCase() !== 'n/a').length : 0;
  const resultCount = Object.keys(filteredData).length;
  const totalCount = validCount;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex gap-4 h-full"
    >
      {/* Left: Tool List */}
      <div className="w-72 flex flex-col gap-3">
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tools..."
            className="w-full pl-10 pr-4 py-2.5 bg-pulse-surface border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
          />
        </div>

        {/* Categories */}
        <div className="flex gap-1.5 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${
                activeCategory === cat
                  ? 'bg-pulse-accent text-pulse-bg font-semibold'
                  : 'bg-pulse-panel border border-pulse-border text-pulse-muted hover:text-pulse-text hover:border-pulse-borderStrong'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Tools */}
        <div className="flex-1 overflow-auto space-y-1.5">
          {filteredTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => { setActiveTool(tool.id); setResult(null); setError(null); setToolInput(''); setResultSearch(''); }}
              className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                activeTool === tool.id
                  ? `bg-pulse-panel border border-pulse-accent/30`
                  : 'bg-pulse-surface border border-pulse-border hover:border-pulse-borderStrong hover:bg-pulse-surfaceHover'
              }`}
            >
              <span className={tool.color}>{tool.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">{tool.name}</div>
                <div className="text-[10px] text-pulse-muted truncate">{tool.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Tool Panel */}
      <div className="flex-1 bg-pulse-surface border border-pulse-border rounded-xl flex flex-col overflow-hidden">
        {/* Tool Header */}
        <div className={`flex items-center gap-3 px-5 py-4 border-b border-pulse-border bg-pulse-panel/40`}>
          <span className={currentTool.color}>{currentTool.icon}</span>
          <div>
            <div className="text-sm font-semibold">{currentTool.name}</div>
            <div className="text-xs text-pulse-muted">{currentTool.description}</div>
          </div>
        </div>

        {/* Input */}
        <div className="px-5 py-4 border-b border-pulse-border/50">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted" />
              <input
                type="text"
                value={toolInput}
                onChange={(e) => setToolInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRun()}
                placeholder={currentTool.placeholder}
                className="w-full pl-9 pr-4 py-2.5 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
              />
            </div>
            {loading ? (
              <button
                onClick={handleStop}
                className="flex items-center gap-2 px-5 py-2.5 bg-pulse-red/15 text-pulse-red border border-pulse-red/25 font-semibold rounded-xl hover:bg-pulse-red/20 active:scale-[0.98] transition-all text-sm"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleRun}
                disabled={!toolInput.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-pulse-accent text-pulse-bg font-semibold rounded-xl hover:bg-pulse-accentSoft active:scale-[0.98] transition-all disabled:opacity-40 text-sm"
              >
                <Search size={14} />
                Run
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto p-5">
          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-2 border-pulse-accent/20 border-t-pulse-accent animate-spin" />
                <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-pulse-accentDim/20 border-b-pulse-accentDim animate-spin" style={{ animationDirection: 'reverse', animationDuration: '2s' }} />
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-pulse-text">Running {currentTool.name}...</div>
                <div className="text-xs text-pulse-muted mt-1">Querying target via native IPC</div>
              </div>
            </div>
          )}

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 bg-pulse-red/15 border border-pulse-red/25 rounded-xl text-sm text-pulse-red flex items-start gap-3"
              >
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">Lookup Failed</div>
                  <div className="text-xs mt-1 opacity-80">{error}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Results */}
          {result && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* Result Header + Search */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold ${currentTool.color} bg-pulse-panel`}>
                    {result.type}
                  </span>
                  <span className="text-xs text-pulse-muted font-mono">{result.query}</span>
                  <span className="text-[10px] text-pulse-muted/60">
                    {resultCount}/{totalCount} fields
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Result search */}
                  {totalCount > 3 && (
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pulse-muted" />
                      <input
                        type="text"
                        value={resultSearch}
                        onChange={(e) => setResultSearch(e.target.value)}
                        placeholder="Filter results..."
                        className="pl-7 pr-3 py-1.5 bg-pulse-bg border border-pulse-border rounded-xl text-[11px] font-mono w-40 outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
                      />
                    </div>
                  )}
                  <button
                    onClick={copyResult}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel transition-all"
                  >
                    {copied ? <Check size={12} className="text-pulse-green" /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Data Cards */}
              {Object.keys(filteredData).length > 0 && (
                <div className="grid gap-2">
                  {Object.entries(filteredData).map(([key, value], i) => {
                    const isLong = value.length > 80;
                    const isStatus = ['HSTS', 'CSP', 'X-Frame-Options', 'X-Content-Type', 'X-Content-Type-Options',
                      'DMARC', 'SPF', 'Protocol', 'Disposable', 'Redirected', 'Status'].includes(key);
                    return (
                      <motion.div
                        key={key}
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="flex items-start gap-3 p-3 bg-pulse-bg border border-pulse-border/50 rounded-xl hover:border-pulse-borderStrong hover:bg-pulse-surfaceHover transition-colors group"
                      >
                        <div className="flex-shrink-0 w-32">
                          <span className="text-[11px] font-mono font-semibold text-pulse-accent">{key}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {isStatus ? (
                            <StatusBadge value={value} />
                          ) : (
                            <span className={`text-[11px] font-mono text-pulse-text ${isLong ? 'break-all leading-relaxed' : ''}`}>
                              {value}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => { navigator.clipboard.writeText(value); }}
                          className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel transition-all"
                          title="Copy value"
                        >
                          <Copy size={10} />
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {Object.keys(filteredData).length === 0 && resultSearch && (
                <div className="text-center py-8 text-pulse-muted">
                  <Search size={20} className="mx-auto mb-2 opacity-30" />
                  <div className="text-xs">No fields match "{resultSearch}"</div>
                </div>
              )}

              {/* Raw Output (collapsible) */}
              <div className="border border-pulse-border/50 rounded-xl overflow-hidden">
                <button
                  onClick={() => setRawExpanded(!rawExpanded)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] font-semibold text-pulse-muted uppercase tracking-wider hover:bg-pulse-panel/30 transition-colors"
                >
                  {rawExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Raw Output
                  <span className="text-[9px] font-normal text-pulse-muted/60 ml-auto">
                    {result.raw.split('\n').length} lines
                  </span>
                </button>
                <AnimatePresence>
                  {rawExpanded && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <pre className="px-4 pb-4 text-[11px] font-mono text-pulse-muted overflow-auto max-h-64 whitespace-pre-wrap bg-pulse-bg/50">
                        {result.raw}
                      </pre>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* Empty State */}
          {!result && !loading && !error && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className={`w-20 h-20 rounded-2xl bg-pulse-panel border border-pulse-border flex items-center justify-center`}>
                <span className={`${currentTool.color} opacity-40`}>{currentTool.icon}</span>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-pulse-text">{currentTool.name}</div>
                <div className="text-xs text-pulse-muted mt-1">Enter a target and click Run</div>
                <div className="text-[10px] text-pulse-muted/50 mt-2">
                  Results via native IPC -- no CORS restrictions
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-pulse-muted/40">
                <Info size={10} />
                <span>Press Enter to run</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
