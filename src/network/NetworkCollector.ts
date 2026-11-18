import { networkEventBus } from './NetworkEventBus';
import type {
  NetworkBodyKind,
  NetworkBodyResult,
  NetworkCollectorStatusPayload,
} from './types';

export function startNetworkCapture(): void {
  networkEventBus.start();
}

export async function bindWebview(
  tabId: string,
  wcId: number | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await networkEventBus.bindTab(tabId, wcId ?? -1);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function unbindWebview(tabId: string, wcId: number | null): void {
  try {
    networkEventBus.unbindTab(tabId, wcId ?? -1);
  } catch {}
}

export function fetchNetworkBody(
  wcId: number,
  cdpRequestId: string,
  kind: NetworkBodyKind,
): Promise<NetworkBodyResult> {
  return networkEventBus.getBody(wcId, cdpRequestId, kind);
}

export function getCollectorStatus(): Promise<NetworkCollectorStatusPayload> {
  return networkEventBus.getStatus();
}
