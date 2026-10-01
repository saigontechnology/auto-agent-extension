import type { ClientInfo, FeedbackItem } from '../types';

/** The JSON file a Send uploads to Auto Agent, and what Export JSON saves. */
export type FeedbackPayload = { items: FeedbackItem[]; client: ClientInfo };

export function feedbackPayload(items: FeedbackItem[], client: ClientInfo): FeedbackPayload {
  return { items, client };
}

/** The name of an exported or uploaded payload: `auto-agent-feedback-<project>-<time>.json`. */
export function feedbackFileName(projectId: string, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  const name = projectId.replace(/[^\w.-]+/g, '-');
  return `auto-agent-feedback-${name}-${stamp}.json`;
}
