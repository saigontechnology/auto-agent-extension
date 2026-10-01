import type { ClientInfo, FeedbackItem } from '../types';

/** The request body of `POST {apiBase}/projects/{projectId}/feedback`. */
export type FeedbackPayload = { items: FeedbackItem[]; client: ClientInfo };

export function feedbackPayload(items: FeedbackItem[], client: ClientInfo): FeedbackPayload {
  return { items, client };
}
