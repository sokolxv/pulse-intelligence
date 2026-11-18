import { Copy } from 'lucide-react';
import type { NetworkBodyResult, NetworkRequest } from '../../network/types';
import {
  decodeBody,
  prettyBody,
  prettyHeaders,
  protocolLabel,
  statusLabel,
  urlPath,
} from '../../inspector/format';
import { copyText } from './tones';

function displayBody(result?: NetworkBodyResult): string | undefined {
  if (!result || !result.body) return undefined;
  const decoded = result.base64Encoded ? decodeBody(result) : result.body;
  if (!decoded && result.base64Encoded) return undefined;
  return prettyBody(decoded, result.mimeType).text;
}

function buildRequestBlock(request: NetworkRequest, body?: NetworkBodyResult): string {
  const lines: string[] = [];
  lines.push(`${request.method} ${urlPath(request.url)} ${protocolLabel(request.protocol)}`);
  lines.push(`Host: ${request.domain}`);
  for (const header of prettyHeaders(request.requestHeaders)) {
    if (header.name.toLowerCase() === 'host') continue;
    lines.push(`${header.name}: ${header.value}`);
  }
  const bodyText = displayBody(body);
  if (bodyText) {
    lines.push('');
    lines.push(bodyText);
  }
  return lines.join('\n');
}

function buildResponseBlock(request: NetworkRequest, body?: NetworkBodyResult): string {
  const lines: string[] = [];
  const statusPart =
    request.status !== undefined
      ? statusLabel(request.status, request.statusText) || `${request.status}`
      : '—';
  lines.push(`${protocolLabel(request.protocol)} ${statusPart}`);
  for (const header of prettyHeaders(request.responseHeaders)) {
    lines.push(`${header.name}: ${header.value}`);
  }
  const bodyText = displayBody(body);
  if (bodyText) {
    lines.push('');
    lines.push(bodyText);
  }
  return lines.join('\n');
}

const BLOCK_CLASS =
  'max-h-[300px] overflow-auto bg-pulse-bg/60 rounded-lg border border-pulse-border p-3 font-mono text-[11px] whitespace-pre-wrap break-all';

interface RawViewProps {
  request: NetworkRequest;
  requestBody?: NetworkBodyResult;
  responseBody?: NetworkBodyResult;
}

export default function RawView({ request, requestBody, responseBody }: RawViewProps) {
  const requestBlock = buildRequestBlock(request, requestBody);
  const responseBlock = buildResponseBlock(request, responseBody);

  const handleCopy = async (text: string) => {
    try {
      await copyText(text);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h4 className="text-[10px] uppercase tracking-widest text-pulse-muted">Request</h4>
          <button
            type="button"
            onClick={() => handleCopy(requestBlock)}
            className="flex items-center gap-1 text-[10px] text-pulse-muted hover:text-pulse-accent transition-colors"
          >
            <Copy size={11} />
            Copy
          </button>
        </div>
        <pre className={BLOCK_CLASS}>{requestBlock}</pre>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h4 className="text-[10px] uppercase tracking-widest text-pulse-muted">Response</h4>
          <button
            type="button"
            onClick={() => handleCopy(responseBlock)}
            className="flex items-center gap-1 text-[10px] text-pulse-muted hover:text-pulse-accent transition-colors"
          >
            <Copy size={11} />
            Copy
          </button>
        </div>
        <pre className={BLOCK_CLASS}>{responseBlock}</pre>
      </div>
    </div>
  );
}
