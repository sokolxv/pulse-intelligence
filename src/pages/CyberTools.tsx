import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Wrench,
  Hash,
  Lock,
  Key,
  Globe,
  Copy,
  Check,
  RefreshCw,
  ArrowRightLeft,
  Binary,
} from 'lucide-react';

interface CyberTool {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  color: string;
}

const cyberTools: CyberTool[] = [
  { id: 'hash', name: 'Hash Generator', description: 'MD5, SHA-1, SHA-256 hashing', icon: <Hash size={20} />, category: 'Crypto', color: 'text-pulse-accent' },
  { id: 'encode', name: 'Encoder/Decoder', description: 'Base64, URL, HTML encoding', icon: <ArrowRightLeft size={20} />, category: 'Encoding', color: 'text-pulse-green' },
  { id: 'jwt', name: 'JWT Decoder', description: 'Decode JSON Web Tokens', icon: <Key size={20} />, category: 'Auth', color: 'text-pulse-yellow' },
  { id: 'ports', name: 'Port Reference', description: 'Common ports & services', icon: <Globe size={20} />, category: 'Reference', color: 'text-pulse-orange' },
  { id: 'uuid', name: 'UUID Generator', description: 'Generate UUIDs v4', icon: <Binary size={20} />, category: 'Dev', color: 'text-pulse-purple' },
];

const COMMON_PORTS = [
  { port: 21, service: 'FTP', description: 'File Transfer Protocol' },
  { port: 22, service: 'SSH', description: 'Secure Shell' },
  { port: 23, service: 'Telnet', description: 'Telnet remote access' },
  { port: 25, service: 'SMTP', description: 'Simple Mail Transfer Protocol' },
  { port: 53, service: 'DNS', description: 'Domain Name System' },
  { port: 80, service: 'HTTP', description: 'HyperText Transfer Protocol' },
  { port: 110, service: 'POP3', description: 'Post Office Protocol v3' },
  { port: 135, service: 'MSRPC', description: 'Microsoft RPC' },
  { port: 139, service: 'NetBIOS', description: 'NetBIOS Session Service' },
  { port: 143, service: 'IMAP', description: 'Internet Message Access Protocol' },
  { port: 443, service: 'HTTPS', description: 'HTTP over TLS/SSL' },
  { port: 445, service: 'SMB', description: 'Server Message Block' },
  { port: 993, service: 'IMAPS', description: 'IMAP over TLS' },
  { port: 995, service: 'POP3S', description: 'POP3 over TLS' },
  { port: 1433, service: 'MSSQL', description: 'Microsoft SQL Server' },
  { port: 1521, service: 'Oracle', description: 'Oracle Database' },
  { port: 3306, service: 'MySQL', description: 'MySQL Database' },
  { port: 3389, service: 'RDP', description: 'Remote Desktop Protocol' },
  { port: 5432, service: 'PostgreSQL', description: 'PostgreSQL Database' },
  { port: 5900, service: 'VNC', description: 'Virtual Network Computing' },
  { port: 6379, service: 'Redis', description: 'Redis Database' },
  { port: 8080, service: 'HTTP-Alt', description: 'HTTP Alternate (Proxy)' },
  { port: 8443, service: 'HTTPS-Alt', description: 'HTTPS Alternate' },
  { port: 9200, service: 'Elasticsearch', description: 'Elasticsearch REST API' },
  { port: 27017, service: 'MongoDB', description: 'MongoDB Database' },
];

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha1(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function md5(message: string): string {
  // Simple MD5 implementation
  function md5cycle(x: number[], k: number[]) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function md51(s: string) {
    const n = s.length;
    let state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= n; i += 64) {
      md5cycle(state, md5blk(s.substring(i - 64, i)));
    }
    s = s.substring(i - 64);
    const tail = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    for (i = 0; i < s.length; i++) {
      tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    }
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) {
      md5cycle(state, tail);
      for (i = 0; i < 16; i++) tail[i] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }
  function md5blk(s: string) {
    const md5blks = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }
  const hex_chr = '0123456789abcdef'.split('');
  function rhex(n: number) {
    let s = '';
    for (let j = 0; j < 4; j++) {
      s += hex_chr[(n >> (j * 8 + 4)) & 0x0F] + hex_chr[(n >> (j * 8)) & 0x0F];
    }
    return s;
  }
  function hex(x: number[]) {
    return x.map(rhex).join('');
  }
  function add32(a: number, b: number) {
    return (a + b) & 0xFFFFFFFF;
  }
  return hex(md51(message));
}

export default function CyberToolsPage() {
  const [activeTool, setActiveTool] = useState<string>('hash');
  const [copied, setCopied] = useState(false);

  // Hash tool state
  const [hashInput, setHashInput] = useState('');
  const [hashResults, setHashResults] = useState<{ algo: string; hash: string }[]>([]);

  // Encoder state
  const [encodeInput, setEncodeInput] = useState('');
  const [encodeMode, setEncodeMode] = useState<'base64' | 'url' | 'html' | 'hex'>('base64');
  const [encodeDirection, setEncodeDirection] = useState<'encode' | 'decode'>('encode');
  const [encodeOutput, setEncodeOutput] = useState('');

  // JWT state
  const [jwtInput, setJwtInput] = useState('');
  const [jwtParts, setJwtParts] = useState<{ header: any; payload: any; signature: string } | null>(null);

  // UUID state
  const [uuids, setUuids] = useState<string[]>([]);

  const handleHash = async () => {
    if (!hashInput) return;
    const results = [];
    results.push({ algo: 'MD5', hash: md5(hashInput) });
    results.push({ algo: 'SHA-1', hash: await sha1(hashInput) });
    results.push({ algo: 'SHA-256', hash: await sha256(hashInput) });
    setHashResults(results);
  };

  const handleEncode = () => {
    try {
      if (encodeDirection === 'encode') {
        switch (encodeMode) {
          case 'base64':
            setEncodeOutput(btoa(unescape(encodeURIComponent(encodeInput))));
            break;
          case 'url':
            setEncodeOutput(encodeURIComponent(encodeInput));
            break;
          case 'html':
            setEncodeOutput(encodeInput.replace(/[&<>"']/g, (m) => ({
              '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[m] || m)));
            break;
          case 'hex':
            setEncodeOutput(Array.from(encodeInput).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' '));
            break;
        }
      } else {
        switch (encodeMode) {
          case 'base64':
            setEncodeOutput(decodeURIComponent(escape(atob(encodeInput))));
            break;
          case 'url':
            setEncodeOutput(decodeURIComponent(encodeInput));
            break;
          case 'html':
            const el = document.createElement('textarea');
            el.innerHTML = encodeInput;
            setEncodeOutput(el.value);
            break;
          case 'hex':
            setEncodeOutput(encodeInput.replace(/\s/g, '').match(/.{1,2}/g)?.map(h => String.fromCharCode(parseInt(h, 16))).join('') || '');
            break;
        }
      }
    } catch {
      setEncodeOutput('Error: Invalid input');
    }
  };

  const handleJWT = () => {
    try {
      const parts = jwtInput.trim().split('.');
      if (parts.length < 2) throw new Error('Invalid JWT');
      const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      setJwtParts({ header, payload, signature: parts[2] || '' });
    } catch {
      setJwtParts(null);
    }
  };

  const generateUUID = () => {
    const newUuid = crypto.randomUUID();
    setUuids((prev) => [newUuid, ...prev].slice(0, 20));
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const renderTool = () => {
    switch (activeTool) {
      case 'hash':
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-tight">Hash Generator</h3>
            <textarea
              value={hashInput}
              onChange={(e) => setHashInput(e.target.value)}
              placeholder="Enter text to hash..."
              className="w-full h-24 px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono resize-none outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
            />
            <button onClick={handleHash} className="px-4 py-2 bg-pulse-accent text-pulse-bg rounded-xl text-sm font-semibold hover:bg-pulse-accentSoft active:scale-[0.98] transition-all">
              Generate Hashes
            </button>
            {hashResults.length > 0 && (
              <div className="space-y-2">
                {hashResults.map((r) => (
                  <div key={r.algo} className="bg-pulse-bg border border-pulse-border rounded-xl p-3">
                    <div className="text-[10px] text-pulse-textMuted uppercase tracking-wider mb-1 font-semibold">{r.algo}</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono text-pulse-text break-all">{r.hash}</code>
                      <button onClick={() => copyText(r.hash)} className="p-1 text-pulse-muted hover:text-pulse-text transition-colors">
                        {copied ? <Check size={12} className="text-pulse-green" /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'encode':
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-tight">Encoder / Decoder</h3>
            <div className="flex gap-1 p-1 bg-pulse-panel border border-pulse-border rounded-xl w-fit">
              {(['base64', 'url', 'html', 'hex'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setEncodeMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${encodeMode === m ? 'bg-pulse-surface text-pulse-accent border border-pulse-borderStrong font-semibold' : 'text-pulse-muted hover:text-pulse-text'}`}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex gap-1 p-1 bg-pulse-panel border border-pulse-border rounded-xl">
              <button
                onClick={() => { setEncodeDirection('encode'); setEncodeOutput(''); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${encodeDirection === 'encode' ? 'bg-pulse-surface text-pulse-accent border border-pulse-borderStrong' : 'text-pulse-muted hover:text-pulse-text'}`}
              >
                Encode
              </button>
              <button
                onClick={() => { setEncodeDirection('decode'); setEncodeOutput(''); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${encodeDirection === 'decode' ? 'bg-pulse-surface text-pulse-accent border border-pulse-borderStrong' : 'text-pulse-muted hover:text-pulse-text'}`}
              >
                Decode
              </button>
            </div>
            <textarea
              value={encodeInput}
              onChange={(e) => setEncodeInput(e.target.value)}
              placeholder="Input..."
              className="w-full h-24 px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono resize-none outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
            />
            <button onClick={handleEncode} className="px-4 py-2 bg-pulse-accent text-pulse-bg rounded-xl text-sm font-semibold hover:bg-pulse-accentSoft active:scale-[0.98] transition-all">
              {encodeDirection === 'encode' ? 'Encode' : 'Decode'}
            </button>
            {encodeOutput && (
              <div className="bg-pulse-bg border border-pulse-border rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-pulse-text break-all">{encodeOutput}</code>
                  <button onClick={() => copyText(encodeOutput)} className="p-1 text-pulse-muted hover:text-pulse-text transition-colors">
                    {copied ? <Check size={12} className="text-pulse-green" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        );

      case 'jwt':
        return (
            <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-tight">JWT Decoder</h3>
            <textarea
              value={jwtInput}
              onChange={(e) => setJwtInput(e.target.value)}
              placeholder="Paste a JWT token..."
              className="w-full h-24 px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-xs font-mono resize-none outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
            />
            <button onClick={handleJWT} className="px-4 py-2 bg-pulse-accent text-pulse-bg rounded-xl text-sm font-semibold hover:bg-pulse-accentSoft active:scale-[0.98] transition-all">
              Decode
            </button>
            {jwtParts && (
              <div className="space-y-3">
                <div className="bg-pulse-bg border border-pulse-border rounded-xl p-3">
                  <div className="text-[10px] text-pulse-textMuted uppercase tracking-wider mb-2 font-semibold">Header</div>
                  <pre className="text-xs font-mono text-pulse-text whitespace-pre-wrap">{JSON.stringify(jwtParts.header, null, 2)}</pre>
                </div>
                <div className="bg-pulse-bg border border-pulse-border rounded-xl p-3">
                  <div className="text-[10px] text-pulse-textMuted uppercase tracking-wider mb-2 font-semibold">Payload</div>
                  <pre className="text-xs font-mono text-pulse-text whitespace-pre-wrap">{JSON.stringify(jwtParts.payload, null, 2)}</pre>
                  {jwtParts.payload.exp && (
                    <div className="mt-2 text-[10px] text-pulse-muted">
                      Expires: {new Date(jwtParts.payload.exp * 1000).toLocaleString()}
                      {jwtParts.payload.exp * 1000 < Date.now() && (
                        <span className="text-pulse-red ml-2">⚠️ EXPIRED</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case 'ports':
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-tight">Common Ports Reference</h3>
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="bg-pulse-bg/50 sticky top-0">
                    <th className="text-left px-3 py-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-pulse-textMuted">PORT</th>
                    <th className="text-left px-3 py-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-pulse-textMuted">SERVICE</th>
                    <th className="text-left px-3 py-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-pulse-textMuted">DESCRIPTION</th>
                  </tr>
                </thead>
                <tbody>
                  {COMMON_PORTS.map((p) => (
                    <tr key={p.port} className="border-t border-pulse-border/50 hover:bg-pulse-surfaceHover transition-colors">
                      <td className="px-3 py-2 font-mono text-pulse-accent">{p.port}</td>
                      <td className="px-3 py-2 font-mono font-medium">{p.service}</td>
                      <td className="px-3 py-2 text-pulse-muted">{p.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'uuid':
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-tight">UUID v4 Generator</h3>
            <button onClick={generateUUID} className="px-4 py-2 bg-pulse-accent text-pulse-bg rounded-xl text-sm font-semibold hover:bg-pulse-accentSoft active:scale-[0.98] transition-all">
              Generate UUID
            </button>
            <div className="space-y-1.5">
              {uuids.map((u, i) => (
                <div key={i} className="flex items-center gap-2 bg-pulse-bg border border-pulse-border rounded-xl px-3 py-2 hover:border-pulse-borderStrong transition-colors">
                  <code className="flex-1 text-xs font-mono text-pulse-text">{u}</code>
                  <button onClick={() => copyText(u)} className="p-1 text-pulse-muted hover:text-pulse-text transition-colors">
                    <Copy size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex gap-4 h-full"
    >
      {/* Left: Tool List */}
      <div className="w-60 flex flex-col gap-1.5">
        <div className="px-2 py-2 mb-1">
          <Wrench size={16} className="text-pulse-accent" />
        </div>
        {cyberTools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            className={`flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
              activeTool === tool.id
                ? 'bg-pulse-panel border border-pulse-borderStrong'
                : 'hover:bg-pulse-surfaceHover border border-transparent'
            }`}
          >
            <span className={tool.color}>{tool.icon}</span>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{tool.name}</div>
              <div className="text-[10px] text-pulse-muted truncate">{tool.description}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Right: Tool Panel */}
      <div className="flex-1 bg-pulse-surface border border-pulse-border rounded-xl p-5 overflow-auto">
        {renderTool()}
      </div>
    </motion.div>
  );
}
