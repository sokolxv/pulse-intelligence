import { useState, useEffect, useRef } from 'react';
import { X, ChevronUp, ChevronDown, Search } from 'lucide-react';

interface FindBarProps {
  onClose: () => void;
  onFind: (query: string, options: { caseSensitive: boolean; forward: boolean }) => void;
  matchCount: number;
  currentMatch: number;
}

export default function FindBar({ onClose, onFind, matchCount, currentMatch }: FindBarProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!query.trim()) return;
    const t = setTimeout(() => {
      onFind(query, { caseSensitive, forward: true });
    }, 250);
    return () => clearTimeout(t);
  }, [query, caseSensitive, onFind]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onFind(query, { caseSensitive, forward: false });
      } else {
        onFind(query, { caseSensitive, forward: true });
      }
    }
  };

  const navigate = (forward: boolean) => {
    if (query.trim()) {
      onFind(query, { caseSensitive, forward });
    }
  };

  return (
    <div className="absolute top-2 right-4 z-50 flex items-center gap-1.5 pl-3 pr-2 py-1.5 glass rounded-full shadow-card rise-in">
      <Search size={14} className="text-pulse-muted/60 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in page..."
        className="w-48 bg-transparent border-0 px-1 py-1 text-sm font-mono text-pulse-text placeholder-pulse-muted/50 outline-none"
        spellCheck={false}
      />
      <div className="flex items-center justify-center gap-1 text-[10px] font-mono tnum text-pulse-muted/70 min-w-[52px]">
        {query.trim() ? (
          <span>
            {matchCount > 0 ? `${currentMatch}/${matchCount}` : 'No matches'}
          </span>
        ) : null}
      </div>
      <button
        onClick={() => navigate(false)}
        className="w-6 h-6 flex items-center justify-center rounded-full text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel/70 transition-colors"
        title="Previous match"
        disabled={matchCount === 0}
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={() => navigate(true)}
        className="w-6 h-6 flex items-center justify-center rounded-full text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel/70 transition-colors"
        title="Next match"
        disabled={matchCount === 0}
      >
        <ChevronDown size={14} />
      </button>
      <button
        onClick={() => setCaseSensitive(!caseSensitive)}
        className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition-colors ${
          caseSensitive
            ? 'bg-pulse-accent/15 text-pulse-accentSoft border border-pulse-accent/20'
            : 'text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel/70'
        }`}
        title="Case sensitive"
      >
        Aa
      </button>
      <button
        onClick={onClose}
        className="w-6 h-6 flex items-center justify-center rounded-full text-pulse-muted hover:text-pulse-red hover:bg-pulse-red/10 transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}
