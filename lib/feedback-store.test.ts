import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { listFeedback, saveFeedback, setFeedbackStatus, watchFeedback } from './feedback-store';
import { makeSent } from './test-helpers';

describe('feedback store', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('keeps feedback per project', async () => {
    await saveFeedback('p1', [makeSent({ id: 'a' }), makeSent({ id: 'b' })]);
    await saveFeedback('p2', [makeSent({ id: 'c' })]);
    expect((await listFeedback('p1')).map((item) => item.id)).toEqual(['a', 'b']);
    expect((await listFeedback('p2')).map((item) => item.id)).toEqual(['c']);
    expect(await listFeedback('p3')).toEqual([]);
  });

  it('replaces an item saved twice instead of duplicating it', async () => {
    await saveFeedback('p1', [makeSent({ id: 'a', comment: 'old' }), makeSent({ id: 'b' })]);
    await saveFeedback('p1', [makeSent({ id: 'a', comment: 'new' })]);
    const stored = await listFeedback('p1');
    expect(stored.map((item) => [item.id, item.comment])).toEqual([
      ['a', 'new'],
      ['b', 'Make this bigger'],
    ]);
  });

  it('resolves and reopens one item', async () => {
    await saveFeedback('p1', [makeSent({ id: 'a' }), makeSent({ id: 'b' })]);
    await setFeedbackStatus('p1', 'a', 'resolved');
    expect((await listFeedback('p1')).map((item) => item.status)).toEqual(['resolved', 'open']);
    await setFeedbackStatus('p1', 'a', 'open');
    expect((await listFeedback('p1')).map((item) => item.status)).toEqual(['open', 'open']);
  });

  it('does not lose a change made while another is in flight', async () => {
    await saveFeedback('p1', [makeSent({ id: 'a' }), makeSent({ id: 'b' })]);
    await Promise.all([
      setFeedbackStatus('p1', 'a', 'resolved'),
      setFeedbackStatus('p1', 'b', 'resolved'),
    ]);
    expect((await listFeedback('p1')).map((item) => item.status)).toEqual(['resolved', 'resolved']);
  });

  it('notifies watchers of their project only', async () => {
    const callback = vi.fn();
    const unwatch = watchFeedback('p1', callback);
    await saveFeedback('p1', [makeSent({ id: 'a' })]);
    expect(callback).toHaveBeenLastCalledWith([makeSent({ id: 'a' })]);
    unwatch();
  });
});
