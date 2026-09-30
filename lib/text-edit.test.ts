import { describe, expect, it } from 'vitest';
import { makeItem } from './test-helpers';
import { findTextEditDraft, planTextEdit } from './text-edit';

const existing = makeItem({ id: 'e1', kind: 'text-edit', textEdit: { before: 'Buy', after: 'Order' } });

describe('planTextEdit', () => {
  it('creates a draft for a first edit', () => {
    expect(planTextEdit(undefined, 'Buy', 'Order')).toEqual({
      type: 'create',
      textEdit: { before: 'Buy', after: 'Order' },
    });
  });

  it('does nothing when the text did not change', () => {
    expect(planTextEdit(undefined, 'Buy', 'Buy')).toBeNull();
  });

  it('amends the existing draft and keeps the original text as before', () => {
    expect(planTextEdit(existing, 'Order', 'Order now')).toEqual({
      type: 'update',
      id: 'e1',
      textEdit: { before: 'Buy', after: 'Order now' },
    });
  });

  it('removes the draft when the text is edited back to the original', () => {
    expect(planTextEdit(existing, 'Order', 'Buy')).toEqual({ type: 'remove', id: 'e1' });
  });

  it('does nothing when a re-edit leaves the text as it was', () => {
    expect(planTextEdit(existing, 'Order', 'Order')).toBeNull();
  });

  it('allows clearing the text', () => {
    expect(planTextEdit(undefined, 'Buy', '')).toEqual({
      type: 'create',
      textEdit: { before: 'Buy', after: '' },
    });
  });
});

describe('planTextEdit after a reload', () => {
  it('keeps the draft when the restored original text is left unchanged', () => {
    // The page shows the original again after a reload; opening and closing the editor is not an edit.
    expect(planTextEdit(existing, 'Buy', 'Buy')).toBeNull();
  });

  it('still amends the draft when the restored original is edited again', () => {
    expect(planTextEdit(existing, 'Buy', 'Purchase')).toEqual({
      type: 'update',
      id: 'e1',
      textEdit: { before: 'Buy', after: 'Purchase' },
    });
  });
});

describe('findTextEditDraft', () => {
  const home = makeItem({ id: 'home', kind: 'text-edit', textEdit: { before: 'A', after: 'A2' } });
  const about = makeItem({
    id: 'about',
    kind: 'text-edit',
    textEdit: { before: 'B', after: 'B2' },
    page: { url: 'https://demo.web.app/about', path: '/about', title: 'About' },
  });
  const comment = makeItem({ id: 'comment', kind: 'element' });

  it('finds the text-edit draft of the current page whose anchor matches', () => {
    expect(findTextEditDraft([comment, home, about], '/home', () => true)).toBe(home);
  });

  it('ignores a draft from another page even when its anchor would match here', () => {
    expect(findTextEditDraft([about], '/home', () => true)).toBeUndefined();
  });

  it('ignores drafts whose anchor does not match', () => {
    expect(findTextEditDraft([home], '/home', () => false)).toBeUndefined();
  });

  it('ignores element comments on the same element', () => {
    expect(findTextEditDraft([comment], '/home', () => true)).toBeUndefined();
  });
});
