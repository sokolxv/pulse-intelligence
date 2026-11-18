import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Search,
  Play,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  AlertOctagon,
  Globe,
  Lock,
  Server,
  FileWarning,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Download,
} from 'lucide-react';
import type { VulnCheck } from '../types';
import { matchCveByTechnologies } from '../lib/cve-db';
import type { Technology } from '../lib/cve-db';
import { runInjectionChecks } from '../lib/detectors-injection';
import { runMiscChecks } from '../lib/detectors-misc';
import { runReconExtra } from '../lib/recon-extra';

interface ScanResult extends VulnCheck {
  details: string;
  recommendation: string;
}

const severityColors: Record<string, string> = {
  critical: 'text-pulse-red bg-pulse-red/15 border-pulse-red/25',
  high: 'text-pulse-orange bg-pulse-orange/15 border-pulse-orange/25',
  medium: 'text-pulse-yellow bg-pulse-yellow/15 border-pulse-yellow/25',
  low: 'text-pulse-purple bg-pulse-purple/15 border-pulse-purple/25',
  info: 'text-pulse-muted bg-pulse-panel border-pulse-border',
};

const severityIcons: Record<string, React.ReactNode> = {
  critical: <AlertOctagon size={14} />,
  high: <XCircle size={14} />,
  medium: <AlertTriangle size={14} />,
  low: <Info size={14} />,
  info: <Info size={14} />,
};

async function execCmd(command: string, timeoutMs = 10000): Promise<string> {
  if (!window.electronAPI?.execCommand) return '';
  try {
    const result = await window.electronAPI.execCommand(command, timeoutMs);
    return (result.stdout || result.stderr || '').trim();
  } catch {
    return '';
  }
}

function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = raw.split('\n');
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*(.+)/);
    if (m) headers[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return headers;
}

function detectTechnologies(headers: Record<string, string>, body: string): Technology[] {
  const techs: Technology[] = [];
  const push = (name: string, version?: string, category?: string) => {
    if (!techs.some(t => t.name === name)) techs.push({ name, version: version || undefined, category });
  };
  const server = headers['server'] || '';
  const powered = headers['x-powered-by'] || '';
  const aspVer = headers['x-aspnet-version'] || headers['x-aspnetmvc-version'] || '';
  const generator = headers['x-generator'] || '';
  let m: RegExpMatchArray | null;
  m = server.match(/Apache(?:[\s/](\d+\.\d+(?:\.\d+)?))/i);
  if (/apache/i.test(server)) push('Apache HTTP Server', m?.[1], 'Web Server');
  m = server.match(/nginx(?:[/\s](\d+\.\d+(?:\.\d+)?))?/i);
  if (/nginx/i.test(server)) push('Nginx', m?.[1], 'Web Server');
  m = server.match(/Microsoft-IIS\/(\d+\.\d+)/i);
  if (/microsoft-iis/i.test(server)) push('IIS', m?.[1], 'Web Server');
  m = powered.match(/PHP\/(\d+\.\d+(?:\.\d+)?)/i);
  if (/php/i.test(powered)) push('PHP', m?.[1], 'Programming Language');
  m = server.match(/OpenSSL\/(\d+\.\d+(?:\.\d+)?[a-z]?)/i);
  if (/openssl/i.test(server)) push('OpenSSL', m?.[1], 'SSL/TLS');
  m = body.match(/<meta name="generator" content="WordPress (\d+\.\d+(?:\.\d+)?)"/i);
  if (m?.[1]) push('WordPress', m[1], 'CMS');
  else if (/\/wp-content\//i.test(body) || /\/wp-includes\//i.test(body)) push('WordPress', undefined, 'CMS');
  m = body.match(/<meta name="generator" content="Joomla[^"]*?(\d+\.\d+(?:\.\d+)?)/i);
  if (/\/components\/com_/i.test(body) || /joomla/i.test(body)) push('Joomla', m?.[1], 'CMS');
  m = generator.match(/Drupal\s*(\d+\.\d+(?:\.\d+)?)?/i) || body.match(/Drupal\s*(\d+\.\d+(?:\.\d+)?)/i);
  if (/drupal/i.test(generator) || /\/sites\/default\//i.test(body)) push('Drupal', m?.[1], 'CMS');
  m = powered.match(/Laravel/i) ? body.match(/Laravel[ /]?v?(\d+\.\d+(?:\.\d+)?)/i) : body.match(/Laravel[ /]?v?(\d+\.\d+(?:\.\d+)?)/i);
  if (/laravel/i.test(powered) || /laravel_session/i.test(body) || /laravel/i.test(body)) push('Laravel', m?.[1], 'Framework');
  if (/csrftoken/i.test(body) || /csrfmiddlewaretoken/i.test(body) || /wsgiserver/i.test(server)) push('Django', undefined, 'Framework');
  m = powered.match(/Express\/(\d+\.\d+(?:\.\d+)?)/i);
  if (/express/i.test(powered)) push('Express', m?.[1], 'Framework');
  if (aspVer) push('ASP.NET', aspVer.split(',')[0].trim(), 'Framework');
  else if (/asp\.net/i.test(powered)) push('ASP.NET', undefined, 'Framework');
  m = body.match(/jquery[.-](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js/i) || body.match(/\/jquery-(\d+\.\d+\.\d+)/i);
  if (m?.[1]) push('jQuery', m[1], 'JavaScript Library');
  m = body.match(/react-dom[.-](\d+\.\d+\.\d+)/i) || body.match(/react@(\d+\.\d+\.\d+)/i);
  if (/react(?:\.|-)?min\.js/i.test(body) || /__REACT_DEVTOOLS_GLOBAL_HOOK__/i.test(body)) push('React', m?.[1], 'JavaScript Library');
  m = body.match(/vue[.-](\d+\.\d+\.\d+)/i) || body.match(/vue@(\d+\.\d+\.\d+)/i);
  if (/vue(?:\.|-)?min\.js/i.test(body) || /__VUE_DEVTOOLS_GLOBAL_HOOK__/i.test(body)) push('Vue.js', m?.[1], 'JavaScript Library');
  return techs;
}

const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeMdCell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function exportFileName(targetUrl: string, ext: string): string {
  let host = 'target';
  try {
    host = new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'target';
  } catch {
    host = (targetUrl || 'target').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'target';
  }
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `vulnscan-${host}-${stamp}.${ext}`;
}

function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildStandaloneHtml(targetUrl: string, results: ScanResult[]): string {
  const date = new Date().toLocaleString();
  const rows = results.map(r => (
    `<tr><td>${escapeHtml(r.severity)}</td><td>${escapeHtml(r.id)}</td>` +
    `<td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.description)}</td>` +
    `<td><pre>${escapeHtml(r.details)}</pre></td></tr>`
  )).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Vulnerability Scan — ${escapeHtml(targetUrl)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;background:#0a0e17;color:#e2e8f0;margin:0;padding:24px}
h1{font-size:20px;margin:0 0 4px}
.meta{color:#94a3b8;font-size:12px;margin-bottom:16px}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{border:1px solid #1e293b;padding:8px;vertical-align:top;text-align:left}
th{background:#111827}
pre{white-space:pre-wrap;margin:0;font-size:11px}
</style>
</head>
<body>
<h1>Vulnerability Scan Report</h1>
<div class="meta">Target: ${escapeHtml(targetUrl)} | Date: ${escapeHtml(date)} | Findings: ${results.length}</div>
<table>
<thead><tr><th>Severity</th><th>ID</th><th>Name</th><th>Description</th><th>Result</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;
}

function buildMarkdownReport(targetUrl: string, results: ScanResult[]): string {
  const date = new Date().toLocaleString();
  const lines = results.map(r =>
    `| ${escapeMdCell(r.severity)} | ${escapeMdCell(r.id)} | ${escapeMdCell(r.name)} | ${escapeMdCell(r.description)} | ${escapeMdCell(r.details)} |`
  );
  return `# Vulnerability Scan Report

Target: ${targetUrl}
Date: ${date}
Findings: ${results.length}

| Severity | ID | Name | Description | Result |
| --- | --- | --- | --- | --- |
${lines.join('\n')}
`;
}

export default function VulnScannerPage() {
  const [target, setTarget] = useState('');
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [currentCheck, setCurrentCheck] = useState('');
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Record<string, boolean>>({});
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      stopRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

  const handleStop = useCallback(() => {
    stopRef.current = true;
    abortRef.current?.abort();
    setScanning(false);
    setCurrentCheck('Остановлено');
    setProgress(0);
  }, []);

  const toggleResult = (id: string) => {
    setExpandedResults(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const runCheck = async (
    id: string,
    name: string,
    category: string,
    fn: (url: string) => Promise<{ severity: ScanResult['severity']; description: string; details: string; recommendation: string }>
  ): Promise<ScanResult | null> => {
    setCurrentCheck(name);
    try {
      const result = await fn(target);
      if (stopRef.current || abortRef.current?.signal.aborted) return null;
      return { ...result, id, name, category, status: 'completed' };
    } catch {
      return null;
    }
  };

  const handleScan = useCallback(async () => {
    if (!target.trim()) return;

    let url = target.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    setTarget(url);

    setScanning(true);
    setResults([]);
    setProgress(0);
    stopRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;

    const allResults: ScanResult[] = [];
    const totalChecks = 14;
    let checkIndex = 0;

    const updateProgress = () => {
      checkIndex++;
      setProgress(Math.round((checkIndex / totalChecks) * 100));
    };
    const isStopped = (): boolean => stopRef.current || abortRef.current?.signal.aborted === true;

    // Check 1: Security Headers (via curl)
    const securityHeadersCheck = await runCheck(
      'sec-headers', 'Security Headers', 'Headers',
      async (targetUrl) => {
        const raw = await execCmd(`curl -s -I -L --max-time 8 "${targetUrl}"`, 12000);
        const headers = parseHeaders(raw);

        const findings: { name: string; present: boolean; value?: string }[] = [
          { name: 'Strict-Transport-Security', present: !!headers['strict-transport-security'], value: headers['strict-transport-security'] },
          { name: 'Content-Security-Policy', present: !!headers['content-security-policy'], value: headers['content-security-policy'] },
          { name: 'X-Frame-Options', present: !!headers['x-frame-options'], value: headers['x-frame-options'] },
          { name: 'X-Content-Type-Options', present: !!headers['x-content-type-options'], value: headers['x-content-type-options'] },
          { name: 'X-XSS-Protection', present: !!headers['x-xss-protection'], value: headers['x-xss-protection'] },
          { name: 'Referrer-Policy', present: !!headers['referrer-policy'], value: headers['referrer-policy'] },
          { name: 'Permissions-Policy', present: !!headers['permissions-policy'] || !!headers['feature-policy'], value: headers['permissions-policy'] || headers['feature-policy'] },
        ];

        const missing = findings.filter(f => !f.present);
        const severity = missing.length >= 4 ? 'high' : missing.length >= 2 ? 'medium' : 'low';

        return {
          severity,
          description: `${missing.length} of ${findings.length} security headers missing`,
          details: findings.map(f =>
            `${f.present ? '[OK]' : '[FAIL]'} ${f.name}${f.value ? `: ${f.value}` : ''}`
          ).join('\n'),
          recommendation: missing.length > 0
            ? `Add missing headers: ${missing.map(f => f.name).join(', ')}`
            : 'All security headers are properly configured.',
        };
      }
    );
    if (securityHeadersCheck) allResults.push(securityHeadersCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 2: HTTPS Enforcement
    const httpsCheck = await runCheck(
      'https', 'HTTPS Enforcement', 'Transport',
      async (targetUrl) => {
        const isHTTPS = targetUrl.startsWith('https://');
        let hsts = false;
        let server = '';
        let xPoweredBy = '';

        try {
          const raw = await execCmd(`curl -s -I --max-time 8 "${targetUrl}"`, 12000);
          const headers = parseHeaders(raw);
          hsts = !!headers['strict-transport-security'];
          server = headers['server'] || '';
          xPoweredBy = headers['x-powered-by'] || '';
        } catch {}

        const severity = !isHTTPS ? 'high' : !hsts ? 'medium' : 'info';

        return {
          severity,
          description: isHTTPS ? 'HTTPS is enabled' : 'HTTPS is NOT enabled',
          details: [
            `Protocol: ${isHTTPS ? 'HTTPS [OK]' : 'HTTP [FAIL]'}`,
            `HSTS: ${hsts ? 'Enabled [OK]' : 'Disabled [WARN]'}`,
            `Server: ${server || 'Not disclosed'}`,
            `X-Powered-By: ${xPoweredBy || 'Not disclosed'}`,
          ].join('\n'),
          recommendation: !isHTTPS ? 'Enable HTTPS and redirect all HTTP traffic.' : !hsts ? 'Add HSTS header to prevent downgrade attacks.' : 'Good.',
        };
      }
    );
    if (httpsCheck) allResults.push(httpsCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 3: Server Info Disclosure
    const serverInfoCheck = await runCheck(
      'server-info', 'Server Information Disclosure', 'Headers',
      async (targetUrl) => {
        const raw = await execCmd(`curl -s -I -L --max-time 8 "${targetUrl}"`, 12000);
        const headers = parseHeaders(raw);

        const server = headers['server'] || '';
        const powered = headers['x-powered-by'] || '';
        const asp = headers['x-aspnet-version'] || '';
        const generator = headers['x-generator'] || '';
        const via = headers['via'] || '';
        const xCache = headers['x-cache'] || '';

        const disclosed = [server, powered, asp, generator].filter(Boolean);
        const severity = disclosed.length >= 2 ? 'medium' : disclosed.length === 1 ? 'low' : 'info';

        return {
          severity,
          description: disclosed.length > 0
            ? `${disclosed.length} server information header(s) disclosed`
            : 'No server information disclosed',
          details: [
            `Server: ${server || 'Not disclosed [OK]'}`,
            `X-Powered-By: ${powered || 'Not disclosed [OK]'}`,
            `X-AspNet-Version: ${asp || 'Not disclosed [OK]'}`,
            `X-Generator: ${generator || 'Not disclosed [OK]'}`,
            `Via: ${via || 'Not set'}`,
            `X-Cache: ${xCache || 'Not set'}`,
          ].join('\n'),
          recommendation: disclosed.length > 0
            ? 'Remove server version information to reduce attack surface.'
            : 'Good.',
        };
      }
    );
    if (serverInfoCheck) allResults.push(serverInfoCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 4: Clickjacking Protection
    const clickjackingCheck = await runCheck(
      'clickjacking', 'Clickjacking Protection', 'Headers',
      async (targetUrl) => {
        const raw = await execCmd(`curl -s -I -L --max-time 8 "${targetUrl}"`, 12000);
        const headers = parseHeaders(raw);
        const xfo = headers['x-frame-options'] || '';
        const csp = headers['content-security-policy'] || '';
        const protected_ = xfo.toUpperCase().includes('DENY') || xfo.toUpperCase().includes('SAMEORIGIN') ||
          csp.includes("frame-ancestors");

        return {
          severity: protected_ ? 'info' : 'medium',
          description: protected_
            ? 'Clickjacking protection is enabled'
            : 'No clickjacking protection detected',
          details: [
            `X-Frame-Options: ${xfo || 'Not set [FAIL]'}`,
            `CSP frame-ancestors: ${csp.includes('frame-ancestors') ? 'Present [OK]' : 'Not set [FAIL]'}`,
          ].join('\n'),
          recommendation: protected_ ? 'Good.' : 'Add X-Frame-Options: DENY or CSP frame-ancestors directive.',
        };
      }
    );
    if (clickjackingCheck) allResults.push(clickjackingCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 5: Cookie Security
    const cookieCheck = await runCheck(
      'cookies', 'Cookie Security', 'Transport',
      async (targetUrl) => {
        const raw = await execCmd(`curl -s -I -L --max-time 8 "${targetUrl}"`, 12000);
        const lines = raw.split('\n');
        const cookies = lines
          .filter(l => l.toLowerCase().startsWith('set-cookie:'))
          .map(l => l.replace(/^set-cookie:\s*/i, ''));

        if (cookies.length === 0) {
          return {
            severity: 'info',
            description: 'No cookies set',
            details: 'No Set-Cookie headers detected.',
            recommendation: 'N/A',
          };
        }

        const issues: string[] = [];
        cookies.forEach((c, i) => {
          const name = c.split('=')[0] || `Cookie ${i + 1}`;
          if (!c.toLowerCase().includes('httponly')) issues.push(`${name}: Missing HttpOnly`);
          if (!c.toLowerCase().includes('secure')) issues.push(`${name}: Missing Secure`);
          if (!c.toLowerCase().includes('samesite')) issues.push(`${name}: Missing SameSite`);
        });

        const uniqueIssues = [...new Set(issues)];

        return {
          severity: uniqueIssues.length >= 2 ? 'medium' : uniqueIssues.length === 1 ? 'low' : 'info',
          description: `${cookies.length} cookie(s) found, ${uniqueIssues.length} issue(s)`,
          details: [
            `Cookies found: ${cookies.length}`,
            ...cookies.map((c, i) => `  ${c.substring(0, 80)}${c.length > 80 ? '...' : ''}`),
            '',
            ...uniqueIssues.map(i => `[FAIL] ${i}`),
            ...(uniqueIssues.length === 0 ? ['[OK] All cookies properly configured'] : []),
          ].join('\n'),
          recommendation: uniqueIssues.length > 0
            ? 'Set HttpOnly, Secure, and SameSite flags on all cookies.'
            : 'Good.',
        };
      }
    );
    if (cookieCheck) allResults.push(cookieCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 6: Sensitive Paths
    const traversalCheck = await runCheck(
      'traversal', 'Sensitive Path Exposure', 'Web',
      async (targetUrl) => {
        const paths = ['/', '/admin/', '/backup/', '/.git/', '/.git/HEAD', '/.git/config', '/.env', '/robots.txt', '/sitemap.xml', '/.htaccess', '/wp-admin/', '/wp-config.php.bak', '/phpinfo.php', '/phpinfo', '/info.php', '/test.php', '/.DS_Store', '/server-status', '/server-info', '/.svn/wc.db', '/composer.json', '/package.json', '/.gitlab-ci.yml', '/Dockerfile', '/docker-compose.yml', '/.dockerenv', '/web.config', '/web.config.bak', '/.bash_history', '/id_rsa', '/id_rsa.pub'];
        const found: { path: string; status: number }[] = [];

        for (const path of paths) {
          if (stopRef.current || abortRef.current?.signal.aborted) break;
          try {
            const statusOutput = await execCmd(
              `curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${new URL(path, targetUrl).toString()}"`,
              8000
            );
            const status = parseInt(statusOutput.trim());
            if (status === 200 || status === 301 || status === 302 || status === 403) {
              found.push({ path, status });
            }
          } catch {}
        }

        const criticalPaths = found.filter(f => ['.env', '/.git/', '/backup/', '/wp-config.php.bak', '/.DS_Store', 'id_rsa', '.bash_history', 'web.config', 'docker-compose', 'Dockerfile', '.dockerenv', 'composer.json', 'package.json', '.gitlab-ci', '.svn/'].some(p => f.path.includes(p)));
        const severity = criticalPaths.length > 0 ? 'high' : found.length >= 3 ? 'medium' : found.length >= 1 ? 'low' : 'info';

        return {
          severity,
          description: `${found.length} sensitive path(s) accessible`,
          details: found.length > 0
            ? found.map(f => `${f.status === 403 ? '[LOCKED]' : '[OPEN]'} ${f.path} [${f.status}]`).join('\n')
            : 'No sensitive paths found accessible.',
          recommendation: found.length > 0
            ? 'Restrict access to sensitive directories. Block .git, .env, backup files.'
            : 'Good.',
        };
      }
    );
    if (traversalCheck) allResults.push(traversalCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 7: DNS Security (via IPC)
    const dnsCheck = await runCheck(
      'dns-security', 'DNS Security', 'DNS',
      async (targetUrl) => {
        const domain = new URL(targetUrl).hostname;
        const checks: string[] = [];

        if (window.electronAPI?.dnsResolve) {
          // DMARC
          try {
            const dmarc = await window.electronAPI.dnsResolve(`_dmarc.${domain}`, 'TXT');
            if (!dmarc.error && dmarc.records?.length > 0) {
              const policy = dmarc.records[0]?.match?.(/p=(\w+)/)?.[1] || 'unknown';
              checks.push(`[OK] DMARC found (policy: ${policy})`);
            } else {
              checks.push('[FAIL] No DMARC record');
            }
          } catch { checks.push('[WARN] Could not check DMARC'); }

          // SPF
          try {
            const txt = await window.electronAPI.dnsResolve(domain, 'TXT');
            if (!txt.error && txt.records?.length > 0) {
              const spf = txt.records.find((r: string) => r.includes('v=spf1'));
              checks.push(spf ? `[OK] SPF found: ${spf.substring(0, 60)}` : '[FAIL] No SPF record');
            } else {
              checks.push('[FAIL] No SPF record');
            }
          } catch { checks.push('[WARN] Could not check SPF'); }

          // DNSSEC
          try {
            const dnskey = await window.electronAPI.dnsResolve(domain, 'DNSKEY');
            checks.push((!dnskey.error && dnskey.records?.length > 0) ? '[OK] DNSSEC enabled' : '[FAIL] DNSSEC not enabled');
          } catch { checks.push('[WARN] Could not check DNSSEC'); }

          // CAA
          try {
            const caa = await window.electronAPI.dnsResolve(domain, 'CAA');
            checks.push((!caa.error && caa.records?.length > 0) ? `[OK] CAA record found` : '[FAIL] No CAA record');
          } catch {}
        }

        const issues = checks.filter(c => c.startsWith('[FAIL]'));
        return {
          severity: issues.length >= 2 ? 'medium' : issues.length === 1 ? 'low' : 'info',
          description: `${checks.length} DNS security checks, ${issues.length} issue(s)`,
          details: checks.join('\n'),
          recommendation: issues.length > 0
            ? 'Configure missing DNS security records (DMARC, SPF, DNSSEC, CAA).'
            : 'DNS security is well configured.',
        };
      }
    );
    if (dnsCheck) allResults.push(dnsCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 8: CORS Configuration
    const corsCheck = await runCheck(
      'cors', 'CORS Configuration', 'Headers',
      async (targetUrl) => {
        const raw = await execCmd(
          `curl -s -I -H "Origin: https://evil.com" --max-time 8 "${targetUrl}"`,
          12000
        );
        const headers = parseHeaders(raw);
        const acao = headers['access-control-allow-origin'] || '';
        const acac = headers['access-control-allow-credentials'] || '';

        const isWildcard = acao === '*';
        const reflectsOrigin = acao === 'https://evil.com';
        const dangerous = reflectsOrigin && acac.toLowerCase() === 'true';

        const severity = dangerous ? 'high' : isWildcard ? 'medium' : reflectsOrigin ? 'low' : 'info';

        return {
          severity,
          description: dangerous
            ? 'CORS reflects arbitrary origin with credentials'
            : isWildcard
            ? 'CORS allows all origins (*)'
            : reflectsOrigin
            ? 'CORS reflects origin (check if intentional)'
            : 'CORS appears properly configured',
          details: [
            `Access-Control-Allow-Origin: ${acao || 'Not set [OK]'}`,
            `Access-Control-Allow-Credentials: ${acac || 'Not set'}`,
            dangerous ? '[WARN] DANGEROUS: Arbitrary origin + credentials = account takeover risk' : '',
          ].filter(Boolean).join('\n'),
          recommendation: dangerous
            ? 'Restrict CORS to specific trusted origins. Never reflect arbitrary origins with credentials.'
            : isWildcard
            ? 'Replace * with specific allowed origins.'
            : 'Good.',
        };
      }
    );
    if (corsCheck) allResults.push(corsCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 9: SSL Certificate (via openssl)
    const sslCheck = await runCheck(
      'ssl', 'SSL/TLS Certificate', 'Transport',
      async (targetUrl) => {
        const domain = new URL(targetUrl).hostname;
        try {
          const cert = await execCmd(
            `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates -checkend 2592000 2>/dev/null`,
            10000
          );

          const expiresSoon = cert.includes('Certificate will expire');
          const notAfter = cert.match(/notAfter=(.+)/)?.[1] || '';
          const notBefore = cert.match(/notBefore=(.+)/)?.[1] || '';

          const severity = expiresSoon ? 'high' : 'info';

          return {
            severity,
            description: expiresSoon ? 'SSL certificate expires within 30 days' : 'SSL certificate is valid',
            details: [
              `Valid From: ${notBefore || 'Unknown'}`,
              `Valid Until: ${notAfter || 'Unknown'}`,
              expiresSoon ? '[WARN] Certificate expires within 30 days!' : '[OK] Certificate is valid',
            ].join('\n'),
            recommendation: expiresSoon ? 'Renew the SSL certificate immediately.' : 'Good.',
          };
        } catch {
          return {
            severity: 'info',
            description: 'Could not check SSL certificate',
            details: 'SSL certificate check failed or port 443 is not open.',
            recommendation: 'N/A',
          };
        }
      }
    );
    if (sslCheck) allResults.push(sslCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 10: Common Vulnerabilities (info disclosure, debug endpoints)
    const vulnCheck = await runCheck(
      'vulns', 'Common Vulnerabilities', 'Web',
      async (targetUrl) => {
        const checks: string[] = [];

        // Check for debug endpoints
        const debugPaths = ['/_debug/', '/debug/', '/trace', '/actuator', '/actuator/health', '/actuator/env', '/actuator/beans', '/actuator/mappings', '/swagger-ui.html', '/swagger-ui/', '/swagger/v1/swagger.json', '/api/swagger.json', '/v2/api-docs', '/v3/api-docs', '/api-docs', '/graphql', '/graphiql', '/metrics'];
        for (const path of debugPaths) {
          if (stopRef.current || abortRef.current?.signal.aborted) break;
          try {
            const status = await execCmd(
              `curl -s -o /dev/null -w "%{http_code}" --max-time 3 "${new URL(path, targetUrl).toString()}"`,
              5000
            );
            if (status.trim() === '200') {
              checks.push(`[WARN] Debug endpoint accessible: ${path}`);
            }
          } catch {}
        }

        // Check for version disclosure
        try {
          const raw = await execCmd(`curl -s -I --max-time 5 "${targetUrl}"`, 8000);
          const headers = parseHeaders(raw);
          const powered = headers['x-powered-by'] || '';
          const server = headers['server'] || '';

          if (powered) checks.push(`[INFO] X-Powered-By disclosed: ${powered}`);
          if (server && /\d/.test(server)) checks.push(`[INFO] Server version disclosed: ${server}`);
        } catch {}

        if (checks.length === 0) checks.push('[OK] No common vulnerabilities detected');

        const issues = checks.filter(c => c.startsWith('[WARN]'));
        const severity = issues.length >= 2 ? 'medium' : issues.length === 1 ? 'low' : 'info';

        return {
          severity,
          description: `${checks.length} vulnerability check(s) performed`,
          details: checks.join('\n'),
          recommendation: issues.length > 0
            ? 'Disable debug endpoints and remove version information.'
            : 'Good.',
        };
      }
    );
    if (vulnCheck) allResults.push(vulnCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 11: CVE Match (keyless, local DB)
    const cveCheck = await runCheck(
      'cve-match', 'CVE Match', 'Vulns',
      async (targetUrl) => {
        const raw = await execCmd(`curl -s -I -L --max-time 8 "${targetUrl}"`, 12000);
        const headers = parseHeaders(raw);
        let body = '';
        try {
          const html = await execCmd(`curl -s -L --max-time 8 "${targetUrl}"`, 12000);
          body = html.slice(0, 15000);
        } catch {}
        const technologies = detectTechnologies(headers, body);
        const versioned = technologies.filter(t => t.version);
        const techSummary = technologies.length > 0
          ? technologies.map(t => `${t.name}${t.version ? `@${t.version}` : ''}`).join(', ')
          : 'none detected';

        if (versioned.length === 0) {
          return {
            severity: 'info',
            description: 'Software versions not disclosed — CVE matching skipped',
            details: [
              `Detected: ${techSummary}`,
              'Note: versions not disclosed, cannot match CVEs without guessing.',
            ].join('\n'),
            recommendation: 'N/A',
          };
        }

        const matches = matchCveByTechnologies(versioned);
        if (matches.length === 0) {
          return {
            severity: 'info',
            description: `No known CVEs for ${versioned.map(t => `${t.name}@${t.version}`).join(', ')}`,
            details: `Detected: ${techSummary}\nNo entries in local CVE DB matched.`,
            recommendation: 'Good.',
          };
        }

        const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        const sorted = [...matches].sort((a, b) => (order[a.cve.severity] ?? 5) - (order[b.cve.severity] ?? 5));
        const top = sorted[0].cve.severity as ScanResult['severity'];
        return {
          severity: top,
          description: `${matches.length} known CVE(s) matched`,
          details: [
            `Detected: ${techSummary}`,
            '',
            ...sorted.map(m => `[${m.cve.severity.toUpperCase()}] ${m.cve.id} (CVSS ${m.cve.cvssScore}) — ${m.cve.affectedSoftware}@${m.matchedVersion}\n  ${m.cve.description}\n  Fix: ${m.cve.remediation}`),
          ].join('\n'),
          recommendation: `Update affected software: ${[...new Set(sorted.map(m => m.cve.affectedSoftware))].join(', ')}.`,
        };
      }
    );
    if (cveCheck) allResults.push(cveCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 12: Injection Hunt
    const injectionCheck = await runCheck(
      'injection-hunt', 'Injection Hunt', 'Injection',
      async (targetUrl) => {
        if (!window.electronAPI?.execCommand) {
          return {
            severity: 'info' as const,
            description: 'Injection checks skipped (no native IPC)',
            details: 'Electron IPC is not available, injection checks were not executed.',
            recommendation: 'N/A',
          };
        }
        const exec = (cmd: string, t?: number) => window.electronAPI!.execCommand(cmd, t).then(r => r.stdout);
        const findings = await runInjectionChecks(exec, targetUrl, isStopped);
        if (findings.length === 0) {
          return {
            severity: 'info' as const,
            description: 'No injection findings',
            details: 'Injection detectors reported no findings.',
            recommendation: 'N/A',
          };
        }
        const sorted = [...findings].sort((a, b) => (severityRank[a.severity] ?? 5) - (severityRank[b.severity] ?? 5));
        const top = sorted[0] as (typeof sorted)[number];
        return {
          severity: top.severity,
          description: `${findings.length} finding(s), top: [${top.severity.toUpperCase()}] ${top.name}`,
          details: sorted.map(f =>
            `[${f.severity.toUpperCase()}] ${f.name}\n${f.description}${f.result ? `\n${f.result}` : ''}`
          ).join('\n\n'),
          recommendation: top.severity === 'info'
            ? 'Good.'
            : 'Review the injection findings and fix affected parameters (validate/sanitize input, use parameterized queries, encode output).',
        };
      }
    );
    if (injectionCheck) allResults.push(injectionCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 13: Misc Hunt
    const miscCheck = await runCheck(
      'misc-hunt', 'Misc Hunt', 'Web',
      async (targetUrl) => {
        if (!window.electronAPI?.execCommand) {
          return {
            severity: 'info' as const,
            description: 'Misc checks skipped (no native IPC)',
            details: 'Electron IPC is not available, misc checks were not executed.',
            recommendation: 'N/A',
          };
        }
        const exec = (cmd: string, t?: number) => window.electronAPI!.execCommand(cmd, t).then(r => r.stdout);
        const findings = await runMiscChecks(exec, targetUrl, isStopped);
        if (findings.length === 0) {
          return {
            severity: 'info' as const,
            description: 'No misc findings',
            details: 'Misc detectors reported no findings.',
            recommendation: 'N/A',
          };
        }
        const sorted = [...findings].sort((a, b) => (severityRank[a.severity] ?? 5) - (severityRank[b.severity] ?? 5));
        const top = sorted[0] as (typeof sorted)[number];
        return {
          severity: top.severity,
          description: `${findings.length} finding(s), top: [${top.severity.toUpperCase()}] ${top.name}`,
          details: sorted.map(f =>
            `[${f.severity.toUpperCase()}] ${f.name}\n${f.description}${f.result ? `\n${f.result}` : ''}`
          ).join('\n\n'),
          recommendation: top.severity === 'info'
            ? 'Good.'
            : 'Review the misc findings and remediate the reported misconfigurations.',
        };
      }
    );
    if (miscCheck) allResults.push(miscCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    // Check 14: Recon Extra (WAF + JS secrets)
    const reconExtraCheck = await runCheck(
      'recon-extra', 'Recon Extra', 'Recon',
      async (targetUrl) => {
        if (!window.electronAPI?.execCommand) {
          return {
            severity: 'info' as const,
            description: 'Recon Extra skipped (no native IPC)',
            details: 'Electron IPC is not available, recon extra checks were not executed.',
            recommendation: 'N/A',
          };
        }
        const exec = (cmd: string, t?: number) => window.electronAPI!.execCommand(cmd, t).then(r => r.stdout);
        const findings = await runReconExtra(exec, targetUrl, isStopped);
        if (findings.length === 0) {
          return {
            severity: 'info' as const,
            description: 'No recon findings',
            details: 'Recon extra detectors reported no findings.',
            recommendation: 'N/A',
          };
        }
        const sorted = [...findings].sort((a, b) => (severityRank[a.severity] ?? 5) - (severityRank[b.severity] ?? 5));
        const top = sorted[0] as (typeof sorted)[number];
        return {
          severity: top.severity,
          description: `${findings.length} finding(s), top: [${top.severity.toUpperCase()}] ${top.name}`,
          details: sorted.map(f =>
            `[${f.severity.toUpperCase()}] ${f.name}\n${f.description}${f.result ? `\n${f.result}` : ''}`
          ).join('\n\n'),
          recommendation: top.severity === 'info'
            ? 'Good.'
            : 'Remove exposed secrets from JavaScript bundles and restrict sensitive endpoints.',
        };
      }
    );
    if (reconExtraCheck) allResults.push(reconExtraCheck);
    setResults([...allResults]);
    updateProgress();
    if (isStopped()) { setCurrentCheck('Остановлено'); setScanning(false); setProgress(0); return; }

    setCurrentCheck('');
    setScanning(false);
  }, [target]);

  const severityCounts = results.reduce((acc, r) => {
    acc[r.severity] = (acc[r.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const copyReport = async () => {
    const report = results.map(r => `[${r.severity.toUpperCase()}] ${r.name}\n${r.description}\n${r.details}\n→ ${r.recommendation}\n`).join('\n---\n\n');
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const exportHTML = () => {
    if (results.length === 0) return;
    downloadBlob(buildStandaloneHtml(target, results), exportFileName(target, 'html'), 'text/html;charset=utf-8');
  };

  const exportMD = () => {
    if (results.length === 0) return;
    downloadBlob(buildMarkdownReport(target, results), exportFileName(target, 'md'), 'text/markdown;charset=utf-8');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full gap-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Shield className="text-pulse-accent" size={22} />
            Vulnerability Scanner
          </h1>
          <p className="text-xs text-pulse-muted mt-1">14-point web security assessment via native IPC</p>
        </div>
        <div className="flex items-center gap-2">
        {results.length > 0 && (
          <button
            onClick={copyReport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel transition-all"
          >
            {copied ? <Check size={12} className="text-pulse-green" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy Report'}
          </button>
        )}
          <button
            onClick={exportHTML}
            disabled={results.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <Download size={12} />
            Export HTML
          </button>
          <button
            onClick={exportMD}
            disabled={results.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <Download size={12} />
            Export MD
          </button>
        </div>
      </div>

      {/* Target Input */}
      <div className="bg-pulse-surface border border-pulse-border rounded-xl p-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted" />
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !scanning && handleScan()}
              placeholder="Enter target URL (e.g. https://example.com)..."
              className="w-full pl-10 pr-4 py-3 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
            />
          </div>
          {scanning ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-3 px-4 py-3 bg-pulse-panel border border-pulse-border rounded-xl text-xs font-mono text-pulse-yellow">
                <div className="w-3 h-3 rounded-full border-2 border-pulse-yellow border-t-transparent animate-spin" />
                {currentCheck}
              </div>
              <button
                onClick={handleStop}
                className="flex items-center gap-2 px-6 py-3 bg-pulse-red/15 text-pulse-red border border-pulse-red/25 font-semibold rounded-xl hover:bg-pulse-red/20 active:scale-[0.98] transition-all text-sm"
              >
                Stop
              </button>
            </div>
          ) : (
            <button
              onClick={handleScan}
              disabled={!target.trim()}
              className="flex items-center gap-2 px-6 py-3 bg-pulse-accent text-pulse-bg font-semibold rounded-xl hover:bg-pulse-accentSoft active:scale-[0.98] transition-all text-sm disabled:opacity-40"
            >
              <Play size={14} />
              Scan
            </button>
          )}
        </div>

        {/* Progress */}
        {scanning && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-pulse-muted mb-1">
              <span>{currentCheck}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-1 bg-pulse-panel rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pulse-accentDim via-pulse-accent to-pulse-accentSoft rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Summary */}
      {results.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {['critical', 'high', 'medium', 'low', 'info'].map((sev) => (
            <div
              key={sev}
              className={`flex items-center gap-2 p-2.5 rounded-xl border ${severityColors[sev]}`}
            >
              {severityIcons[sev]}
              <div>
                <div className="text-lg font-bold font-mono tabular-nums">{severityCounts[sev] || 0}</div>
                <div className="text-[10px] capitalize tracking-wider text-pulse-textMuted">{sev}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto space-y-2">
        {results.map((result) => {
          const isExpanded = expandedResults[result.id] !== false;
          return (
            <motion.div
              key={result.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-pulse-surface border rounded-xl overflow-hidden ${
                severityColors[result.severity].split(' ').slice(1).join(' ')
              }`}
            >
              <button
                onClick={() => toggleResult(result.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-pulse-panel/20 transition-colors text-left"
              >
                <span className={severityColors[result.severity].split(' ')[0]}>
                  {severityIcons[result.severity]}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{result.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${severityColors[result.severity].split(' ')[0]}`}>
                      {result.severity}
                    </span>
                    <span className="text-[9px] text-pulse-muted">{result.category}</span>
                  </div>
                  <div className="text-[11px] text-pulse-muted mt-0.5">{result.description}</div>
                </div>
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-3 space-y-2 border-t border-pulse-border/20 pt-2">
                      <pre className="text-[11px] font-mono text-pulse-text whitespace-pre-wrap bg-pulse-bg/50 rounded-lg p-3">
                        {result.details}
                      </pre>
                      {result.recommendation && result.recommendation !== 'Good.' && result.recommendation !== 'N/A' && (
                        <div className="flex items-start gap-2 p-2.5 bg-pulse-yellow/10 border border-pulse-yellow/25 rounded-xl">
                          <FileWarning size={12} className="text-pulse-yellow mt-0.5 flex-shrink-0" />
                          <span className="text-[11px] text-pulse-yellow">{result.recommendation}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Empty State */}
      {results.length === 0 && !scanning && (
        <div className="flex-1 flex flex-col items-center justify-center text-pulse-muted">
          <div className="w-20 h-20 rounded-2xl bg-pulse-panel border border-pulse-border flex items-center justify-center mb-4">
            <Shield size={32} className="text-pulse-muted opacity-40" />
          </div>
          <div className="text-sm font-medium">Enter a target to scan</div>
          <div className="text-xs mt-1 opacity-60">
            14 checks: Headers, HTTPS, Cookies, DNS, CORS, SSL, Paths, Vulns, CVE, Injection, Misc, Recon
          </div>
          <div className="flex items-center gap-1.5 mt-3 text-[10px] text-pulse-muted/40">
            <Info size={10} />
            <span>Uses native IPC — no CORS restrictions</span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
