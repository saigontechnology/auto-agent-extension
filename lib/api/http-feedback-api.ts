import type { ClientInfo, SentFeedback } from '../types';
import { ApiError, type FeedbackApi, UnauthorizedError } from './feedback-api';
import { feedbackPayload } from './feedback-payload';

export type HttpFeedbackApiDeps = {
  apiBase: string;
  client: ClientInfo;
  fetch: typeof fetch;
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  /** Called when the API still answers 401 after a token refresh. */
  onUnauthorized: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStepAnchor(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.selector) &&
    isString(value.tag) &&
    isString(value.text) &&
    isString(value.html)
  );
}

/** Checks the fields the panel reads to label each step. */
function isFlowStep(value: unknown): boolean {
  if (!isRecord(value) || !isString(value.id) || !isString(value.path)) return false;
  switch (value.type) {
    case 'click':
    case 'check':
      return isStepAnchor(value.anchor);
    case 'input':
      return isStepAnchor(value.anchor) && isString(value.value);
    case 'select':
      return isStepAnchor(value.anchor) && isString(value.label);
    case 'key':
      return isString(value.key) && (value.anchor === undefined || isStepAnchor(value.anchor));
    case 'navigate':
    case 'left':
    case 'new-tab':
      return isString(value.url);
    case 'note':
      return isString(value.text);
    case 'console':
      return isString(value.source) && isString(value.message) && typeof value.count === 'number';
    case 'network':
      return isString(value.method) && isString(value.url) && typeof value.count === 'number';
    default:
      return false;
  }
}

function isFlow(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.expected) &&
    isString(value.actual) &&
    Array.isArray(value.steps) &&
    value.steps.every(isFlowStep)
  );
}

/**
 * Checks the fields the extension reads from sent feedback, so a contract mismatch shows up
 * as an error message instead of crashing the review panel.
 */
function isSentFeedback(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { page, author, anchor, textEdit } = value;
  return (
    isString(value.id) &&
    (value.kind === 'element' ||
      value.kind === 'text-edit' ||
      value.kind === 'page' ||
      value.kind === 'flow') &&
    (value.kind !== 'flow' || isFlow(value.flow)) &&
    isString(value.comment) &&
    (value.status === 'open' || value.status === 'resolved') &&
    isRecord(page) &&
    isString(page.path) &&
    isRecord(author) &&
    isString(author.name) &&
    (anchor === undefined ||
      (isRecord(anchor) &&
        isString(anchor.selector) &&
        isString(anchor.tag) &&
        isString(anchor.text))) &&
    (textEdit === undefined ||
      (isRecord(textEdit) && isString(textEdit.before) && isString(textEdit.after)))
  );
}

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
    if (!Array.isArray(data) || !data.every(isSentFeedback)) {
      throw new ApiError('The server sent an unexpected response.');
    }
    return data as SentFeedback[];
  }

  return {
    submit(projectId, items) {
      return request(`${deps.apiBase}/projects/${encodeURIComponent(projectId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feedbackPayload(items, deps.client)),
      });
    },
  };
}
