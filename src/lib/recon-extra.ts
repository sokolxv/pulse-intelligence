export interface ReconFinding {
  id: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  result?: string;
}

export type ExecFn = (cmd: string, timeoutMs?: number) => Promise<string>;

export const RISKY_PORTS: number[] = [
  21, 22, 23, 25, 53, 80, 110, 143, 443, 445,
  1433, 1521, 3306, 3389, 5432, 5900, 6379, 8080, 8443, 27017,
];

interface WafSignature {
  name: string;
  markers: string[];
}

const WAF_SIGNATURES: WafSignature[] = [
  { name: 'Cloudflare', markers: ['cloudflare', 'cf-ray', 'cf-cache-status', '__cfduid'] },
  { name: 'ModSecurity', markers: ['modsecurity', 'mod_security'] },
  { name: 'AWS WAF', markers: ['awswaf', 'x-amzn-requestid', 'x-amz-id-2', 'x-amzn-waf'] },
  { name: 'CloudFront', markers: ['cloudfront', 'x-amz-cf-id', 'x-amz-cf-pop'] },
  { name: 'Akamai Ghost', markers: ['akamaighost', 'akamai'] },
  { name: 'F5 BIG-IP ASM', markers: ['bigipserver', 'x-wa-ident', 'x-wa-info', 'x-cnection'] },
  { name: 'Sucuri', markers: ['sucuri', 'cloudproxy', 'x-sucuri-id', 'x-sucuri-cache'] },
  { name: 'Imperva Incapsula', markers: ['incapsula', 'imperva', 'incap_ses_', 'visid_incap_', 'x-iinfo'] },
  { name: 'Citrix NetScaler', markers: ['citrix', 'netscaler', 'nsc_', 'ns_af'] },
  { name: 'Wordfence', markers: ['wordfence', 'wfvt_'] },
  { name: 'Comodo WAF', markers: ['comodo'] },
  { name: 'Barracuda WAF', markers: ['barracuda'] },
  { name: 'Fortinet FortiWeb', markers: ['fortiweb', 'fortigate'] },
  { name: 'Radware AppWall', markers: ['radware'] },
];

const ENDPOINT_RE = /\/(api|v1|v2|graphql|admin|debug)[\w./-]*/g;

const SECRET_TOKEN =
  /AKIA[0-9A-Z]{16}|aws_access[\w-]*|sk_live_[0-9a-zA-Z]+|xox[bap][0-9a-zA-Z-]+|ghp_[A-Za-z0-9]+|AIza[0-9A-Za-z\-_]{10,}|BEGIN PRIVATE KEY|password\s*[:=]|api[_-]?key\s*[:=]/gi;

function classifySecret(hit: string): string {
  if (/^AKIA/i.test(hit)) return 'AWS Access Key';
  if (/^aws_access/i.test(hit)) return 'AWS Access Key ID';
  if (/^sk_live/i.test(hit)) return 'Stripe Live Key';
  if (/^xox/i.test(hit)) return 'Slack Token';
  if (/^ghp_/i.test(hit)) return 'GitHub Token';
  if (/^AIza/i.test(hit)) return 'Google API Key';
  if (/^BEGIN/i.test(hit)) return 'Private Key';
  if (/^password/i.test(hit)) return 'Password assignment';
  return 'API Key assignment';
}

function extractJsUrls(html: string, base: URL): string[] {
  const out: string[] = [];
  const re = /<script[^>]*src=["']([^"']+\.js[^"']*)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], base.href);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.origin === base.origin) {
        if (!out.includes(u.href)) out.push(u.href);
      }
    } catch {
      continue;
    }
  }
  return out.slice(0, 8);
}

async function detectWaf(exec: ExecFn, pageUrl: string): Promise<ReconFinding> {
  try {
    const raw = await exec(`curl -sI --max-time 10 "${encodeURIComponent(pageUrl)}"`, 12000);
    const hay = raw.toLowerCase();
    for (const sig of WAF_SIGNATURES) {
      const marker = sig.markers.find((mk) => hay.includes(mk));
      if (marker) {
        return {
          id: 'waf-detect',
          name: `WAF detected: ${sig.name}`,
          severity: 'info',
          description: `Response headers match the ${sig.name} fingerprint (marker: ${marker}).`,
          result: raw.slice(0, 1000),
        };
      }
    }
    return {
      id: 'waf-detect',
      name: 'No WAF detected',
      severity: 'info',
      description: `Checked ${WAF_SIGNATURES.length} WAF signatures against response headers — no match.`,
      result: raw.slice(0, 1000),
    };
  } catch (e) {
    return {
      id: 'waf-detect',
      name: 'No WAF detected',
      severity: 'info',
      description: 'WAF header check failed.',
      result: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runReconExtra(
  exec: ExecFn,
  targetUrl: string,
  isCancelled: () => boolean,
): Promise<ReconFinding[]> {
  const findings: ReconFinding[] = [];

  let base: URL;
  try {
    base = new URL(targetUrl);
  } catch (e) {
    findings.push({
      id: 'invalid-target',
      name: 'Invalid target URL',
      severity: 'info',
      description: `Cannot parse target URL: ${targetUrl}`,
      result: e instanceof Error ? e.message : String(e),
    });
    return findings;
  }
  if (isCancelled()) return findings;

  findings.push(await detectWaf(exec, base.href));
  if (isCancelled()) return findings;

  try {
    const html = (await exec(`curl -sL --max-time 8 "${encodeURIComponent(base.href)}"`, 10000)).slice(0, 60000);
    if (isCancelled()) return findings;

    const jsUrls = extractJsUrls(html, base);
    const chunks: string[] = [];
    for (const jsUrl of jsUrls) {
      if (isCancelled()) return findings;
      try {
        const body = await exec(`curl -sL --max-time 8 "${encodeURIComponent(jsUrl)}"`, 10000);
        if (body) chunks.push(body.slice(0, 100000));
      } catch {
        continue;
      }
    }
    if (isCancelled()) return findings;

    const combined = chunks.join('\n');
    const endpoints = Array.from(new Set(combined.match(ENDPOINT_RE) ?? [])).slice(0, 50);
    findings.push({
      id: 'js-endpoints',
      name: endpoints.length > 0 ? `JS endpoints (${endpoints.length})` : 'JS endpoints',
      severity: 'info',
      description:
        endpoints.length > 0
          ? `API-ish paths extracted from ${chunks.length} JavaScript file(s).`
          : `No API endpoints found in ${chunks.length} JavaScript file(s).`,
      result: endpoints.length > 0 ? endpoints.join('\n') : 'No endpoints matched.',
    });

    const secrets = Array.from(new Set(combined.match(SECRET_TOKEN) ?? []))
      .slice(0, 20)
      .map((hit) => `${classifySecret(hit)}: ${hit.slice(0, 4)}****`);
    if (secrets.length > 0) {
      findings.push({
        id: 'js-secrets',
        name: `Exposed secrets in JS (${secrets.length})`,
        severity: 'high',
        description:
          'Potential secrets or credentials referenced in JavaScript (values masked, only type + first 4 chars shown).',
        result: secrets.join('\n'),
      });
    }
  } catch (e) {
    findings.push({
      id: 'js-fetch-failed',
      name: 'JS analysis failed',
      severity: 'info',
      description: 'Could not fetch the page or its JavaScript files for secret analysis.',
      result: e instanceof Error ? e.message : String(e),
    });
  }
  if (isCancelled()) return findings;

  return findings;
}
