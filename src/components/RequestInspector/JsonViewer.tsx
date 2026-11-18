import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from './tones';

const TOKEN_RE = /("(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
const PLAIN_LIMIT = 500_000;

function tokenizeLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  TOKEN_RE.lastIndex = 0;
  let lastIndex = 0;
  let keyIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <span key={`g${keyIndex}`} className="text-pulse-textMuted">
          {line.slice(lastIndex, match.index)}
        </span>,
      );
    }
    const token = match[0];
    const rest = line.slice(match.index + token.length);
    const isKey = /^\s*:/.test(rest);
    let cls = 'text-pulse-yellow';
    if (token[0] === '"') cls = isKey ? 'text-pulse-accent' : 'text-pulse-green';
    else if (token === 'true' || token === 'false') cls = 'text-pulse-orange';
    else if (token === 'null') cls = 'text-pulse-muted';
    nodes.push(
      <span key={`t${keyIndex}`} className={cls}>
        {token}
      </span>,
    );
    lastIndex = match.index + token.length;
    keyIndex += 1;
  }

  if (lastIndex < line.length) {
    nodes.push(
      <span key="tail" className="text-pulse-textMuted">
        {line.slice(lastIndex)}
      </span>,
    );
  }
  return nodes;
}

interface JsonViewerProps {
  text: string;
  maxHeight?: number;
}

export default function JsonViewer({ text, maxHeight = 420 }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await copyText(text);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const plain = text.length > PLAIN_LIMIT;
  const lines = plain ? [] : text.split('\n');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleCopy}
        title="Copy"
        className="absolute right-2 top-2 z-10 p-1 rounded text-pulse-muted hover:text-pulse-accent transition-colors"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <pre
        className="font-mono text-[11px] leading-relaxed overflow-auto p-3 bg-pulse-bg/60 rounded-lg border border-pulse-border"
        style={{ maxHeight }}
      >
        {plain
          ? text
          : lines.map((line, idx) => (
              <Fragment key={idx}>
                {idx > 0 && '\n'}
                {tokenizeLine(line)}
              </Fragment>
            ))}
      </pre>
    </div>
  );
}
