import type { ReactNode } from 'react';
import { networkGraphStore, useNetworkGraphStore } from '../../graph/store';
import type { NetworkResourceType } from '../../network/types';

interface GraphFiltersBarProps {
  vertical?: boolean;
}

const TYPE_CHIPS: { type: NetworkResourceType; label: string }[] = [
  { type: 'document', label: 'Documents' },
  { type: 'script', label: 'JS' },
  { type: 'stylesheet', label: 'CSS' },
  { type: 'image', label: 'Images' },
  { type: 'font', label: 'Fonts' },
  { type: 'media', label: 'Media' },
];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded-full border transition-colors duration-150 whitespace-nowrap ${
        active
          ? 'bg-pulse-accent/15 border-pulse-accent/50 text-pulse-cream'
          : 'border-pulse-border text-pulse-muted hover:text-pulse-text hover:border-pulse-borderStrong'
      }`}
    >
      {children}
    </button>
  );
}

export default function GraphFiltersBar({ vertical }: GraphFiltersBarProps) {
  const filters = useNetworkGraphStore((s) => s.filters);
  const stats = useNetworkGraphStore((s) => s.stats);
  const { types, firstPartyOnly, thirdPartyOnly, errorsOnly } = filters;

  const allActive = types.length === 0 && !firstPartyOnly && !thirdPartyOnly && !errorsOnly;
  const xhrFetchActive = types.includes('xhr') && types.includes('fetch');
  const websocketActive = types.includes('websocket');

  const resetAll = () =>
    networkGraphStore.setFilters({
      types: [],
      firstPartyOnly: false,
      thirdPartyOnly: false,
      errorsOnly: false,
    });

  const toggleParty = (which: 'first' | 'third') => {
    const active = which === 'first' ? firstPartyOnly : thirdPartyOnly;
    if (active) {
      networkGraphStore.setFilters({ firstPartyOnly: false, thirdPartyOnly: false });
    } else {
      networkGraphStore.setFilters({
        firstPartyOnly: which === 'first',
        thirdPartyOnly: which === 'third',
        errorsOnly: false,
      });
    }
  };

  const clearParty = () => networkGraphStore.setFilters({ firstPartyOnly: false, thirdPartyOnly: false });

  const toggleErrors = () =>
    networkGraphStore.setFilters({
      errorsOnly: !errorsOnly,
      firstPartyOnly: false,
      thirdPartyOnly: false,
    });

  const toggleXhrFetch = () => {
    const rest = types.filter((t) => t !== 'xhr' && t !== 'fetch');
    networkGraphStore.setFilters({ types: xhrFetchActive ? rest : [...rest, 'xhr', 'fetch'] });
  };

  const errorsBadge = (
    <span className="ml-1 px-1 rounded bg-pulse-red/15 text-pulse-red text-[9px] font-mono tnum leading-none">
      {stats.errors}
    </span>
  );

  const typeChips = (
    <>
      {TYPE_CHIPS.map((chip) => (
        <Chip key={chip.type} active={types.includes(chip.type)} onClick={() => networkGraphStore.toggleTypeFilter(chip.type)}>
          {chip.label}
        </Chip>
      ))}
      <Chip active={xhrFetchActive} onClick={toggleXhrFetch}>
        Fetch/XHR
      </Chip>
      <Chip
        active={websocketActive}
        onClick={() => networkGraphStore.toggleTypeFilter('websocket')}
      >
        WebSocket
      </Chip>
    </>
  );

  if (vertical) {
    return (
      <div className="flex flex-col gap-2.5 text-[11px]">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-pulse-muted/70 mb-1.5">Types</div>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={types.length === 0} onClick={() => networkGraphStore.setFilters({ types: [] })}>
              All
            </Chip>
            {typeChips}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-pulse-muted/70 mb-1.5">Party</div>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={!firstPartyOnly && !thirdPartyOnly} onClick={clearParty}>
              All
            </Chip>
            <Chip active={firstPartyOnly} onClick={() => toggleParty('first')}>
              First-party
            </Chip>
            <Chip active={thirdPartyOnly} onClick={() => toggleParty('third')}>
              Third-party
            </Chip>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-pulse-muted/70 mb-1.5">Show</div>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={errorsOnly} onClick={toggleErrors}>
              Errors{errorsBadge}
            </Chip>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] min-w-max">
      <Chip active={allActive} onClick={resetAll}>
        All
      </Chip>
      <span className="w-px h-4 bg-pulse-border/60 shrink-0" />
      {typeChips}
      <span className="w-px h-4 bg-pulse-border/60 shrink-0" />
      <Chip active={firstPartyOnly} onClick={() => toggleParty('first')}>
        First-party
      </Chip>
      <Chip active={thirdPartyOnly} onClick={() => toggleParty('third')}>
        Third-party
      </Chip>
      <Chip active={errorsOnly} onClick={toggleErrors}>
        Errors{errorsBadge}
      </Chip>
    </div>
  );
}
