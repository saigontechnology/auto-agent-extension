import type { FeedbackItem, SentFeedback } from './types';

export type Pin = {
  id: string;
  number: number;
  state: 'draft' | 'sent';
  item: FeedbackItem | SentFeedback;
};

/**
 * The numbered pins for one page: anchored drafts first, then open sent items.
 * The review panel and the on-page pin layer both use this so their numbers agree.
 */
export function pagePins(drafts: FeedbackItem[], sent: SentFeedback[], path: string): Pin[] {
  const sentIds = new Set(sent.map((item) => item.id));
  const onPage = (item: FeedbackItem) => item.anchor !== undefined && item.page.path === path;

  const draftPins = drafts
    .filter((item) => onPage(item) && !sentIds.has(item.id))
    .map((item) => ({ id: item.id, state: 'draft' as const, item }));
  const sentPins = sent
    .filter((item) => onPage(item) && item.status === 'open')
    .map((item) => ({ id: item.id, state: 'sent' as const, item }));

  return [...draftPins, ...sentPins].map((pin, index) => ({ ...pin, number: index + 1 }));
}

export type DraftGroup = { path: string; items: FeedbackItem[] };

/** Groups drafts by page, with the page currently open first. */
export function groupDrafts(drafts: FeedbackItem[], currentPath: string): DraftGroup[] {
  const groups = new Map<string, FeedbackItem[]>();
  for (const draft of drafts) {
    const items = groups.get(draft.page.path) ?? [];
    items.push(draft);
    groups.set(draft.page.path, items);
  }
  return Array.from(groups, ([path, items]) => ({ path, items })).sort(
    (a, b) => Number(b.path === currentPath) - Number(a.path === currentPath),
  );
}

/** A short description of where a feedback item points, for list rows and tooltips. */
export function locationLabel(item: FeedbackItem): string {
  const { anchor } = item;
  if (!anchor) return 'Whole page';
  return anchor.source ?? anchor.nearestSource ?? anchor.selector;
}
