import { describe, expect, it } from 'vitest';
import { createItem, currentEnv } from './feedback-factory';
import { makeItem } from './test-helpers';
import type { PageContext } from './types';

const context: PageContext = {
  projectId: 'proj_1',
  buildId: 'build_9',
  path: '/home',
  url: 'https://demo.web.app/home',
  title: 'Home',
};
const env = {
  id: 'id-1',
  now: new Date('2026-09-30T10:00:00.000Z'),
  viewport: { width: 1280, height: 720, dpr: 2 },
};

describe('createItem', () => {
  it('builds an element comment stamped with the build and page', () => {
    const anchor = makeItem().anchor!;
    expect(createItem({ kind: 'element', comment: '  Too small ', context, anchor }, env)).toEqual({
      id: 'id-1',
      buildId: 'build_9',
      kind: 'element',
      comment: 'Too small',
      page: { url: 'https://demo.web.app/home', path: '/home', title: 'Home' },
      anchor,
      viewport: { width: 1280, height: 720, dpr: 2 },
      createdAt: '2026-09-30T10:00:00.000Z',
    });
  });

  it('builds a page comment without an anchor', () => {
    const item = createItem({ kind: 'page', comment: 'Missing back button', context }, env);
    expect(item).not.toHaveProperty('anchor');
    expect(item).not.toHaveProperty('textEdit');
  });

  it('carries the text edit', () => {
    const item = createItem(
      { kind: 'text-edit', comment: '', context, anchor: makeItem().anchor, textEdit: { before: 'Buy', after: 'Order' } },
      env,
    );
    expect(item.textEdit).toEqual({ before: 'Buy', after: 'Order' });
    expect(item.comment).toBe('');
  });
});

describe('currentEnv', () => {
  it('reads the viewport and generates a fresh id', () => {
    const first = currentEnv(window);
    const second = currentEnv(window);
    expect(first.id).not.toBe(second.id);
    expect(first.viewport).toEqual({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    });
  });
});
