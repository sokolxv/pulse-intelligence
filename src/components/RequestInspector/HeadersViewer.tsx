import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { prettyHeaders } from '../../inspector/format';
import { copyText } from './tones';

const LONG_VALUE = 120;

interface HeadersViewerProps {
  title: string;
  headers: Record<string, string> | undefined;
  emptyText?: string;
}

export default function HeadersViewer({ title, headers, emptyText }: HeadersViewerProps) {
  const rows = prettyHeaders(headers);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const flashCopied = (key: string) => {
    setCopiedKey(key);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopiedKey(null), 1200);
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await copyText(text);
      flashCopied(key);
    } catch {
      setCopiedKey(null);
    }
  };

  const copyAllText = rows.map((row) => `${row.name}: ${row.value}`).join('\n');

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h4 className="text-[10px] uppercase tracking-widest text-pulse-muted">{title}</h4>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => handleCopy('__all__', copyAllText)}
            className="flex items-center gap-1 text-[10px] text-pulse-muted hover:text-pulse-accent transition-colors"
          >
            {copiedKey === '__all__' ? <Check size={11} /> : <Copy size={11} />}
            Copy all
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-[11px] text-pulse-muted">{emptyText ?? 'No headers captured'}</div>
      ) : (
        <div className="divide-y divide-pulse-border/40">
          {rows.map((row) => {
            const isLong = row.value.length > LONG_VALUE;
            const isOpen = !!expanded[row.name];
            const shown = isLong && !isOpen ? `${row.value.slice(0, LONG_VALUE)}…` : row.value;
            return (
              <div key={row.name} className="flex items-start gap-2 py-1.5">
                <span className="w-[140px] shrink-0 font-mono text-[11px] text-pulse-accent break-all">
                  {row.name}
                </span>
                <span className="flex-1 min-w-0 font-mono text-[11px] text-pulse-text break-all">
                  {shown}
                  {isLong && (
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => ({ ...prev, [row.name]: !isOpen }))}
                      className="ml-1 text-pulse-muted hover:text-pulse-accent transition-colors"
                    >
                      {isOpen ? 'show less' : 'show more'}
                    </button>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(row.name, row.value)}
                  title="Copy header"
                  className="p-0.5 shrink-0 text-pulse-muted hover:text-pulse-accent transition-colors"
                >
                  {copiedKey === row.name ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
