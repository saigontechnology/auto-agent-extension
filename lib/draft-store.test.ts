import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  addDraft,
  listDrafts,
  removeDraft,
  removeDrafts,
  updateDraft,
  watchDrafts,
} from './draft-store';
import { makeItem } from './test-helpers';

describe('draft-store', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('starts empty', async () => {
    expect(await listDrafts('p1')).toEqual([]);
  });

  it('keeps drafts separate per project', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await addDraft('p2', makeItem({ id: 'b' }));
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['a']);
    expect((await listDrafts('p2')).map((d) => d.id)).toEqual(['b']);
  });

  it('keeps both drafts when two are added without awaiting', async () => {
    await Promise.all([
      addDraft('p1', makeItem({ id: 'a' })),
      addDraft('p1', makeItem({ id: 'b' })),
    ]);
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('updates the comment of one draft', async () => {
    await addDraft('p1', makeItem({ id: 'a', comment: 'old' }));
    await addDraft('p1', makeItem({ id: 'b', comment: 'keep' }));
    await updateDraft('p1', 'a', { comment: 'new' });
    expect((await listDrafts('p1')).map((d) => d.comment)).toEqual(['new', 'keep']);
  });

  it('removes one draft', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await addDraft('p1', makeItem({ id: 'b' }));
    await removeDraft('p1', 'a');
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['b']);
  });

  it('removes many drafts and ignores unknown ids', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await addDraft('p1', makeItem({ id: 'b' }));
    await addDraft('p1', makeItem({ id: 'c' }));
    await removeDrafts('p1', ['a', 'c', 'zzz']);
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['b']);
  });

  it('notifies watchers of their own project only', async () => {
    const onP1 = vi.fn();
    const unwatch = watchDrafts('p1', onP1);
    await addDraft('p1', makeItem({ id: 'a' }));
    expect(onP1).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a' })]);
    await removeDraft('p1', 'a');
    expect(onP1).toHaveBeenLastCalledWith([]);
    unwatch();
    await addDraft('p1', makeItem({ id: 'b' }));
    expect(onP1).toHaveBeenCalledTimes(2);
  });
});
