import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentScriptContext } from '#imports';
import { browser } from 'wxt/browser';
import { REQUIRE_PREVIEW_MARKERS } from '@/lib/config';
import { currentEnv } from '@/lib/feedback-factory';
import { CAPTURED_EVENTS, actionFromEvent, navigationCause } from '@/lib/flow/capture';
import { probeAction, probeMessageFromEvent } from '@/lib/flow/probe-events';
import { PROBE_READY_TAG, PROBE_TAG } from '@/lib/flow/probe-format';
import { type RecordingState, isRecordingState } from '@/lib/flow/types';
import { type FlowContentMessage, isFlowStatus } from '@/lib/messages';
import { readPageContext, routePath } from '@/lib/page-context';
import type { FlowAction, FlowStep, PageContext } from '@/lib/types';

const IDLE: RecordingState = { status: 'none', steps: 0 };

function toBackground(message: FlowContentMessage): Promise<RecordingState | null> {
  return browser.runtime.sendMessage(message).then(
    (reply: unknown) => (isRecordingState(reply) ? reply : null),
    () => null,
  );
}

function makeStep(action: FlowAction): FlowStep {
  return { ...action, id: crypto.randomUUID(), at: new Date().toISOString(), path: routePath(location) };
}

/**
 * Records the reviewer's actions on this page while the background says the tab is recording.
 * The main-world probe holds the errors a page reports while it loads until this hook says it
 * is listening; those, and anything else captured before the background has answered, are held
 * here until that answer, so they land after the navigate step the background records first.
 */
export function useFlowRecorder(ctx: ContentScriptContext, host: HTMLElement) {
  const [state, setState] = useState<RecordingState>(IDLE);
  const recordingRef = useRef(false);
  recordingRef.current = state.status === 'recording';
  // Steps captured before the background's first answer; null once it has answered.
  const pendingRef = useRef<FlowStep[] | null>([]);

  const sendStep = useCallback((step: FlowStep) => {
    void toBackground({ type: 'flow-step', step }).then((reply) => {
      if (reply) setState(reply);
    });
  }, []);

  const record = useCallback(
    (action: FlowAction) => {
      const step = makeStep(action);
      if (pendingRef.current) pendingRef.current.push(step);
      else if (recordingRef.current) sendStep(step);
    },
    [sendStep],
  );

  useEffect(() => {
    const hello = (navigation: 'load' | 'reload' | 'history') => {
      const context = readPageContext(document, location, { requireMarkers: REQUIRE_PREVIEW_MARKERS });
      void toBackground({ type: 'flow-hello', context, url: location.href, navigation }).then((reply) => {
        const held = pendingRef.current ?? [];
        pendingRef.current = null;
        if (!reply) return;
        setState(reply);
        // The background has recorded the navigation by now, so held errors land after it.
        if (reply.status === 'recording') held.forEach(sendStep);
      });
    };
    hello(navigationCause(performance.getEntriesByType('navigation')[0]));

    // A page restored from the back/forward cache keeps this script but is a new step, and
    // errors right after the restore must wait for it like they do on a load.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      pendingRef.current = [];
      hello('history');
    };
    // After an extension reload this script lives on in the page but can no longer reach it.
    const onStatus = (message: unknown) => {
      if (ctx.isInvalid) return;
      if (isFlowStatus(message)) setState(message.state);
    };
    const onProbe = (event: Event) => {
      if (ctx.isInvalid) return;
      const message = probeMessageFromEvent(event);
      const action = message && probeAction(message.event);
      if (action) record(action);
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener(PROBE_TAG, onProbe);
    // Lets the probe hand over what the page reported before this script was listening.
    document.dispatchEvent(new CustomEvent(PROBE_READY_TAG));
    browser.runtime.onMessage.addListener(onStatus);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener(PROBE_TAG, onProbe);
      browser.runtime.onMessage.removeListener(onStatus);
    };
  }, [ctx, record, sendStep]);

  // Listening on window in the capture phase sees events before the page can stop them.
  useEffect(() => {
    if (state.status !== 'recording') return;
    const onEvent = (event: Event) => {
      if (ctx.isInvalid) return;
      const action = actionFromEvent(event, host);
      if (action) record(action);
    };
    for (const type of CAPTURED_EVENTS) window.addEventListener(type, onEvent, true);
    return () => {
      for (const type of CAPTURED_EVENTS) window.removeEventListener(type, onEvent, true);
    };
  }, [ctx, state.status, host, record]);

  // Same-document route changes. The event fires before the new URL is committed, for a full
  // page load (which the next page reports itself), and for replaceState and query-only changes,
  // so only a route path that has changed by the next task counts.
  useEffect(() => {
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      const before = routePath(location);
      ctx.setTimeout(() => {
        if (recordingRef.current && routePath(location) !== before) {
          record({ type: 'navigate', url: location.href, cause: 'route' });
        }
      }, 0);
    });
  }, [ctx, record]);

  const start = useCallback((context: PageContext) => {
    void toBackground({ type: 'flow-start', context, viewport: currentEnv(window).viewport }).then((reply) => {
      if (reply) setState(reply);
    });
  }, []);

  return { state, start };
}
