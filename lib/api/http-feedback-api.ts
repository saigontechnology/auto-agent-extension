import type { ClientInfo, SentFeedback } from '../types';
import { ApiError, type FeedbackApi, UnauthorizedError } from './feedback-api';

export type HttpFeedbackApiDeps = {
  apiBase: string;
  client: ClientInfo;
  fetch: typeof fetch;
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  /** Called when the API still answers 401 after a token refresh. */
  onUnauthorized: () => Promise<void>;
};

/**
 * The real API adapter. When the tool's actual contract is known, this is the file to change:
 * the URLs, the request body, and how the response maps to SentFeedback.
 */
export function createHttpFeedbackApi(deps: HttpFeedbackApiDeps): FeedbackApi {
  async function send(url: string, init: RequestInit, token: string): Promise<Response> {
    try {
      return await deps.fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new ApiError('Could not reach the server. Check your connection.');
    }
  }

  async function request(url: string, init: RequestInit): Promise<SentFeedback[]> {
    let token = await deps.getAccessToken();
    if (!token) throw new UnauthorizedError();

    let response = await send(url, init, token);
    if (response.status === 401) {
      token = await deps.getAccessToken({ forceRefresh: true });
      if (!token) throw new UnauthorizedError();
      response = await send(url, init, token);
      if (response.status === 401) {
        await deps.onUnauthorized();
        throw new UnauthorizedError();
      }
    }
    if (!response.ok) throw new ApiError(`Request failed (${response.status})`, response.status);

    const data: unknown = await response.json().catch(() => null);
    if (!Array.isArray(data)) throw new ApiError('The server sent an unexpected response.');
    return data as SentFeedback[];
  }

  const feedbackUrl = (projectId: string) =>
    `${deps.apiBase}/projects/${encodeURIComponent(projectId)}/feedback`;

  return {
    submit(projectId, items) {
      return request(feedbackUrl(projectId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, client: deps.client }),
      });
    },

    list(projectId, path) {
      return request(`${feedbackUrl(projectId)}?path=${encodeURIComponent(path)}`, {
        method: 'GET',
      });
    },
  };
}
