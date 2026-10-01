/*
 * Runs inside the page's own JavaScript world, so it must not import extension APIs and must
 * never throw: an exception here would surface as the page's own error.
 */

export const PROBE_TAG = 'vibe-flow-probe';

export type ProbeEvent =
  | { kind: 'console'; source: 'error' | 'exception' | 'rejection'; message: string; stack?: string }
  | { kind: 'network'; method: string; url: string; status: number | null };

export type ProbeMessage = { tag: typeof PROBE_TAG; event: ProbeEvent };

export function formatValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // Circular structures, BigInts and hostile toJSON methods end up here.
  }
  try {
    return String(value);
  } catch {
    return '[unprintable]';
  }
}

export function formatArgs(args: unknown[]): { message: string; stack?: string } {
  const message = args.map(formatValue).join(' ');
  const error = args.find((arg): arg is Error => arg instanceof Error);
  return error?.stack ? { message, stack: error.stack } : { message };
}

export function isFailedStatus(status: number): boolean {
  return status >= 400;
}

export function absoluteUrl(url: string | URL, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return String(url);
  }
}
