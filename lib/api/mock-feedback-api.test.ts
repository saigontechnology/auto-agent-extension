import { describe, expect, it } from 'vitest';
import { makeItem } from '../test-helpers';
import { MOCK_AUTHOR, createMockFeedbackApi } from './mock-feedback-api';

describe('MockFeedbackApi', () => {
  it('returns submitted items as open feedback from the mock author', async () => {
    const api = createMockFeedbackApi();
    const sent = await api.submit('p1', [makeItem({ id: 'a' })]);
    expect(sent).toEqual([{ ...makeItem({ id: 'a' }), author: MOCK_AUTHOR, status: 'open' }]);
  });
});
