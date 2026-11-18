import type { NetworkRequest } from '../../network/types';
import { buildTimeline, formatDuration } from '../../inspector/format';

const TONE_COLORS: Record<'block' | 'dns' | 'connect' | 'secure' | 'send' | 'wait' | 'download', string> = {
  block: '#71717B',
  dns: '#A79BB2',
  connect: '#B99776',
  secure: '#C8A87E',
  send: '#F5F5F7',
  wait: '#8CA58A',
  download: '#A79BB2',
};

interface TimelineViewerProps {
  request: NetworkRequest;
}

export default function TimelineViewer({ request }: TimelineViewerProps) {
  const { total, segments } = buildTimeline(request);

  if (segments.length === 0) {
    return (
      <div className="space-y-2">
        <div className="text-[11px] text-pulse-muted">
          Timing information not available for this request
        </div>
        {request.duration !== undefined && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-pulse-muted">Duration</span>
            <span className="font-mono tnum text-pulse-text">{formatDuration(request.duration)}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-6 rounded overflow-hidden flex bg-pulse-bg/60">
        {segments.map((segment) => {
          const width = total > 0 ? ((segment.end - segment.start) / total) * 100 : 0;
          return (
            <div
              key={segment.key}
              title={`${segment.label} ${segment.start}–${segment.end} ms`}
              style={{ width: `${width}%`, backgroundColor: TONE_COLORS[segment.tone] }}
            />
          );
        })}
      </div>

      <div className="space-y-1">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center gap-2 text-[11px]">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: TONE_COLORS[segment.tone] }}
            />
            <span className="w-16 shrink-0 text-pulse-text">{segment.label}</span>
            <span className="flex-1 text-right font-mono tnum text-pulse-muted">
              {segment.start}–{segment.end} ms
            </span>
            <span className="w-16 shrink-0 text-right font-mono tnum text-pulse-text">
              {formatDuration(segment.end - segment.start)}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2 text-[11px] font-semibold border-t border-pulse-border/40 pt-1.5 mt-1.5">
          <span className="w-2 h-2 rounded-sm shrink-0 bg-pulse-accent" />
          <span className="w-16 shrink-0 text-pulse-cream">Total</span>
          <span className="flex-1 text-right font-mono tnum text-pulse-muted">
            0–{total} ms
          </span>
          <span className="w-16 shrink-0 text-right font-mono tnum text-pulse-cream">
            {formatDuration(total)}
          </span>
        </div>
      </div>
    </div>
  );
}
