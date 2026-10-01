import { storage } from '#imports';
import type { FeedbackItem } from './types';

type DraftMap = Record<string, FeedbackItem[]>;
export type DraftPatch = Partial<Pick<FeedbackItem, 'comment' | 'textEdit' | 'flow'>>;

const draftsItem = storage.defineItem<DraftMap>('local:drafts', { fallback: {} });

// Serialises read-modify-write cycles so two quick saves in one context cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

function mutate(
  projectId: string,
  change: (drafts: FeedbackItem[]) => FeedbackItem[],
): Promise<void> {
  const run = queue.then(async () => {
    const all = await draftsItem.getValue();
    const { [projectId]: current = [], ...rest } = all;
    const next = change(current);
    await draftsItem.setValue(next.length > 0 ? { ...rest, [projectId]: next } : rest);
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function listDrafts(projectId: string): Promise<FeedbackItem[]> {
  return (await draftsItem.getValue())[projectId] ?? [];
}

export function addDraft(projectId: string, item: FeedbackItem): Promise<void> {
  return mutate(projectId, (drafts) => [...drafts, item]);
}

export function updateDraft(projectId: string, id: string, patch: DraftPatch): Promise<void> {
  return mutate(projectId, (drafts) =>
    drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
  );
}

export function removeDraft(projectId: string, id: string): Promise<void> {
  return removeDrafts(projectId, [id]);
}

export function removeDrafts(projectId: string, ids: string[]): Promise<void> {
  const gone = new Set(ids);
  return mutate(projectId, (drafts) => drafts.filter((draft) => !gone.has(draft.id)));
}

export function watchDrafts(
  projectId: string,
  callback: (drafts: FeedbackItem[]) => void,
): () => void {
  return draftsItem.watch((all) => callback((all ?? {})[projectId] ?? []));
}
