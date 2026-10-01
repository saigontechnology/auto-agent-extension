import { storage } from '#imports';
import type { SentFeedback } from './types';

type FeedbackMap = Record<string, SentFeedback[]>;
export type FeedbackStatus = SentFeedback['status'];

/**
 * Sent feedback, kept per project in this browser until the tool has a database to read it
 * back from.
 */
const feedbackItem = storage.defineItem<FeedbackMap>('local:feedback', { fallback: {} });

// Serialises read-modify-write cycles so two quick changes in one context cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

function mutate(
  projectId: string,
  change: (items: SentFeedback[]) => SentFeedback[],
): Promise<void> {
  const run = queue.then(async () => {
    const all = await feedbackItem.getValue();
    const { [projectId]: current = [], ...rest } = all;
    const next = change(current);
    await feedbackItem.setValue(next.length > 0 ? { ...rest, [projectId]: next } : rest);
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function listFeedback(projectId: string): Promise<SentFeedback[]> {
  return (await feedbackItem.getValue())[projectId] ?? [];
}

/** Adds sent items, replacing any already stored under the same id. */
export function saveFeedback(projectId: string, items: SentFeedback[]): Promise<void> {
  const incoming = new Map(items.map((item) => [item.id, item]));
  return mutate(projectId, (stored) => {
    const kept = stored.map((item) => incoming.get(item.id) ?? item);
    const known = new Set(stored.map((item) => item.id));
    return [...kept, ...items.filter((item) => !known.has(item.id))];
  });
}

export function setFeedbackStatus(
  projectId: string,
  id: string,
  status: FeedbackStatus,
): Promise<void> {
  return mutate(projectId, (items) =>
    items.map((item) => (item.id === id ? { ...item, status } : item)),
  );
}

export function watchFeedback(
  projectId: string,
  callback: (items: SentFeedback[]) => void,
): () => void {
  return feedbackItem.watch((all) => callback((all ?? {})[projectId] ?? []));
}
