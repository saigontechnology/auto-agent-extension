import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { makeItem } from '../test-helpers';
import { MOCK_AUTHOR, createMockFeedbackApi } from './mock-feedback-api';

const home = { url: 'https://demo.web.app/home', path: '/home', title: 'Home' };
const about = { url: 'https://demo.web.app/about', path: '/about', title: 'About' };

describe('MockFeedbackApi', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns submitted items as open feedback from the mock author', async () => {
    const api = createMockFeedbackApi();
    const sent = await api.submit('p1', [makeItem({ id: 'a' })]);
    expect(sent).toEqual([{ ...makeItem({ id: 'a' }), author: MOCK_AUTHOR, status: 'open' }]);
  });

  it('lists by project and path', async () => {
    const api = createMockFeedbackApi();
    await api.submit('p1', [makeItem({ id: 'a', page: home }), makeItem({ id: 'b', page: about })]);
    await api.submit('p2', [makeItem({ id: 'c', page: home })]);
    expect((await api.list('p1', '/home')).map((item) => item.id)).toEqual(['a']);
    expect((await api.list('p1', '/about')).map((item) => item.id)).toEqual(['b']);
    expect(await api.list('p3', '/home')).toEqual([]);
  });

  it('does not duplicate an item that is submitted twice', async () => {
    const api = createMockFeedbackApi();
    await api.submit('p1', [makeItem({ id: 'a', page: home })]);
    const again = await api.submit('p1', [makeItem({ id: 'a', page: home })]);
    expect(again.map((item) => item.id)).toEqual(['a']);
    expect(await api.list('p1', '/home')).toHaveLength(1);
  });

  it('persists across instances', async () => {
    await createMockFeedbackApi().submit('p1', [makeItem({ id: 'a', page: home })]);
    expect(await createMockFeedbackApi().list('p1', '/home')).toHaveLength(1);
  });
});
