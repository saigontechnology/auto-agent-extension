import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentScriptContext } from '#imports';
import { browser } from 'wxt/browser';
import { REQUIRE_PREVIEW_MARKERS } from '@/lib/config';
import { currentEnv } from '@/lib/feedback-factory';
import { CAPTURED_EVENTS, actionFromEvent, navigationCause } from '@/lib/flow/capture';
import { probeAction, probeMessageFromEvent } from '@/lib/flow/probe-events';
import { PROBE_TAG } from '@/lib/flow/probe-format';
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
 * Errors the page reports before the background has answered are held back, so a recording
 * also catches what goes wrong while a page loads.
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

    // A page restored from the back/forward cache keeps this script but is a new step.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) hello('history');
    };
    const onStatus = (message: unknown) => {
      if (isFlowStatus(message)) setState(message.state);
    };
    const onProbe = (event: Event) => {
      const message = probeMessageFromEvent(event);
      const action = message && probeAction(message.event);
      if (action) record(action);
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener(PROBE_TAG, onProbe);
    browser.runtime.onMessage.addListener(onStatus);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener(PROBE_TAG, onProbe);
      browser.runtime.onMessage.removeListener(onStatus);
    };
  }, [record, sendStep]);

  // Listening on window in the capture phase sees events before the page can stop them.
  useEffect(() => {
    if (state.status !== 'recording') return;
    const onEvent = (event: Event) => {
      const action = actionFromEvent(event, host);
      if (action) record(action);
    };
    for (const type of CAPTURED_EVENTS) window.addEventListener(type, onEvent, true);
    return () => {
      for (const type of CAPTURED_EVENTS) window.removeEventListener(type, onEvent, true);
    };
  }, [state.status, host, record]);

  // Same-document route changes. The event fires before the new URL is committed, and also
  // for a full page load (which the next page reports itself), so only a URL that has changed
  // by the next task counts.
  useEffect(() => {
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      const before = location.href;
      ctx.setTimeout(() => {
        if (recordingRef.current && location.href !== before) {
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
