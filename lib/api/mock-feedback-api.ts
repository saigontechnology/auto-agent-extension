import type { SentFeedback } from '../types';
import type { FeedbackApi } from './feedback-api';

export const MOCK_AUTHOR = { id: 'mock-user', name: 'You (mock)' };

/** Stands in for the tool's API until the real one exists: every draft is accepted as open. */
export function createMockFeedbackApi(): FeedbackApi {
  return {
    async submit(_projectId, items) {
      return items.map((item): SentFeedback => ({ ...item, author: MOCK_AUTHOR, status: 'open' }));
    },
  };
}
