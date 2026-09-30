import type { FeedbackItem, SentFeedback } from './types';

export function makeItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'item-1',
    buildId: 'build_1',
    kind: 'element',
    comment: 'Make this bigger',
    page: { url: 'https://demo.web.app/home', path: '/home', title: 'Home' },
    anchor: {
      source: 'src/pages/Home.tsx:12',
      selector: '#title',
      tag: 'h1',
      text: 'Welcome',
      html: '<h1 id="title">Welcome</h1>',
      rect: { x: 0, y: 0, width: 100, height: 20 },
    },
    viewport: { width: 1280, height: 720, dpr: 2 },
    createdAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

export function makeSent(overrides: Partial<SentFeedback> = {}): SentFeedback {
  return {
    ...makeItem(),
    author: { id: 'u1', name: 'Ada' },
    status: 'open',
    ...overrides,
  };
}
