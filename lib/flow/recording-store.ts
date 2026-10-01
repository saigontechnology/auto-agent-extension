import { storage } from '#imports';
import type { FlowStep, PageContext, Viewport } from '../types';
import { addStep } from './steps';
import type { Recording } from './types';

type RecordingMap = Record<string, Recording>;

/**
 * One recording per tab. Session storage keeps it while the service worker sleeps and clears
 * it when the browser closes. Content scripts cannot read session storage, so they learn the
 * state from the background's messages; the panel watches it directly.
 */
const recordingsItem = storage.defineItem<RecordingMap>('session:recordings', { fallback: {} });

// Serialises read-modify-write cycles: keystrokes arrive faster than storage writes finish.
let queue: Promise<unknown> = Promise.resolve();

function mutate(
  tabId: number,
  change: (current: Recording | null) => Recording | null,
): Promise<Recording | null> {
  const run = queue.then(async () => {
    const all = await recordingsItem.getValue();
    const key = String(tabId);
    const { [key]: current = null, ...rest } = all;
    const next = change(current);
    if (next !== current) await recordingsItem.setValue(next ? { ...rest, [key]: next } : rest);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function getRecording(tabId: number): Promise<Recording | null> {
  return (await recordingsItem.getValue())[String(tabId)] ?? null;
}

export function watchRecording(
  tabId: number,
  callback: (recording: Recording | null) => void,
): () => void {
  return recordingsItem.watch((all) => callback((all ?? {})[String(tabId)] ?? null));
}

export type StartInput = { tabId: number; context: PageContext; viewport: Viewport; now: Date };

/** Starts recording the tab, or returns the recording it already has, whatever its state. */
export async function startRecording(input: StartInput): Promise<Recording> {
  const { tabId, context, viewport, now } = input;
  const recording = await mutate(
    tabId,
    (current) =>
      current ?? {
        tabId,
        projectId: context.projectId,
        buildId: context.buildId,
        startPage: { url: context.url, path: context.path, title: context.title },
        viewport,
        status: 'recording',
        steps: [],
        startedAt: now.toISOString(),
      },
  );
  return recording as Recording;
}

export function recordStep(tabId: number, step: FlowStep, now: Date): Promise<Recording | null> {
  return mutate(tabId, (current) => {
    // A note comes from the reviewer, not the page, so it is kept while paused too.
    const open = current?.status === 'recording' || (current?.status === 'paused' && step.type === 'note');
    if (!current || !open) return current;
    const { steps, limitReached } = addStep(current.steps, step);
    if (!limitReached) return { ...current, steps };
    return { ...current, status: 'stopped', limitReached: true, endedAt: now.toISOString() };
  });
}

export function pauseRecording(tabId: number, reason: 'user' | 'left'): Promise<Recording | null> {
  return mutate(tabId, (current) =>
    current?.status === 'recording' ? { ...current, status: 'paused', pausedReason: reason } : current,
  );
}

export function resumeRecording(tabId: number): Promise<Recording | null> {
  return mutate(tabId, (current) => {
    if (current?.status !== 'paused') return current;
    const { pausedReason: _reason, ...rest } = current;
    return { ...rest, status: 'recording' };
  });
}

export function stopRecording(tabId: number, now: Date): Promise<Recording | null> {
  return mutate(tabId, (current) => {
    if (current?.status !== 'recording' && current?.status !== 'paused') return current;
    const { pausedReason: _reason, ...rest } = current;
    return { ...rest, status: 'stopped', endedAt: now.toISOString() };
  });
}

/** Puts a recording back into its tab, unless the tab has started another one meanwhile. */
export function putRecording(recording: Recording): Promise<Recording | null> {
  return mutate(recording.tabId, (current) => current ?? recording);
}

export async function removeRecording(tabId: number): Promise<Recording | null> {
  let removed: Recording | null = null;
  await mutate(tabId, (current) => {
    removed = current;
    return null;
  });
  return removed;
}
