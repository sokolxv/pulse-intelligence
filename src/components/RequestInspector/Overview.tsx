import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { NetworkRequest } from '../../network/types';
import {
  formatBytes,
  formatDuration,
  prettyHeaders,
  queryParams,
  statusLabel,
  statusTone,
} from '../../inspector/format';
import { STATUS_TEXT_CLASS, methodTextClass } from './tones';

interface OverviewProps {
  request: NetworkRequest;
  thirdParty: boolean;
}

function shortId(id: string): string {
  const parts = id.split(':');
  return parts[parts.length - 1] ?? id;
}

function startedLabel(startTime: number): string {
  const date = new Date(startTime);
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.toLocaleTimeString()}.${ms}`;
}

export default function Overview({ request, thirdParty }: OverviewProps) {
  const rows: Array<{ label: string; value: ReactNode }> = [
    {
      label: 'Status',
      value: (
        <span className={STATUS_TEXT_CLASS[statusTone(request.status, request.state)]}>
          {statusLabel(request.status, request.statusText, request.state)}
        </span>
      ),
    },
    { label: 'Duration', value: <span className="tnum">{formatDuration(request.duration)}</span> },
    {
      label: 'Size',
      value: (
        <span className="tnum">
          {formatBytes(request.responseSize)}
          {request.requestSize && request.requestSize > 0 && request.method.toUpperCase() !== 'GET'
            ? ` · sent ${formatBytes(request.requestSize)}`
            : ''}
        </span>
      ),
    },
    {
      label: 'Type',
      value: `${request.type}${request.cdpType ? ` · ${request.cdpType}` : ''}`,
    },
    { label: 'Domain', value: request.domain },
    { label: 'Method', value: <span className={methodTextClass(request.method)}>{request.method}</span> },
    { label: 'Protocol', value: request.protocol ?? '—' },
    { label: 'Remote IP', value: request.remoteIPAddress ?? '—' },
    { label: 'MIME', value: request.mimeType ?? '—' },
    { label: 'Cache', value: request.cache === undefined ? '—' : request.cache ? 'Yes' : 'No' },
    { label: 'Priority', value: request.priority ?? '—' },
    { label: 'Started', value: <span className="tnum">{startedLabel(request.startTime)}</span> },
    {
      label: 'Redirects',
      value: request.redirectedFrom ? `#${shortId(request.redirectedFrom)}` : '—',
    },
    { label: 'State', value: request.state },
    {
      label: 'Party',
      value: (
        <span className={thirdParty ? 'badge-yellow' : 'badge-green'}>
          {thirdParty ? 'Third party' : 'First party'}
        </span>
      ),
    },
  ];

  const params = queryParams(request.url);
  const cookieHeader = Object.entries(request.requestHeaders ?? {}).find(
    ([name]) => name.toLowerCase() === 'cookie',
  )?.[1];
  const headerCount = prettyHeaders(request.responseHeaders).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <div className="text-[10px] uppercase tracking-widest text-pulse-muted pt-0.5">
              {row.label}
            </div>
            <div className="font-mono text-[11px] text-pulse-text min-w-0 break-all">
              {row.value}
            </div>
          </Fragment>
        ))}
      </div>

      {params.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-pulse-muted mb-1">
            Query parameters
          </div>
          <div className="divide-y divide-pulse-border/40">
            {params.map((param, idx) => (
              <div key={`${param.name}-${idx}`} className="flex items-start gap-2 py-1.5">
                <span className="w-[140px] shrink-0 font-mono text-[11px] text-pulse-accent break-all">
                  {param.name}
                </span>
                <span className="flex-1 min-w-0 font-mono text-[11px] text-pulse-text break-all">
                  {param.value || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 text-[10px] text-pulse-muted font-mono tnum">
        <span>{headerCount} response headers</span>
        {cookieHeader !== undefined && <span>Cookie header present</span>}
      </div>
    </div>
  );
}
