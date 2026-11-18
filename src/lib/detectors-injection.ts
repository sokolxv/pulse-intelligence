export interface InjectionFinding {
  id: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  result?: string;
}

export type ExecFn = (cmd: string, timeoutMs?: number) => Promise<string>;

const SQLI_PAYLOADS: string[] = ["'", '"', "' OR '1'='1", "' OR 1=1-- -"];

const SQL_ERROR_SIGNALS: RegExp[] = [
  /you have an error in your sql syntax/i,
  /warning:.*mysql/i,
  /unclosed quotation mark/i,
  /quoted string not properly terminated/i,
  /ora-[0-9]{5}/i,
  /oracle.*(error|driver)/i,
  /incorrect syntax near/i,
  /microsoft.*(odbc|sql server)/i,
  /postgresql.*error/i,
  /pg::syntaxerror/i,
  /sqlite.*error|sql logic error|sqlite3::sqlexception/i,
  /valid (mysql|postgresql) result/i,
  /unknown column|table .* doesn't exist/i,
  /unexpected end of sql command/i,
  /system\.data\.(odbc|sqlclient|oledb)/i,
  /division by zero/i,
];

const XSS_PAYLOADS: string[] = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '"><script>alert(1)</script>',
];

const LFI_PAYLOADS: string[] = [
  '../../../etc/passwd',
  '../../../../../../etc/passwd',
  '....//....//....//etc/passwd',
  'php://filter/convert.base64-encode/resource=../../etc/passwd',
];

const LFI_SIGNALS: RegExp[] = [
  /root:[^:\n]*:0:0:/,
  /bin\/bash/,
  /nobody:x:65534/,
  /daemon:x:1:1/,
  /<\?php/,
];

const SSTI_PAYLOADS: Array<{ payload: string; engine: string }> = [
  { payload: '{{7*7}}', engine: 'jinja2/twig' },
  { payload: '${7*7}', engine: 'freemarker/thymeleaf' },
  { payload: '#{7*7}', engine: 'pug' },
  { payload: '<%= 7*7 %>', engine: 'erb' },
];

const XXE_XML_BASIC =
  "<?xml version='1.0' encoding='UTF-8'?><!DOCTYPE foo [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><root>&xxe;</root>";

const XXE_XML_SVG =
  "<?xml version='1.0'?><!DOCTYPE svg [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><text x='10' y='20'>&xxe;</text></svg>";

const XXE_SIGNALS: RegExp[] = [
  /root:[^:\n]*:0:0:/,
  /bin\/bash/,
  /nobody:x:65534/,
  /daemon:x:1:1/,
  /\[boot loader\]/i,
  /metadata\.google\.internal/i,
];

const SSRF_PARAM_NAMES: string[] = [
  'url', 'uri', 'redirect', 'redirect_uri', 'redirect_url', 'src', 'source',
  'feed', 'link', 'href', 'location', 'dest', 'destination', 'image', 'img',
  'fetch', 'file', 'path', 'page', 'load', 'read', 'target', 'next',
  'continue', 'return', 'site', 'u', 'r',
];

const SSRF_PAYLOADS: string[] = ['https://example.com/', 'http://example.com/'];

const CMD_TIME_PAYLOADS: string[] = ['; sleep 3', '| sleep 3'];

const CMD_TIME_THRESHOLD_MS = 2700;

const REDIRECT_PAYLOADS: string[] = [
  'https://evil.example.com/',
  '//evil.example.com/',
  '///evil.example.com/',
  '/\\/evil.example.com/',
];

const REDIRECT_MARKER = 'evil.example.com';

let findingSeq = 0;

function nextId(prefix: string): string {
  findingSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${findingSeq.toString(36)}`;
}

function buildTestUrl(base: URL, param: string, payload: string): string {
  const clone = new URL(base.toString());
  clone.searchParams.set(param, payload);
  encodeURIComponent(payload);
  return clone.toString();
}

function quoteUrl(url: string): string {
  const safe = url
    .replace(/\\/g, '%5C')
    .replace(/"/g, '%22')
    .replace(/`/g, '%60')
    .replace(/\$/g, '%24');
  return `"${safe}"`;
}

function curlGetCommand(url: string): string {
  return `curl -s -L --max-time 6 ${quoteUrl(url)}`;
}

function curlHeadersCommand(url: string): string {
  return `curl -s -D - --max-time 6 ${quoteUrl(url)}`;
}

function curlXmlPostCommand(url: string, xml: string): string {
  return `curl -s -L --max-time 6 -X POST ${quoteUrl(url)} -H "Content-Type: application/xml" --data "${xml}"`;
}

function snippet(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 160);
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (h.startsWith('127.') || h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
  const m = /^172\.(\d{1,3})\./.exec(h);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

function findEvilLocation(headersAndBody: string): string {
  const lines = headersAndBody.split(/\r?\n/);
  for (const line of lines) {
    const m = /^location\s*:\s*(.+)$/i.exec(line.trim());
    if (m && m[1].toLowerCase().includes(REDIRECT_MARKER)) return m[1].trim();
  }
  return '';
}

async function curlBody(exec: ExecFn, url: string, timeoutMs: number): Promise<{ text: string; ms: number }> {
  const started = Date.now();
  try {
    const text = await exec(curlGetCommand(url), timeoutMs);
    return { text, ms: Date.now() - started };
  } catch {
    return { text: '', ms: Date.now() - started };
  }
}

async function checkSqli(
  exec: ExecFn,
  base: URL,
  params: string[],
  isCancelled: () => boolean,
): Promise<InjectionFinding[]> {
  const out: InjectionFinding[] = [];
  for (const param of params) {
    for (const payload of SQLI_PAYLOADS) {
      const { text } = await curlBody(exec, buildTestUrl(base, param, payload), 8000);
      if (isCancelled()) return out;
      if (!text) continue;
      const hit = SQL_ERROR_SIGNALS.find((re) => re.test(text));
      if (hit) {
        out.push({
          id: nextId('sqli'),
          name: 'SQL Injection (error-based)',
          severity: 'critical',
          description: `Parameter "${param}" reflects a database error message, indicating possible SQL injection.`,
          result: `param=${param} payload=${payload} signal=${hit.source} excerpt=${snippet(text)}`,
        });
        break;
      }
    }
    if (isCancelled()) return out;
  }
  return out;
}

async function checkXss(
  exec: ExecFn,
  base: URL,
  params: string[],
  isCancelled: () => boolean,
): Promise<InjectionFinding[]> {
  const out: InjectionFinding[] = [];
  for (const param of params) {
    for (const payload of XSS_PAYLOADS) {
      const { text } = await curlBody(exec, buildTestUrl(base, param, payload), 8000);
      if (isCancelled()) return out;
      if (text && text.includes(payload)) {
        out.push({
          id: nextId('xss'),
          name: 'Reflected Cross-Site Scripting (XSS)',
          severity: 'high',
          description: `Parameter "${param}" reflects unsanitized input, allowing reflected XSS.`,
          result: `param=${param} payload=${payload} excerpt=${snippet(text)}`,
        });
        break;
      }
    }
    if (isCancelled()) return out;
  }
  return out;
}

async function checkLfi(
  exec: ExecFn,
  base: URL,
  params: string[],
  isCancelled: () => boolean,
): Promise<InjectionFinding[]> {
  const out: InjectionFinding[] = [];
  for (const param of params) {
    for (const payload of LFI_PAYLOADS) {
      const { text } = await curlBody(exec, buildTestUrl(base, param, payload), 8000);
      if (isCancelled()) return out;
      if (!text) continue;
      const hit = LFI_SIGNALS.find((re) => re.test(text));
      if (hit) {
        out.push({
          id: nextId('lfi'),
          name: 'Local File Inclusion (LFI)',
          severity: 'high',
          description: `Parameter "${param}" appears to allow local file inclusion; file content markers detected in response.`,
          result: `param=${param} payload=${payload} signal=${hit.source} excerpt=${snippet(text)}`,
        });
        break;
      }
    }
    if (isCancelled()) return out;
  }
  return out;
}

async function checkSsti(
  exec: ExecFn,
  base: URL,
  params: string[],
  isCancelled: () => boolean,
): Promise<InjectionFinding[]> {
  const out: InjectionFinding[] = [];
  for (const param of params) {
    for (const test of SSTI_PAYLOADS) {
      const { text } = await curlBody(exec, buildTestUrl(base, param, test.payload), 8000);
      if (isCancelled()) return out;
      if (text && text.includes('49') && !text.includes(test.payload)) {
        out.push({
          id: nextId('ssti'),
          name: `Server-Side Template Injection (${test.engine})`,
          severity: 'high',
          description: `Parameter "${param}" appears to evaluate template arithmetic (7*7=49), indicating possible SSTI in ${test.engine} engine.`,
          result: `param=${param} payload=${test.payload} signal=49-without-syntax excerpt=${snippet(text)}`,
        });
        break;
      }
    }
    if (isCancelled()) return out;
  }
  return out;
}

async function checkXxe(
  exec: ExecFn,
  base: URL,
  params: string[],
  isCancelled: () => boolean,
): Promise<InjectionFinding[]> {
  const out: InjectionFinding[] = [];
  const haystack = `${base.pathname.toLowerCase()} ${base.search.toLowerCase()}`;
  const looksSvg = haystack.includes('svg');
  const looksXml =
    looksSvg ||
    haystack.includes('xml') ||
    haystack.includes('soap') ||
    params.some((p) => ['xml', 'svg', 'data', 'template', 'content', 'file'].includes(p.toLowerCase()));
  if (!looksXml) return out;
  const probes = looksSvg ? [XXE_XML_SVG, XXE_XML_BASIC] : [XXE_XML_BASIC];
  for (const xml of probes) {
    let text = '';
    try {
      text = await exec(curlXmlPostCommand(base.toString(), xml), 8000);
    } catch {
      text = '';
    }
    if (isCancelled()) return out;
    if (!text) continue;
    const hit = XXE_SIGNALS.find((re) => re.test(text));
    if (hit) {
      out.push({
        id: nextId('xxe'),
        name: 'XML External Entity (XXE) Injection',
        severity: 'high',
        description: 'Endpoint appears to process external XML entities; file content markers detected in response.',
        result: `signal=${hit.source} excerpt=${snippet(text)}`,
      });
      break;
    }
  }
  return out;
}

async function checkSsrf(
  exec: ExecFn,
  base: URL,
  params: string[],
  isCancelled: () => boolean,
): Promise<InjectionFinding[]> {
  const out: InjectionFinding[] = [];
  if (isBlockedHost(base.hostname)) return out;
  const targets = params.filter((p) => SSRF_PARAM_NAMES.includes(p.toLowerCase())).slice(0, 2);
  if (targets.length === 0) return out;
  for (const param of targets) {
    for (const payload of SSRF_PAYLOADS) {
      const { text } = await curlBody(exec, buildTestUrl(base, param, payload), 8000);
      if (isCancelled()) return out;
      if (text && /example domain/i.test(text)) {
        out.push({
          id: nextId('ssrf'),
          name: 'Server-Side Request Forgery (open fetch)',
          severity: 'high',
          description: `Parameter "${param}" appears to make the server fetch an external URL and reflect its content.`,
          result: `param=${param} payload=${payload} excerpt=${snippet(text)}`,
        });
        break;
      }
    }
    if (isCancelled()) return out;
  }
  return out;
}

async function checkCmdInjection(
  exec: ExecFn,
  base: URL,
  params: string[],
  isCancelled: () => boolean,
): Promise<InjectionFinding[]> {
  const out: InjectionFinding[] = [];
  for (const param of params) {
    for (const payload of CMD_TIME_PAYLOADS) {
      const { text, ms } = await curlBody(exec, buildTestUrl(base, param, payload), 9000);
      if (isCancelled()) return out;
      if (text && ms >= CMD_TIME_THRESHOLD_MS) {
        out.push({
          id: nextId('cmdi'),
          name: 'Command Injection (time-based)',
          severity: 'critical',
          description: `Parameter "${param}" shows a response delay consistent with shell command execution (sleep 3 probe).`,
          result: `param=${param} payload=${payload} elapsedMs=${ms}`,
        });
        break;
      }
    }
    if (isCancelled()) return out;
  }
  return out;
}

async function checkOpenRedirect(
  exec: ExecFn,
  base: URL,
  params: string[],
  isCancelled: () => boolean,
): Promise<InjectionFinding[]> {
  const out: InjectionFinding[] = [];
  for (const param of params) {
    for (const payload of REDIRECT_PAYLOADS) {
      let raw = '';
      try {
        raw = await exec(curlHeadersCommand(buildTestUrl(base, param, payload)), 8000);
      } catch {
        raw = '';
      }
      if (isCancelled()) return out;
      const location = raw ? findEvilLocation(raw) : '';
      if (location) {
        out.push({
          id: nextId('redirect'),
          name: 'Open Redirect',
          severity: 'medium',
          description: `Parameter "${param}" redirects to an attacker-controlled external domain, enabling phishing.`,
          result: `param=${param} payload=${payload} location=${location}`,
        });
        break;
      }
    }
    if (isCancelled()) return out;
  }
  return out;
}

export async function runInjectionChecks(
  exec: ExecFn,
  targetUrl: string,
  isCancelled: () => boolean,
): Promise<InjectionFinding[]> {
  const findings: InjectionFinding[] = [];
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return [
      {
        id: nextId('inj-error'),
        name: 'Invalid target URL',
        severity: 'info',
        description: `Cannot parse target URL: ${targetUrl}`,
      },
    ];
  }
  const names: string[] = [];
  parsed.searchParams.forEach((_value, key) => {
    if (!names.includes(key)) names.push(key);
  });
  if (names.length === 0) {
    return [
      {
        id: nextId('inj-skip'),
        name: 'No query parameters — injection checks skipped',
        severity: 'info',
        description: 'Target URL has no query string, so query-parameter injection checks were skipped.',
      },
    ];
  }
  const params = names.slice(0, 2);
  const detectors: Array<(
    exec: ExecFn,
    base: URL,
    queryParams: string[],
    isCancelled: () => boolean,
  ) => Promise<InjectionFinding[]>> = [
    checkSqli,
    checkXss,
    checkLfi,
    checkSsti,
    checkXxe,
    checkSsrf,
    checkCmdInjection,
    checkOpenRedirect,
  ];
  for (const detector of detectors) {
    if (isCancelled()) return findings;
    const partial = await detector(exec, parsed, params, isCancelled);
    findings.push(...partial);
    if (isCancelled()) return findings;
  }
  return findings;
}
