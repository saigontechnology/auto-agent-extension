import { truncate } from '../text';
import type { FlowAction } from '../types';
import { PROBE_TAG, type ProbeEvent, type ProbeMessage } from './probe-format';
import { MAX_MESSAGE } from './steps';

const SOURCES: ReadonlySet<string> = new Set(['error', 'exception', 'rejection']);

/** Checks a `message` event's data, which any script on the page could have posted. */
export function isProbeMessage(data: unknown): data is ProbeMessage {
  const message = data as Partial<ProbeMessage> | null;
  if (typeof message !== 'object' || message === null || message.tag !== PROBE_TAG) return false;
  const event = message.event as Record<string, unknown> | undefined;
  if (typeof event !== 'object' || event === null) return false;
  if (event.kind === 'console') {
    return (
      typeof event.source === 'string' &&
      SOURCES.has(event.source) &&
      typeof event.message === 'string' &&
      (event.stack === undefined || typeof event.stack === 'string')
    );
  }
  if (event.kind === 'network') {
    return (
      typeof event.method === 'string' &&
      typeof event.url === 'string' &&
      (event.status === null || typeof event.status === 'number')
    );
  }
  return false;
}

export function probeAction(event: ProbeEvent): FlowAction | null {
  if (event.kind === 'console') {
    return {
      type: 'console',
      source: event.source,
      message: truncate(event.message, MAX_MESSAGE),
      ...(event.stack ? { stack: truncate(event.stack, MAX_MESSAGE) } : {}),
      count: 1,
    };
  }
  if (event.url.startsWith('chrome-extension:')) return null;
  return { type: 'network', method: event.method.toUpperCase(), url: event.url, status: event.status, count: 1 };
}
