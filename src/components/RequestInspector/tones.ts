import type { StatusTone } from '../../inspector/format';

export const STATUS_TEXT_CLASS: Record<StatusTone, string> = {
  ok: 'text-pulse-green',
  redirect: 'text-pulse-accent',
  warn: 'text-pulse-yellow',
  error: 'text-pulse-red',
  muted: 'text-pulse-muted',
  pending: 'text-pulse-orange',
};

const METHOD_TEXT_CLASS: Record<string, string> = {
  GET: 'text-pulse-green',
  POST: 'text-pulse-yellow',
  PUT: 'text-pulse-orange',
  PATCH: 'text-pulse-orange',
  DELETE: 'text-pulse-red',
  HEAD: 'text-pulse-accent',
  OPTIONS: 'text-pulse-purple',
};

export function methodTextClass(method: string): string {
  return METHOD_TEXT_CLASS[method.toUpperCase()] ?? 'text-pulse-text';
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
