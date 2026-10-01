import { defineContentScript } from '#imports';
import {
  MAX_PROBE_BUFFER,
  MAX_REPORT,
  PROBE_READY_TAG,
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
 *
 * Events are reported via CustomEvent dispatched to the document. A string detail crosses
 * from the page's world to the extension's isolated world; objects do not.
 *
 * The isolated content script only starts listening once the document has loaded, and events
 * are not queued, so reports are held here until it says it is ready.
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    const dispatch = (message: ProbeMessage) => {
      document.dispatchEvent(new CustomEvent(PROBE_TAG, { detail: JSON.stringify(message) }));
    };

    let ready = false;
    let held: ProbeMessage[] = [];
    document.addEventListener(PROBE_READY_TAG, () => {
      try {
        if (ready) return;
        ready = true;
        const messages = held;
        held = [];
        messages.forEach(dispatch);
      } catch {
        // Never let reporting break the page.
      }
    });

    const report = (event: ProbeEvent) => {
      try {
        const message: ProbeMessage = { tag: PROBE_TAG, event };
        if (ready) dispatch(message);
        else if (held.length < MAX_PROBE_BUFFER) held.push(message);
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
        const message = error instanceof Error ? `${error.name}: ${error.message}` : event.message;
        report({
          kind: 'console',
          source: 'exception',
          message: message.slice(0, MAX_REPORT),
          ...(error instanceof Error && error.stack ? { stack: error.stack.slice(0, MAX_REPORT) } : {}),
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
      let method: string;
      let url: string;
      try {
        method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        url = input instanceof Request ? input.url : absoluteUrl(input, location.href);
      } catch {
        // Metadata computation failed; call through and skip reporting.
        return originalFetch.call(window, input, init);
      }
      try {
        const response = await originalFetch.call(window, input, init);
        if (isFailedStatus(response.status)) report({ kind: 'network', method, url, status: response.status });
        return response;
      } catch (error) {
        report({ kind: 'network', method, url, status: null });
        throw error;
      }
    };

    const xhrMetadata = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      let method: string;
      let url: string;
      try {
        method = String(args[0] ?? 'GET');
        url = absoluteUrl(args[1] as string | URL, location.href);
      } catch {
        // Metadata computation failed; call through and skip reporting.
        return (originalOpen as (...openArgs: unknown[]) => void).apply(this, args);
      }

      // Update or add metadata for this XHR.
      const isNew = !xhrMetadata.has(this);
      xhrMetadata.set(this, { method, url });

      // Add loadend listener only on first open() call.
      if (isNew) {
        this.addEventListener('loadend', () => {
          const metadata = xhrMetadata.get(this);
          if (!metadata) return;
          // Status 0 means the request never got a response: network error, CORS or abort.
          const status = this.status === 0 ? null : this.status;
          if (status === null || isFailedStatus(status)) {
            report({ kind: 'network', method: metadata.method, url: metadata.url, status });
          }
        });
      }

      return (originalOpen as (...openArgs: unknown[]) => void).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;
  },
});
