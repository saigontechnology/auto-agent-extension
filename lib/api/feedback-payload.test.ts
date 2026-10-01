import { describe, expect, it } from 'vitest';
import { feedbackFileName } from './feedback-payload';

describe('feedbackFileName', () => {
  it('names the file after the project and the time, safe for any file system', () => {
    expect(feedbackFileName('127.0.0.1:4173', new Date('2026-10-01T04:27:46.111Z'))).toBe(
      'auto-agent-feedback-127.0.0.1-4173-2026-10-01T04-27-46-111Z.json',
    );
  });
});
