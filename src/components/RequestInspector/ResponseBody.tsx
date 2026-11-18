import type { NetworkBodyResult, NetworkRequest } from '../../network/types';
import BodyView from './BodyView';

interface ResponseBodyProps {
  request: NetworkRequest;
  result?: NetworkBodyResult;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}

export default function ResponseBody({ request, result, loading, error, onRetry }: ResponseBodyProps) {
  return (
    <BodyView
      request={request}
      kind="response"
      result={result}
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyText="Empty response body"
    />
  );
}
