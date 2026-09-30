import type { FeedbackItem, SentFeedback } from '../types';

export interface FeedbackApi {
  /** Sends drafts to the tool. Resending an item with the same id must not duplicate it. */
  submit(projectId: string, items: FeedbackItem[]): Promise<SentFeedback[]>;
  /** Returns the feedback already sent for one page of a project. */
  list(projectId: string, path: string): Promise<SentFeedback[]>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super('Sign in to continue', 401);
    this.name = 'UnauthorizedError';
  }
}
