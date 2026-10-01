import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { storage } from '#imports';
import { getRecording, watchRecording } from '@/lib/flow/recording-store';
import { stepAnchor } from '@/lib/flow/step-label';
import type { Recording } from '@/lib/flow/types';
import type { PanelToContent } from '@/lib/messages';
import type { Anchor, FlowStep, PageContext, SentFeedback } from '@/lib/types';

/** The recording of the tab this panel reviews, kept up to date as steps arrive. */
export function useRecording(tabId: number | null): Recording | null {
  const [recording, setRecording] = useState<Recording | null>(null);

  useEffect(() => {
    if (tabId === null) {
      setRecording(null);
      return;
    }
    let active = true;
    void getRecording(tabId).then((current) => {
      if (active) setRecording(current);
    });
    const unwatch = watchRecording(tabId, setRecording);
    return () => {
      active = false;
      unwatch();
    };
  }, [tabId]);

  return recording;
}

/** The current time, refreshed every `intervalMs`, for elapsed-time displays. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

type PendingGoTo = { path: string; key: string; anchor: Anchor };

/**
 * A step to show once its page has loaded. The embedded panel is a new page after a full
 * navigation, so the request waits in session storage rather than in memory.
 */
const goToItem = storage.defineItem<Record<string, PendingGoTo>>('session:go-to', { fallback: {} });

export function useGoTo(
  tabId: number | null,
  context: PageContext | null,
  send: (message: PanelToContent) => void,
): (item: SentFeedback, step: FlowStep) => void {
  useEffect(() => {
    if (tabId === null || !context) return;
    void goToItem.getValue().then(async (all) => {
      const key = String(tabId);
      const pending = all[key];
      if (!pending || pending.path !== context.path) return;
      const { [key]: _done, ...rest } = all;
      await goToItem.setValue(rest);
      send({ type: 'show-anchor', key: pending.key, anchor: pending.anchor, scroll: true });
    });
  }, [tabId, context, send]);

  return useCallback(
    (item: SentFeedback, step: FlowStep) => {
      const anchor = stepAnchor(step);
      if (tabId === null || !context || !anchor) return;
      if (step.path === context.path) {
        send({ type: 'show-anchor', key: step.id, anchor, scroll: true });
        return;
      }
      // The step's path comes from the server, so it must not lead the tab off the item's site.
      let target: URL;
      try {
        target = new URL(step.path, item.page.url);
        if (target.origin !== new URL(item.page.url).origin) return;
      } catch {
        return;
      }
      const key = String(tabId);
      void goToItem
        .getValue()
        .then(async (all) => {
          await goToItem.setValue({ ...all, [key]: { path: step.path, key: step.id, anchor } });
          await browser.tabs.update(tabId, { url: target.href });
        })
        .catch(async () => {
          // A request left behind would fire on some later visit to that path.
          try {
            const { [key]: _failed, ...rest } = await goToItem.getValue();
            await goToItem.setValue(rest);
          } catch {
            // Nothing more to do; the entry is only a pending hint.
          }
        });
    },
    [tabId, context, send],
  );
}
