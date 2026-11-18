import type { NetworkBodyResult, NetworkRequest } from '../../network/types';
import BodyView from './BodyView';

interface RequestBodyProps {
  request: NetworkRequest;
  result?: NetworkBodyResult;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}

export default function RequestBody({ request, result, loading, error, onRetry }: RequestBodyProps) {
  const method = request.method.toUpperCase();
  const noBodyExpected = !request.requestSize && (method === 'GET' || method === 'HEAD');

  if (noBodyExpected) {
    return <div className="text-[11px] text-pulse-muted py-1">No request body</div>;
  }

  return (
    <BodyView
      request={request}
      kind="request"
      result={result}
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyText="No request body"
    />
  );
}
