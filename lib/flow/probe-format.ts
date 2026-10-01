/*
 * Runs inside the page's own JavaScript world, so it must not import extension APIs and must
 * never throw: an exception here would surface as the page's own error.
 */

export const PROBE_TAG = 'vibe-flow-probe';
/** Sent by the isolated content script once it listens, so the probe can hand over what it held. */
export const PROBE_READY_TAG = 'vibe-flow-probe-ready';
/** Reports the probe holds until the content script listens; later ones are dropped. */
export const MAX_PROBE_BUFFER = 50;
export const MAX_REPORT = 4000;

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
  const message = args.map(formatValue).join(' ').slice(0, MAX_REPORT);
  const error = args.find((arg): arg is Error => arg instanceof Error);
  return error?.stack ? { message, stack: error.stack.slice(0, MAX_REPORT) } : { message };
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
