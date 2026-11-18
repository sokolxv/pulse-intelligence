import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { GraphNode, InspectorSection } from '../../graph/types';
import type { NetworkBodyKind, NetworkBodyResult, NetworkRequest } from '../../network/types';
import {
  formatBytes,
  formatDuration,
  statusLabel,
  statusTone,
  urlPath,
} from '../../inspector/format';
import Overview from './Overview';
import HeadersViewer from './HeadersViewer';
import RequestBody from './RequestBody';
import ResponseBody from './ResponseBody';
import InitiatorView from './InitiatorView';
import TimelineViewer from './TimelineViewer';
import RawView from './RawView';
import { STATUS_TEXT_CLASS, methodTextClass } from './tones';

export interface RequestInspectorProps {
  node: GraphNode | null;
  requests: NetworkRequest[];
  pageUrl: string | null;
  section: InspectorSection;
  onSectionChange: (s: InspectorSection) => void;
  onRequestSelect: (requestId: string) => void;
  onClose: () => void;
  onFetchBody: (kind: NetworkBodyKind) => Promise<NetworkBodyResult>;
}

type DetailSection = Exclude<InspectorSection, 'auto'>;

const TABS: Array<{ id: DetailSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'request', label: 'Request' },
  { id: 'response', label: 'Response' },
  { id: 'initiator', label: 'Initiator' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'raw', label: 'Raw' },
];

const AGGREGATE_KINDS: ReadonlySet<GraphNode['kind']> = new Set(['page', 'domain', 'cluster']);
const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const KIND_META: Record<GraphNode['kind'], { label: string; dot: string }> = {
  page: { label: 'PAGE', dot: 'bg-pulse-accent' },
  domain: { label: 'DOMAIN', dot: 'bg-pulse-purple' },
  js: { label: 'JS', dot: 'bg-pulse-yellow' },
  api: { label: 'API', dot: 'bg-pulse-green' },
  resource: { label: 'RESOURCE', dot: 'bg-pulse-orange' },
  websocket: { label: 'WS', dot: 'bg-pulse-accentSoft' },
  cluster: { label: 'CLUSTER', dot: 'bg-pulse-muted' },
};

function isThirdParty(request: NetworkRequest): boolean {
  if (!request.origin) return false;
  try {
    return new URL(request.origin).hostname !== request.domain;
  } catch {
    return false;
  }
}

function isErrored(request: NetworkRequest): boolean {
  return (
    request.state === 'failed' ||
    request.state === 'canceled' ||
    (request.status !== undefined && request.status >= 400)
  );
}

function Chip({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 border rounded px-2 py-1 ${
        danger ? 'border-pulse-red/40 bg-pulse-red/10' : 'border-pulse-border/60 bg-pulse-panel/50'
      }`}
    >
      <span className="text-[9px] uppercase tracking-widest text-pulse-muted">{label}</span>
      <span
        className={`font-mono text-[11px] tnum ${danger ? 'text-pulse-red' : 'text-pulse-text'}`}
      >
        {value}
      </span>
    </div>
  );
}

function MemberRow({
  request,
  onSelect,
}: {
  request: NetworkRequest;
  onSelect: (id: string) => void;
}) {
  const error = isErrored(request);
  return (
    <button
      type="button"
      onClick={() => onSelect(request.id)}
      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-pulse-surfaceHover transition-colors border-l-2 ${
        error ? 'border-l-pulse-red' : 'border-l-transparent'
      }`}
    >
      <span
        className={`w-11 shrink-0 font-mono text-[10px] font-bold ${methodTextClass(request.method)}`}
      >
        {request.method}
      </span>
      <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-pulse-text">
        {urlPath(request.url) || '/'}
      </span>
      <span
        className={`shrink-0 font-mono text-[10px] tnum ${
          STATUS_TEXT_CLASS[statusTone(request.status, request.state)]
        }`}
      >
        {statusLabel(request.status, request.statusText, request.state)}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[10px] tnum text-pulse-muted">
        {formatDuration(request.duration)}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[10px] tnum text-pulse-muted">
        {formatBytes(request.responseSize)}
      </span>
    </button>
  );
}

export default function RequestInspector({
  node,
  requests,
  pageUrl,
  section,
  onSectionChange,
  onRequestSelect,
  onClose,
  onFetchBody,
}: RequestInspectorProps) {
  const [bodies, setBodies] = useState<Record<string, NetworkBodyResult>>({});
  const [loadingBodies, setLoadingBodies] = useState<Record<string, boolean>>({});
  const bodiesRef = useRef<Record<string, NetworkBodyResult>>({});
  const inFlightRef = useRef<Set<string>>(new Set());

  const loadBody = useCallback(
    async (request: NetworkRequest, kind: NetworkBodyKind, force = false) => {
      if (!request.cdpRequestId) return;
      const key = `${request.id}:${kind}`;
      if (inFlightRef.current.has(key)) return;
      if (!force && bodiesRef.current[key]) return;
      inFlightRef.current.add(key);
      setLoadingBodies((prev) => ({ ...prev, [key]: true }));
      try {
        const result = await onFetchBody(kind);
        const next = { ...bodiesRef.current, [key]: result };
        bodiesRef.current = next;
        setBodies(next);
      } catch (err) {
        const failed: NetworkBodyResult = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        const next = { ...bodiesRef.current, [key]: failed };
        bodiesRef.current = next;
        setBodies(next);
      } finally {
        inFlightRef.current.delete(key);
        setLoadingBodies((prev) => {
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
      }
    },
    [onFetchBody],
  );

  const representative = useMemo(() => {
    if (!node) return null;
    if (node.request) return node.request;
    for (const id of node.requestIds) {
      const found = requests.find((r) => r.id === id);
      if (found) return found;
    }
    return null;
  }, [node, requests]);

  const members = useMemo(() => {
    if (!node || !AGGREGATE_KINDS.has(node.kind)) return [];
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (id?: string) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    };
    add(node.request?.id);
    node.requestIds.forEach(add);
    (node.children ?? []).forEach(add);
    const out: NetworkRequest[] = [];
    for (const id of ids) {
      const found = requests.find((r) => r.id === id);
      if (found) out.push(found);
    }
    return out;
  }, [node, requests]);

  const active: DetailSection = section === 'auto' ? 'overview' : section;
  const representativeId = representative?.id;

  useEffect(() => {
    if (!representative || !representativeId) return;
    if (active === 'response' || active === 'raw') {
      void loadBody(representative, 'response');
    } else if (active === 'request') {
      const method = representative.method.toUpperCase();
      if (WRITE_METHODS.has(method) && (representative.requestSize ?? 0) > 0) {
        void loadBody(representative, 'request');
      }
    }
  }, [representative, representativeId, active, loadBody]);

  if (!node) return null;

  const kindMeta = KIND_META[node.kind];
  const isAggregate = AGGREGATE_KINDS.has(node.kind);
  const sublabel = node.sublabel ?? representative?.url ?? '';

  const bodyResult = (id: string, kind: NetworkBodyKind) => bodies[`${id}:${kind}`];
  const bodyLoading = (id: string, kind: NetworkBodyKind) => !!loadingBodies[`${id}:${kind}`];
  const bodyError = (id: string, kind: NetworkBodyKind) => {
    const result = bodies[`${id}:${kind}`];
    return result && !result.ok ? result.error ?? 'Failed to load body' : undefined;
  };

  const header = (
    <div className="flex items-start gap-2 px-3 pt-2.5 pb-2 border-b border-pulse-border/60">
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 border border-pulse-border/60 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-pulse-muted">
          <span className={`w-1.5 h-1.5 rounded-full ${kindMeta.dot}`} />
          {kindMeta.label}
        </span>
        <div className="font-mono text-[13px] text-pulse-cream truncate mt-1.5">{node.label}</div>
        {sublabel && (
          <div className="font-mono text-[10px] text-pulse-muted truncate">{sublabel}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        title="Close inspector"
        className="p-1 shrink-0 text-pulse-muted hover:text-pulse-accent transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );

  if (isAggregate) {
    const errorCount = members.filter(isErrored).length;
    const thirdPartyCount = members.filter(isThirdParty).length;
    const totalBytes = members.reduce((sum, r) => sum + (r.responseSize ?? 0), 0);
    const totalDuration = members.reduce((sum, r) => sum + (r.duration ?? 0), 0);

    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-pulse-border/60">
          <Chip label="Requests" value={String(members.length)} />
          <Chip label="Errors" value={String(errorCount)} danger={errorCount > 0} />
          <Chip label="Third-party" value={String(thirdPartyCount)} />
          <Chip label="Transferred" value={formatBytes(totalBytes)} />
          <Chip label="Duration" value={formatDuration(totalDuration)} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-pulse-border/30">
          {members.slice(0, 300).map((member) => (
            <MemberRow key={member.id} request={member} onSelect={onRequestSelect} />
          ))}
          {members.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-pulse-muted">
              No requests available for this node
            </div>
          )}
          {members.length > 300 && (
            <div className="px-3 py-2 text-[10px] text-pulse-muted tnum">
              Showing 300 of {members.length} requests
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!representative) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex-1 min-h-0 flex items-center justify-center px-4">
          <div className="text-[11px] text-pulse-muted">Request data no longer available</div>
        </div>
      </div>
    );
  }

  const errorBanner =
    representative.state === 'failed' ? (
      <div className="mx-3 mt-2 rounded-lg border border-pulse-red/40 bg-pulse-red/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-pulse-red">
          <AlertTriangle size={12} />
          Request failed
        </div>
        <div className="font-mono text-[11px] text-pulse-red/80 break-all mt-0.5">
          {representative.errorText ?? 'Unknown error'}
        </div>
      </div>
    ) : (representative.status ?? 0) >= 400 ? (
      <div className="mx-3 mt-2 rounded-lg border border-pulse-red/40 bg-pulse-red/10 px-3 py-2">
        <div className="font-mono text-[13px] font-semibold text-pulse-red">
          HTTP {statusLabel(representative.status, representative.statusText)}
        </div>
        <div className="text-[10px] text-pulse-muted mt-0.5">
          Response headers and body are available in the Response tab
        </div>
      </div>
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      {errorBanner}
      <div className="flex items-center gap-0.5 px-2 pt-2 border-b border-pulse-border/60 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSectionChange(tab.id)}
            className={`px-2.5 py-1.5 text-[11px] whitespace-nowrap border-b-2 transition-colors ${
              active === tab.id
                ? 'text-pulse-accent border-pulse-accent font-semibold'
                : 'text-pulse-muted border-transparent hover:text-pulse-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {active === 'overview' && (
          <Overview request={representative} thirdParty={node.thirdParty} />
        )}

        {active === 'request' && (
          <>
            <HeadersViewer
              title="Request headers"
              headers={representative.requestHeaders}
              emptyText="No request headers captured"
            />
            <RequestBody
              request={representative}
              result={bodyResult(representative.id, 'request')}
              loading={bodyLoading(representative.id, 'request')}
              error={bodyError(representative.id, 'request')}
              onRetry={() => void loadBody(representative, 'request', true)}
            />
          </>
        )}

        {active === 'response' && (
          <>
            <HeadersViewer
              title="Response headers"
              headers={representative.responseHeaders}
              emptyText="No response headers captured"
            />
            <ResponseBody
              request={representative}
              result={bodyResult(representative.id, 'response')}
              loading={bodyLoading(representative.id, 'response')}
              error={bodyError(representative.id, 'response')}
              onRetry={() => void loadBody(representative, 'response', true)}
            />
          </>
        )}

        {active === 'initiator' && (
          <InitiatorView
            request={representative}
            requests={requests}
            pageUrl={pageUrl}
            onRequestSelect={onRequestSelect}
          />
        )}

        {active === 'timeline' && <TimelineViewer request={representative} />}

        {active === 'raw' && (
          <RawView
            request={representative}
            requestBody={bodyResult(representative.id, 'request')}
            responseBody={bodyResult(representative.id, 'response')}
          />
        )}
      </div>
    </div>
  );
}
