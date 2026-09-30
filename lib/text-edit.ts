import type { Anchor, FeedbackItem } from './types';

export type TextEdit = { before: string; after: string };

export type TextEditChange =
  | { type: 'create'; textEdit: TextEdit }
  | { type: 'update'; id: string; textEdit: TextEdit }
  | { type: 'remove'; id: string };

/**
 * Decides what an inline edit means for the drafts. Editing the same element again
 * amends its existing draft, so the tool sees one change from the original text.
 */
export function planTextEdit(
  existing: FeedbackItem | undefined,
  before: string,
  after: string,
): TextEditChange | null {
  // Opening the editor and leaving the text alone is never an edit. This matters after a
  // reload, when the page shows the original text again next to an existing draft.
  if (before === after) return null;
  if (!existing?.textEdit) return { type: 'create', textEdit: { before, after } };
  const original = existing.textEdit.before;
  if (after === original) return { type: 'remove', id: existing.id };
  if (after === existing.textEdit.after) return null;
  return { type: 'update', id: existing.id, textEdit: { before: original, after } };
}

/**
 * The text-edit draft that already covers an element of the page at `path`. Drafts of other
 * pages are skipped: their anchors can resolve to a look-alike element on this page.
 */
export function findTextEditDraft(
  drafts: FeedbackItem[],
  path: string,
  matches: (anchor: Anchor) => boolean,
): FeedbackItem | undefined {
  return drafts.find(
    (draft) =>
      draft.kind === 'text-edit' &&
      draft.page.path === path &&
      draft.anchor !== undefined &&
      matches(draft.anchor),
  );
}
