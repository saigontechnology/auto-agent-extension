import { defineContentScript } from '#imports';
import {
  PROBE_TAG,
  type ProbeEvent,
  type ProbeMessage,
  absoluteUrl,
  formatArgs,
  isFailedStatus,
} from '@/lib/flow/probe-format';

/*
 * Runs in the page's own world, from the very start of the document, so a workflow recording
 * also sees errors raised while a page loads. Every wrapper calls straight through to the
 * original and never changes what the page gets back. The isolated content script decides
 * whether a report is kept: only while the tab is recording.
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    const report = (event: ProbeEvent) => {
      try {
        const message: ProbeMessage = { tag: PROBE_TAG, event };
        window.postMessage(message, '*');
      } catch {
        // Never let reporting break the page.
      }
    };

    const originalError = console.error;
    console.error = function (this: Console, ...args: unknown[]) {
      try {
        report({ kind: 'console', source: 'error', ...formatArgs(args) });
      } catch {
        // Formatting must not stop the page's own logging.
      }
      return originalError.apply(this, args);
    };

    window.addEventListener('error', (event) => {
      try {
        const error: unknown = event.error;
        report({
          kind: 'console',
          source: 'exception',
          message: error instanceof Error ? `${error.name}: ${error.message}` : event.message,
          ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        });
      } catch {
        // See above.
      }
    });

    window.addEventListener('unhandledrejection', (event) => {
      try {
        report({ kind: 'console', source: 'rejection', ...formatArgs([event.reason]) });
      } catch {
        // See above.
      }
    });

    const originalFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const url = input instanceof Request ? input.url : absoluteUrl(input, location.href);
      try {
        const response = await originalFetch.call(window, input, init);
        if (isFailedStatus(response.status)) report({ kind: 'network', method, url, status: response.status });
        return response;
      } catch (error) {
        report({ kind: 'network', method, url, status: null });
        throw error;
      }
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      const method = String(args[0] ?? 'GET');
      const url = absoluteUrl(args[1] as string | URL, location.href);
      this.addEventListener('loadend', () => {
        // Status 0 means the request never got a response: network error, CORS or abort.
        const status = this.status === 0 ? null : this.status;
        if (status === null || isFailedStatus(status)) report({ kind: 'network', method, url, status });
      });
      return (originalOpen as (...openArgs: unknown[]) => void).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;
  },
});
