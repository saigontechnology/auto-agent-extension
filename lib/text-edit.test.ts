import { describe, expect, it } from 'vitest';
import { makeItem } from './test-helpers';
import { planTextEdit } from './text-edit';

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
