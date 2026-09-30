import { describe, expect, it } from 'vitest';
import { groupDrafts, locationLabel, pagePins } from './pins';
import { makeItem, makeSent } from './test-helpers';

const about = { url: 'https://demo.web.app/about', path: '/about', title: 'About' };

describe('pagePins', () => {
  it('numbers drafts first, then sent items', () => {
    const pins = pagePins(
      [makeItem({ id: 'd1' }), makeItem({ id: 'd2' })],
      [makeSent({ id: 's1' })],
      '/home',
    );
    expect(pins.map((pin) => [pin.number, pin.id, pin.state])).toEqual([
      [1, 'd1', 'draft'],
      [2, 'd2', 'draft'],
      [3, 's1', 'sent'],
    ]);
  });

  it('skips items from other pages', () => {
    const pins = pagePins([makeItem({ id: 'd1', page: about })], [makeSent({ id: 's1' })], '/home');
    expect(pins.map((pin) => pin.id)).toEqual(['s1']);
  });

  it('skips page-level comments, which have no anchor', () => {
    const pageComment = makeItem({ id: 'd1', kind: 'page', anchor: undefined });
    expect(pagePins([pageComment], [], '/home')).toEqual([]);
  });

  it('skips resolved sent items', () => {
    expect(pagePins([], [makeSent({ id: 's1', status: 'resolved' })], '/home')).toEqual([]);
  });

  it('shows an item once when it is both a draft and already sent', () => {
    const pins = pagePins([makeItem({ id: 'x' })], [makeSent({ id: 'x' })], '/home');
    expect(pins.map((pin) => [pin.id, pin.state])).toEqual([['x', 'sent']]);
  });
});

describe('groupDrafts', () => {
  it('groups by path with the current page first', () => {
    const groups = groupDrafts(
      [
        makeItem({ id: 'a', page: about }),
        makeItem({ id: 'b' }),
        makeItem({ id: 'c', page: about }),
      ],
      '/home',
    );
    expect(groups.map((group) => [group.path, group.items.map((item) => item.id)])).toEqual([
      ['/home', ['b']],
      ['/about', ['a', 'c']],
    ]);
  });

  it('returns no groups for no drafts', () => {
    expect(groupDrafts([], '/home')).toEqual([]);
  });
});

describe('locationLabel', () => {
  it('prefers the element source, then the nearest source, then the selector', () => {
    const anchor = makeItem().anchor!;
    expect(locationLabel(makeItem())).toBe('src/pages/Home.tsx:12');
    expect(
      locationLabel(makeItem({ anchor: { ...anchor, source: undefined, nearestSource: 'src/App.tsx:3' } })),
    ).toBe('src/App.tsx:3');
    expect(locationLabel(makeItem({ anchor: { ...anchor, source: undefined } }))).toBe('#title');
  });

  it('labels page-level comments', () => {
    expect(locationLabel(makeItem({ kind: 'page', anchor: undefined }))).toBe('Whole page');
  });
});
