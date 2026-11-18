import { useMemo } from 'react';
import type { NetworkRequest } from '../../network/types';
import { formatFrames, resolveInitiatorChain } from '../../network/InitiatorResolver';
import { urlPath } from '../../inspector/format';

interface InitiatorViewProps {
  request: NetworkRequest;
  requests: NetworkRequest[];
  pageUrl: string | null;
  onRequestSelect: (id: string) => void;
}

const FRAME_LIMIT = 8;

export default function InitiatorView({
  request,
  requests,
  pageUrl,
  onRequestSelect,
}: InitiatorViewProps) {
  const frames = useMemo(() => formatFrames(request).slice(0, FRAME_LIMIT), [request]);
  const chain = useMemo(
    () => resolveInitiatorChain(request, requests, pageUrl),
    [request, requests, pageUrl],
  );

  const hasInitiator = chain.length > 0 || frames.length > 1;

  if (!hasInitiator) {
    return (
      <div className="rounded-lg border border-pulse-border/60 bg-pulse-bg/60 px-3 py-2.5">
        <div className="text-[11px] text-pulse-text">No initiator information</div>
        <div className="text-[11px] text-pulse-muted mt-1">
          This request was loaded directly by the page (parser, preload or navigation).
        </div>
      </div>
    );
  }

  const rootText = frames[0]?.text ?? `${request.method} ${urlPath(request.url)}`;
  const callSites = frames.slice(1);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-pulse-muted mb-1.5">
          Initiated by:
        </div>
        <div className="font-mono text-[11px]">
          <div className="font-semibold text-pulse-cream">{rootText}</div>
          {callSites.map((frame, idx) => {
            const frameIndex = idx + 1;
            const targetId =
              frame.requestId ??
              requests.find((r) => r.url === frame.url)?.id ??
              chain[Math.max(0, frameIndex - 1)]?.requestId;
            return (
              <div
                key={`${frame.url}-${frameIndex}`}
                style={{ paddingLeft: `${frame.depth * 4}ch` }}
                className="flex items-start"
              >
                <span className="text-pulse-muted shrink-0">└── </span>
                {targetId ? (
                  <button
                    type="button"
                    onClick={() => onRequestSelect(targetId)}
                    className="text-pulse-text hover:text-pulse-accent hover:underline text-left break-all"
                  >
                    {frame.text}
                  </button>
                ) : (
                  <span className="text-pulse-text break-all">{frame.text}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-pulse-muted mb-1.5">Source:</div>
        <div className="space-y-2">
          {chain.map((entry, idx) => (
            <div
              key={`${entry.url}-${idx}`}
              onClick={entry.requestId ? () => onRequestSelect(entry.requestId as string) : undefined}
              className={
                entry.requestId
                  ? 'cursor-pointer rounded px-1 -mx-1 hover:bg-pulse-surfaceHover transition-colors'
                  : 'px-1 -mx-1'
              }
            >
              <div
                className={`font-mono text-[11px] break-all ${
                  entry.requestId ? 'text-pulse-text hover:text-pulse-accent' : 'text-pulse-text'
                }`}
              >
                {entry.label}
              </div>
              <div className="font-mono text-[10px] text-pulse-muted break-all">{entry.url}</div>
              {entry.frame?.functionName && (
                <div className="font-mono text-[10px] text-pulse-accent/80 break-all">
                  {entry.frame.functionName}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
