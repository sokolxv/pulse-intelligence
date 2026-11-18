export interface MiscFinding {
  id: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  result?: string;
}

export type ExecFn = (cmd: string, timeoutMs?: number) => Promise<string>;

interface ParsedHttp {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface CredPair {
  username: string;
  password: string;
}

const TOP8_CREDS: CredPair[] = [
  { username: 'admin', password: 'admin' },
  { username: 'admin', password: 'password' },
  { username: 'admin', password: '12345' },
  { username: 'admin', password: '123456' },
  { username: 'admin', password: '12345678' },
  { username: 'admin', password: 'admin123' },
  { username: 'admin', password: 'root' },
  { username: 'admin', password: 'toor' },
];

const LOGIN_PATHS = ['/login', '/admin', '/admin/login', '/signin'];

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

function q(raw: string): string {
  return `"${raw.replace(/["$`\\!]/g, '')}"`;
}

function snippet(s: string, n: number): string {
  return s.replace(/\s+/g, ' ').slice(0, n);
}

function parseHttp(out: string): ParsedHttp {
  const res: ParsedHttp = { status: 0, headers: {}, body: '' };
  if (!out) return res;
  const norm = out.replace(/\r\n/g, '\n');
  const m = norm.match(/^HTTP\/[\d.]+\s+(\d{3})/m);
  if (m && m[1]) res.status = parseInt(m[1], 10);
  const sep = norm.indexOf('\n\n');
  const head = sep >= 0 ? norm.slice(0, sep) : norm;
  res.body = sep >= 0 ? norm.slice(sep + 2) : '';
  const lines = head.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] as string;
    const ci = line.indexOf(':');
    if (ci > 0) {
      const k = line.slice(0, ci).trim().toLowerCase();
      const v = line.slice(ci + 1).trim();
      if (k && !(k in res.headers)) res.headers[k] = v;
    }
  }
  return res;
}

function b64urlToText(s: string): string {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4;
  if (pad) b += '='.repeat(4 - pad);
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function collectLocalJwtTokens(targetUrl: string): string[] {
  const found = new Set<string>();
  const grab = (s: string | null | undefined) => {
    if (!s) return;
    try {
      const m = s.match(JWT_RE);
      if (m) for (const t of m) found.add(t);
    } catch {
      return;
    }
  };
  try {
    grab(targetUrl);
  } catch {
    return [...found];
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      grab(localStorage.getItem(k));
      if (found.size >= 10) break;
    }
  } catch {
    return [...found];
  }
  return [...found];
}

function resolveAction(origin: string, pagePath: string, action: string): string {
  if (/^https?:\/\//i.test(action)) return action;
  if (action.startsWith('/')) return origin + action;
  const dir = pagePath.includes('/') ? pagePath.slice(0, pagePath.lastIndexOf('/') + 1) : '/';
  return origin + dir + action;
}

export async function runMiscChecks(
  exec: ExecFn,
  targetUrl: string,
  isCancelled: () => boolean,
): Promise<MiscFinding[]> {
  const findings: MiscFinding[] = [];
  let n = 0;
  const mk = (
    name: MiscFinding['name'],
    severity: MiscFinding['severity'],
    description: string,
    result?: string,
  ): MiscFinding => {
    n += 1;
    const f: MiscFinding = { id: `misc-${n}`, name, severity, description };
    if (result !== undefined) f.result = result;
    return f;
  };

  let u: URL;
  try {
    u = new URL(targetUrl.trim());
  } catch (e) {
    return [
      mk(
        'Misc checks aborted: invalid URL',
        'info',
        'Target URL could not be parsed, misc checks were not executed.',
        snippet(String(e), 200),
      ),
    ];
  }

  const target = targetUrl.trim();
  const noHash = target.split('#')[0] as string;
  const origin = u.origin;

  const run = async (cmd: string, t?: number): Promise<string> => {
    try {
      return await exec(cmd, t);
    } catch {
      return '';
    }
  };

  const checkCors = async (): Promise<void> => {
    const out = await run(`curl -sS -i --max-time 8 -H "Origin: https://evil.com" ${q(noHash)}`, 10000);
    if (!out) return;
    const r = parseHttp(out);
    const acao = r.headers['access-control-allow-origin'] || '';
    const acac = (r.headers['access-control-allow-credentials'] || '').toLowerCase();
    const ev = `Access-Control-Allow-Origin: ${acao || '(absent)'} / Access-Control-Allow-Credentials: ${r.headers['access-control-allow-credentials'] || '(absent)'}`;
    if (acao.includes('evil.com') && acac === 'true') {
      findings.push(
        mk(
          'CORS misconfiguration (reflective origin + credentials)',
          'high',
          'Server reflects arbitrary Origin with Access-Control-Allow-Credentials: true, any site can read authenticated responses.',
          snippet(ev, 300),
        ),
      );
    } else if (acao.includes('evil.com')) {
      findings.push(
        mk(
          'CORS reflective origin',
          'medium',
          'Server reflects arbitrary Origin in Access-Control-Allow-Origin, allowing cross-origin reads from any site.',
          snippet(ev, 300),
        ),
      );
    } else if (acao.trim() === '*') {
      findings.push(
        mk(
          'CORS wildcard origin',
          'medium',
          'Server responds with Access-Control-Allow-Origin: *, allowing any website to make cross-origin requests.',
          snippet(ev, 300),
        ),
      );
    }
  };

  const checkHostHeader = async (): Promise<void> => {
    const outs = [
      await run(`curl -sS -i --max-time 8 -H "Host: evil.com" ${q(noHash)}`, 10000),
      await run(`curl -sS -i --max-time 8 -H "X-Forwarded-Host: evil.com" ${q(noHash)}`, 10000),
    ];
    for (let i = 0; i < outs.length; i++) {
      const out = outs[i] as string;
      if (!out) continue;
      const r = parseHttp(out);
      const loc = r.headers['location'] || '';
      const headerName = i === 0 ? 'Host' : 'X-Forwarded-Host';
      if (r.body.includes('evil.com') || loc.includes('evil.com')) {
        findings.push(
          mk(
            'Host header injection',
            'medium',
            `Header "${headerName}: evil.com" is reflected in the response, possible cache poisoning, password-reset poisoning or open redirect.`,
            snippet(loc.includes('evil.com') ? `Location: ${loc}` : r.body.slice(r.body.indexOf('evil.com') > 40 ? r.body.indexOf('evil.com') - 40 : 0, r.body.indexOf('evil.com') + 80), 300),
          ),
        );
        return;
      }
    }
  };

  const checkCrlf = async (): Promise<void> => {
    const sep = noHash.includes('?') ? '&' : '?';
    const urls = [noHash + sep + 'x=test%0d%0aX-Test:1'];
    const keys = [...u.searchParams.keys()];
    if (keys.length > 0) {
      urls.push(noHash + (noHash.includes('?') ? '&' : '?') + encodeURIComponent(keys[0] as string) + '=test%0d%0aX-Test:1');
    }
    for (const testUrl of urls.slice(0, 2)) {
      const out = await run(`curl -sS -i --max-time 8 ${q(testUrl)}`, 10000);
      if (!out) continue;
      const r = parseHttp(out);
      const xt = r.headers['x-test'] || '';
      if (xt.includes('1') || /X-Test:\s*1/i.test(r.body)) {
        findings.push(
          mk(
            'CRLF injection (HTTP response splitting)',
            'medium',
            'Injected CRLF payload produced an "X-Test: 1" header or reflection, user input can split the HTTP response.',
            snippet(`URL: ${testUrl} / X-Test: ${xt || 'reflected in body'}`, 300),
          ),
        );
        return;
      }
    }
  };

  const checkJwt = async (): Promise<void> => {
    const tokens = collectLocalJwtTokens(target).slice(0, 5);
    if (tokens.length === 0) {
      findings.push(
        mk(
          'JWT check skipped',
          'info',
          'No JWT tokens found in localStorage or the target URL, nothing to analyze locally.',
        ),
      );
      return;
    }
    let clean = 0;
    for (const token of tokens) {
      const parts = token.split('.');
      if (parts.length !== 3) continue;
      let header: Record<string, unknown>;
      let payload: Record<string, unknown>;
      try {
        header = JSON.parse(b64urlToText(parts[0] as string)) as Record<string, unknown>;
        payload = JSON.parse(b64urlToText(parts[1] as string)) as Record<string, unknown>;
      } catch {
        continue;
      }
      const alg = String(header['alg'] || '');
      if (alg.toLowerCase() === 'none') {
        findings.push(
          mk(
            'JWT algorithm confusion (alg: none)',
            'critical',
            'A locally stored token uses the "none" algorithm, it can be forged without any signing key.',
            snippet(`alg=${alg} payload=${JSON.stringify(payload).slice(0, 200)}`, 300),
          ),
          );
        continue;
      }
      if (payload['exp'] === undefined || payload['exp'] === null) {
        findings.push(
          mk(
            'JWT without expiration (exp)',
            'low',
            'A locally stored token has no exp claim and may stay valid indefinitely if accepted by the server.',
            snippet(`alg=${alg || '(absent)'} payload=${JSON.stringify(payload).slice(0, 200)}`, 300),
          ),
        );
        continue;
      }
      clean += 1;
    }
    if (clean > 0 && findings.length === 0) {
      findings.push(
        mk(
          'JWT local analysis',
          'info',
          `Analyzed ${clean} locally stored token(s), no alg:none or missing-exp issues found. Tokens were never sent anywhere.`,
        ),
      );
    }
  };

  const checkLog4j = async (): Promise<void> => {
    const keys = [...u.searchParams.keys()];
    if (keys.length === 0) {
      findings.push(
        mk(
          'Log4Shell probe skipped',
          'info',
          'Target URL has no query parameters, the single harmless probe was not sent.',
        ),
      );
      return;
    }
    const marker = encodeURIComponent('${jndi:}');
    const testUrl = noHash + (noHash.includes('?') ? '&' : '?') + encodeURIComponent(keys[0] as string) + '=' + marker;
    const out = await run(`curl -sS -i --max-time 8 ${q(testUrl)}`, 10000);
    if (!out) return;
    const r = parseHttp(out);
    const hasJndiSignal = /jndi|log4j|javax\.naming|lookup/i.test(r.body);
    const hasError = r.status === 500 || /error|exception|stack\s*trace/i.test(r.body);
    if (hasJndiSignal && hasError) {
      findings.push(
        mk(
          'Possible Log4Shell error reflection (verify manually)',
          'medium',
          'A single harmless marker was reflected together with a server error, the endpoint may log attacker-controlled input. Confirm manually before any further testing.',
          snippet(`HTTP ${r.status} / param=${keys[0]}`, 300),
        ),
      );
    } else {
      findings.push(
        mk(
          'Log4Shell probe negative',
          'info',
          'A single harmless marker caused no JNDI error reflection, no further Log4Shell requests were sent.',
        ),
      );
    }
  };

  const checkGraphql = async (): Promise<void> => {
    const probeUrl = origin + '/graphql?query=%7B__typename%7D';
    const g1 = await run(`curl -sS -i --max-time 8 ${q(probeUrl)}`, 10000);
    if (!g1) return;
    const r1 = parseHttp(g1);
    const endpointFound = r1.status === 200 && r1.body.includes('__typename');
    if (!endpointFound) return;
    const g2 = await run(
      `curl -sS -i --max-time 8 -H "Content-Type: application/json" --data '{"query":"{__schema{queryType{name}}}"}' ${q(origin + '/graphql')}`,
      10000,
    );
    const r2 = parseHttp(g2);
    if (r2.status === 200 && r2.body.includes('__schema')) {
      findings.push(
        mk(
          'GraphQL introspection enabled',
          'high',
          'GraphQL endpoint answers introspection queries, attackers can dump the full schema to find sensitive operations.',
          snippet(`Endpoint: ${origin}/graphql`, 300),
        ),
      );
    } else {
      findings.push(
        mk(
          'GraphQL endpoint found',
          'info',
          'GraphQL endpoint responds but introspection was not confirmed with the small probe query.',
          snippet(`Endpoint: ${origin}/graphql HTTP ${r1.status}`, 300),
        ),
      );
    }
  };

  const checkTls = async (): Promise<void> => {
    if (u.protocol !== 'https:') {
      findings.push(mk('TLS check skipped', 'info', 'Target is not HTTPS, no TLS handshake to analyze.'));
      return;
    }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!/^[A-Za-z0-9.\-:]+$/.test(host) || host.length === 0) {
      findings.push(mk('TLS check skipped', 'info', 'Hostname is not safe to pass to openssl, check skipped.'));
      return;
    }
    const port = u.port ? parseInt(u.port, 10) : 443;
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      findings.push(mk('TLS check skipped', 'info', 'Target port is invalid, check skipped.'));
      return;
    }
    const out = await run(
      `echo . | openssl s_client -connect ${q(host + ':' + String(port))} -servername ${q(host)}`,
      15000,
    );
    if (!out) return;
    const protoM = out.match(/^ *Protocol\s*:\s*(.+?)\s*$/im);
    const cipherM = out.match(/^ *Cipher\s*:\s*(.+?)\s*$/im);
    const afterM = out.match(/^ *Not After\s*:\s*(.+?)\s*$/im);
    if (!protoM && !cipherM && !afterM) {
      findings.push(mk('TLS check inconclusive', 'info', 'openssl returned no Protocol/Cipher/certificate data.'));
      return;
    }
    const proto = protoM && protoM[1] ? protoM[1].trim() : '';
    const cipher = cipherM && cipherM[1] ? cipherM[1].trim() : '';
    if (/(SSLv2|SSLv3|TLSv1(?:\.0|\.1)?)(?![\d.])/i.test(proto)) {
      findings.push(
        mk(
          `Deprecated TLS protocol (${proto || 'unknown'})`,
          'high',
          `Server negotiates ${proto || 'a deprecated protocol version'}, connections can potentially be downgraded.`,
          snippet(`Protocol: ${proto} / Cipher: ${cipher || '(unknown)'}`, 300),
        ),
      );
    }
    if (/DES|RC4|EXPORT/i.test(cipher)) {
      findings.push(
        mk(
          `Weak TLS cipher (${cipher})`,
          'high',
          `Server negotiates weak cipher ${cipher}, traffic may be decryptable.`,
          snippet(`Protocol: ${proto || '(unknown)'} / Cipher: ${cipher}`, 300),
        ),
      );
    }
    if (afterM && afterM[1]) {
      const ms = Date.parse(afterM[1].trim());
      if (!Number.isNaN(ms)) {
        const days = (ms - Date.now()) / 86400000;
        if (days < 0) {
          findings.push(
            mk(
              'Expired TLS certificate',
              'medium',
              `TLS certificate expired on ${(afterM[1] || '').trim()}, TLS validation is broken.`,
              snippet(`Not After: ${(afterM[1] || '').trim()}`, 200),
            ),
          );
        } else if (days < 30) {
          findings.push(
            mk(
              'TLS certificate expiring soon',
              'medium',
              `TLS certificate expires in ${Math.max(0, Math.floor(days))} day(s) and should be renewed.`,
              snippet(`Not After: ${(afterM[1] || '').trim()}`, 200),
            ),
          );
        }
      }
    }
  };

  const checkRateLimit = async (): Promise<void> => {
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      if (isCancelled()) return;
      const o = await run(`curl -sS -o /dev/null -w "%{http_code}:%{size_download}" --max-time 4 ${q(noHash)}`, 6000);
      const tail = (o || '').trim().split(/\s+/).pop() || '';
      const m = tail.match(/(\d{3}):(\d+)/);
      codes.push(m && m[1] ? m[1] : '000');
    }
    const accepted = codes.filter((c) => c !== '000' && c !== '429').length;
    const limited = codes.filter((c) => c === '429').length;
    if (limited > 0) {
      findings.push(
        mk(
          'Rate limiting present',
          'info',
          `Server returned 429 for ${limited}/10 rapid requests, some rate limiting appears to be in place.`,
          snippet(`Codes: ${codes.join(',')}`, 200),
        ),
      );
    } else if (accepted === 10) {
      findings.push(
        mk(
          'No rate limiting observed',
          'info',
          'Endpoint accepted 10/10 rapid requests without a 429, brute force and enumeration are not throttled at this endpoint.',
          snippet(`Codes: ${codes.join(',')}`, 200),
        ),
      );
    } else {
      findings.push(
        mk(
          'Rate limit probe mixed results',
          'info',
          `Rapid probe finished with ${accepted}/10 accepted requests, result is inconclusive.`,
          snippet(`Codes: ${codes.join(',')}`, 200),
        ),
      );
    }
  };

  const checkIdor = async (): Promise<void> => {
    let neighborUrl: string | null = null;
    let label = '';
    const pm = u.pathname.match(/^(.*\/)(\d{1,10})(\/)?$/);
    if (pm && pm[2]) {
      const next = String(parseInt(pm[2], 10) + 1);
      neighborUrl = origin + (pm[1] || '/') + next + u.search;
      label = pm[2];
    } else {
      const keys = [...u.searchParams.keys()];
      const idKey =
        keys.find((k) => /id|uid|user|account|order|invoice|profile/i.test(k) && /^\d{1,10}$/.test(u.searchParams.get(k) || '')) ||
        keys.find((k) => /^\d{1,10}$/.test(u.searchParams.get(k) || ''));
      if (idKey) {
        const val = u.searchParams.get(idKey) as string;
        const next = String(parseInt(val, 10) + 1);
        const rawQs = (u.search.startsWith('?') ? u.search.slice(1) : u.search).split('&');
        const rebuilt = rawQs.map((seg) => {
          const eq = seg.indexOf('=');
          const rk = eq >= 0 ? seg.slice(0, eq) : seg;
          let dk = rk;
          try {
            dk = decodeURIComponent(rk.replace(/\+/g, ' '));
          } catch {
            dk = rk;
          }
          if (dk === idKey) return `${encodeURIComponent(idKey)}=${encodeURIComponent(next)}`;
          return seg;
        });
        neighborUrl = origin + u.pathname + '?' + rebuilt.join('&');
        label = `${idKey}=${val}`;
      }
    }
    if (!neighborUrl) {
      findings.push(
        mk('IDOR check skipped', 'info', 'No numeric object ID found in the path or query string, nothing to compare.'),
      );
      return;
    }
    const bOut = await run(`curl -sS -i --max-time 8 ${q(noHash)}`, 10000);
    const tOut = await run(`curl -sS -i --max-time 8 ${q(neighborUrl)}`, 10000);
    if (!bOut || !tOut) return;
    const b = parseHttp(bOut);
    const t = parseHttp(tOut);
    if (b.status !== 200 || t.status !== 200) {
      findings.push(
        mk('IDOR check negative', 'info', `Neighbor object request returned HTTP ${t.status} (baseline HTTP ${b.status}), direct access appears blocked.`),
      );
      return;
    }
    if (b.body.length === t.body.length) return;
    const ratio = Math.min(b.body.length, t.body.length) / Math.max(b.body.length, t.body.length);
    const errRe = /error|not found|forbidden|unauthorized|access denied|invalid/i;
    if (ratio > 0.5 && !errRe.test(t.body)) {
      findings.push(
        mk(
          'Possible IDOR (neighbor object accessible)',
          'medium',
          `Changing ID ${label} to its neighbor returned a structurally similar but different object, access control may be missing.`,
          snippet(`Baseline: HTTP 200 (${b.body.length}b) / Neighbor: HTTP 200 (${t.body.length}b)`, 200),
        ),
      );
    } else {
      findings.push(
        mk('IDOR check negative', 'info', 'Neighbor object differs too much or carries an error, no IDOR signal.'),
      );
    }
  };

  const checkDefaultCreds = async (): Promise<void> => {
    let form: { pageUrl: string; action: string; userField: string; passField: string } | null = null;
    for (const p of LOGIN_PATHS) {
      if (isCancelled()) return;
      const pageUrl = origin + p;
      const html = await run(`curl -sS --max-time 6 ${q(pageUrl)}`, 8000);
      if (!html || !/type\s*=\s*["']?password/i.test(html)) continue;
      const actionM =
        html.match(/<form[^>]*action\s*=\s*["']([^"']*)["']/i) ||
        html.match(/<form[^>]*action\s*=\s*([^>\s]+)/i);
      const passM =
        html.match(/<input[^>]*type\s*=\s*["']?password["']?[^>]*name\s*=\s*["']([^"']+)["']/i) ||
        html.match(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']?password["']?/i);
      if (!passM || !passM[1]) continue;
      const userM =
        html.match(/<input[^>]*type\s*=\s*["']?(text|email|username)["']?[^>]*name\s*=\s*["']([^"']+)["']/i) ||
        html.match(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']?(text|email|username)["']?/i);
      const userField = (userM && (userM[2] || userM[1]) ? (userM[2] || userM[1]) : 'username') as string;
      form = {
        pageUrl,
        action: resolveAction(origin, p, (actionM && actionM[1] ? actionM[1] : p) as string),
        userField,
        passField: passM[1] as string,
      };
      break;
    }
    if (!form) {
      findings.push(
        mk(
          'Default-credential check skipped',
          'info',
          'No login form found on common paths, credentials were not tested blindly.',
        ),
      );
      return;
    }
    const f = form;
    for (const c of TOP8_CREDS) {
      if (isCancelled()) return;
      const out = await run(
        `curl -sS -i --max-time 8 -X POST --data-urlencode ${q(f.userField + '=' + c.username)} --data-urlencode ${q(f.passField + '=' + c.password)} ${q(f.action)}`,
        10000,
      );
      if (!out) continue;
      const r = parseHttp(out);
      const low = r.body.toLowerCase();
      const loc = r.headers['location'] || '';
      const successSignal =
        (low.includes('dashboard') || low.includes('logout') || (loc !== '' && !/login|signin|error|denied/i.test(loc))) &&
        !low.includes('invalid') &&
        !low.includes('incorrect') &&
        !low.includes('authentication failed');
      if ((r.status === 200 || r.status === 301 || r.status === 302) && successSignal) {
        findings.push(
          mk(
            'Default credentials accepted',
            'critical',
            `Login at ${f.pageUrl} appears to accept default credentials ${c.username}:${c.password}, change them immediately.`,
            snippet(`Endpoint: ${f.action} / ${c.username}:${c.password}`, 300),
          ),
        );
        return;
      }
    }
    findings.push(
      mk(
        'Default credentials rejected',
        'info',
        `Login form at ${f.pageUrl} rejected all 8 common credential pairs.`,
      ),
    );
  };

  const steps: Array<() => Promise<void>> = [
    checkCors,
    checkHostHeader,
    checkCrlf,
    checkJwt,
    checkLog4j,
    checkGraphql,
    checkTls,
    checkRateLimit,
    checkIdor,
    checkDefaultCreds,
  ];

  for (const step of steps) {
    if (isCancelled()) return findings;
    try {
      await step();
    } catch {
      continue;
    }
    if (isCancelled()) return findings;
  }

  return findings;
}
