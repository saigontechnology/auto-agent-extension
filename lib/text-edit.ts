import type { FeedbackItem } from './types';

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
  if (!existing?.textEdit) {
    return before === after ? null : { type: 'create', textEdit: { before, after } };
  }
  const original = existing.textEdit.before;
  if (after === original) return { type: 'remove', id: existing.id };
  if (after === existing.textEdit.after) return null;
  return { type: 'update', id: existing.id, textEdit: { before: original, after } };
}
