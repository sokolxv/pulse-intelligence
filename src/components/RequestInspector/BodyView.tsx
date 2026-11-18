import { Check, Copy, Download, Loader2, RefreshCw } from 'lucide-react';
import type { NetworkBodyKind, NetworkBodyResult, NetworkRequest } from '../../network/types';
import { decodeBody, formatBytes, prettyBody } from '../../inspector/format';
import JsonViewer from './JsonViewer';
import { copyText } from './tones';

const TEXT_MIME_RE = /^(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded)|.*\+(json|xml))/;
const BINARY_MIME_RE = /^(image|audio|video|font)\//;

function bodyBytes(result: NetworkBodyResult): number {
  const body = result.body ?? '';
  if (result.base64Encoded) return Math.floor((body.length * 3) / 4);
  return new TextEncoder().encode(body).length;
}

function fileNameFor(request: NetworkRequest, kind: NetworkBodyKind): string {
  try {
    const parsed = new URL(request.url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) return last;
  } catch {
    // relative or invalid url — fall through
  }
  return kind === 'request' ? 'request.bin' : 'response.bin';
}

interface BodyViewProps {
  request: NetworkRequest;
  kind: NetworkBodyKind;
  result?: NetworkBodyResult;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  emptyText: string;
}

export default function BodyView({
  request,
  kind,
  result,
  loading,
  error,
  onRetry,
  emptyText,
}: BodyViewProps) {
  const failText = error ?? (result && !result.ok ? result.error ?? 'Failed to load body' : undefined);
  const pending = loading || (!result && !failText && !!request.cdpRequestId);

  if (pending) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-pulse-muted py-2">
        <Loader2 size={12} className="animate-spin" />
        Loading…
      </div>
    );
  }

  if (failText) {
    return (
      <div className="rounded-lg border border-pulse-red/40 bg-pulse-red/10 px-3 py-2">
        <div className="font-mono text-[11px] text-pulse-red break-all">{failText}</div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-1.5 flex items-center gap-1 text-[11px] text-pulse-muted hover:text-pulse-accent transition-colors"
        >
          <RefreshCw size={11} />
          Retry
        </button>
      </div>
    );
  }

  if (!result || result.body === undefined || result.body === '') {
    return <div className="text-[11px] text-pulse-muted py-1">{emptyText}</div>;
  }

  const mime = (result.mimeType ?? request.mimeType ?? '').toLowerCase();
  const isTextMime = TEXT_MIME_RE.test(mime);
  const isBinary = (result.base64Encoded && !isTextMime) || (!isTextMime && BINARY_MIME_RE.test(mime));
  const size = bodyBytes(result);
  const rawText = result.base64Encoded ? decodeBody(result) : result.body;
  const pretty = prettyBody(rawText, mime || undefined);
  const showJson = mime.includes('json') || pretty.isJson;
  const displayText = showJson || !isBinary ? pretty.text : rawText;

  const handleCopy = async () => {
    try {
      await copyText(displayText);
    } catch {
      // clipboard unavailable
    }
  };

  const handleDownload = () => {
    let bytes: Uint8Array<ArrayBuffer>;
    if (result.base64Encoded) {
      try {
        const binary = atob(result.body ?? '');
        bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      } catch {
        return;
      }
    } else {
      bytes = new TextEncoder().encode(result.body ?? '');
    }
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = fileNameFor(request, kind);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] text-pulse-accent truncate">
            {mime || 'unknown'}
          </span>
          <span className="font-mono text-[10px] text-pulse-muted tnum">{formatBytes(size)}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            title="Copy body"
            className="p-1 text-pulse-muted hover:text-pulse-accent transition-colors"
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            onClick={onRetry}
            title="Refresh body"
            className="p-1 text-pulse-muted hover:text-pulse-accent transition-colors"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {result.truncated && (
        <div className="text-[10px] text-pulse-yellow mb-1.5">
          Body truncated — only the first part is shown
        </div>
      )}

      {isBinary ? (
        <div className="rounded-lg border border-pulse-border bg-pulse-bg/60 px-3 py-2.5">
          <div className="font-mono text-[11px] text-pulse-muted">
            {kind === 'request' ? 'Binary request' : 'Binary response'} · {formatBytes(size)}
          </div>
          <button
            type="button"
            onClick={handleDownload}
            className="mt-2 flex items-center gap-1.5 text-[11px] text-pulse-accent hover:text-pulse-accentSoft transition-colors"
          >
            <Download size={12} />
            Download as file
          </button>
        </div>
      ) : showJson ? (
        <JsonViewer text={pretty.text} />
      ) : (
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-[420px] overflow-auto p-3 bg-pulse-bg/60 rounded-lg border border-pulse-border">
          {displayText}
        </pre>
      )}
    </div>
  );
}
