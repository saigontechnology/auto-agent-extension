import { storage } from '#imports';
import type { SentFeedback } from '../types';
import type { FeedbackApi } from './feedback-api';

export const MOCK_AUTHOR = { id: 'mock-user', name: 'You (mock)' };

const mockItem = storage.defineItem<Record<string, SentFeedback[]>>('local:mock-feedback', {
  fallback: {},
});

/** Stands in for the tool's API until the real one exists. Data stays in this browser. */
export function createMockFeedbackApi(): FeedbackApi {
  return {
    async submit(projectId, items) {
      const all = await mockItem.getValue();
      const stored = all[projectId] ?? [];
      const known = new Set(stored.map((item) => item.id));
      const created = items
        .filter((item) => !known.has(item.id))
        .map((item): SentFeedback => ({ ...item, author: MOCK_AUTHOR, status: 'open' }));
      const next = [...stored, ...created];
      await mockItem.setValue({ ...all, [projectId]: next });
      const ids = new Set(items.map((item) => item.id));
      return next.filter((item) => ids.has(item.id));
    },

    async list(projectId, path) {
      const all = await mockItem.getValue();
      return (all[projectId] ?? []).filter((item) => item.page.path === path);
    },
  };
}
