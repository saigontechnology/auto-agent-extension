import type { Mode, PageContext, SentFeedback } from './types';

/** Name of the long-lived port the side panel opens to a tab's content script. */
export const PANEL_PORT = 'vibe-panel';

/** Keys pressed while the side panel has focus, forwarded so they still steer the picker. */
export type PickerKey = 'ArrowUp' | 'ArrowDown';

export type PanelToContent =
  | { type: 'set-mode'; mode: Mode }
  | { type: 'key'; key: PickerKey }
  | { type: 'focus-item'; id: string }
  | { type: 'create-page-comment'; comment: string }
  | { type: 'set-sent'; items: SentFeedback[] };

export type ContentToPanel =
  | { type: 'context'; context: PageContext | null }
  | { type: 'mode'; mode: Mode }
  | { type: 'unresolved'; ids: string[] };

/** Broadcast by a content script when it starts, so an open side panel can connect to it. */
export type ContentReady = { type: 'content-ready' };

export function isContentReady(message: unknown): message is ContentReady {
  return (message as ContentReady | null)?.type === 'content-ready';
}

export type AuthState = { useMock: boolean; configured: boolean; signedIn: boolean };

export type BackgroundRequest =
  | { type: 'submit'; projectId: string }
  | { type: 'list'; projectId: string; path: string }
  | { type: 'sign-in' }
  | { type: 'sign-out' }
  | { type: 'auth-state' };

export type BackgroundResponse = {
  submit: SentFeedback[];
  list: SentFeedback[];
  'sign-in': AuthState;
  'sign-out': AuthState;
  'auth-state': AuthState;
};

export type ErrorCode = 'unauthorized' | 'not-configured' | 'failed';

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; error: string };

const REQUEST_TYPES: ReadonlyArray<BackgroundRequest['type']> = [
  'submit',
  'list',
  'sign-in',
  'sign-out',
  'auth-state',
];

export function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof type === 'string' && (REQUEST_TYPES as readonly string[]).includes(type);
}
