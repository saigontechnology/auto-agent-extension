import type { FeedbackRun, Project } from './api/auto-agent-client';
import type { JobMatch } from './api/job-matcher';
import type { User } from './auth/session';
import type { FlowEdits, RecordingState } from './flow/types';
import type {
  Anchor,
  FeedbackItem,
  FlowStep,
  Mode,
  PageContext,
  SentFeedback,
  Viewport,
} from './types';

/** Name of the long-lived port the review panel opens to a tab's content script. */
export const PANEL_PORT = 'vibe-panel';

/** Keys pressed while the review panel has focus, forwarded so they still steer the picker. */
export type PickerKey = 'ArrowUp' | 'ArrowDown';

export type PanelToContent =
  | { type: 'set-mode'; mode: Mode }
  | { type: 'key'; key: PickerKey }
  | { type: 'focus-item'; id: string }
  | { type: 'create-page-comment'; comment: string }
  | { type: 'start-recording' }
  /** Highlights a workflow step's element; `scroll` also brings it into view for a moment. */
  | { type: 'show-anchor'; key: string; anchor: Anchor | null; scroll: boolean }
  | { type: 'set-sent'; items: SentFeedback[] };

export type ContentToPanel =
  | { type: 'context'; context: PageContext | null }
  | { type: 'mode'; mode: Mode }
  | { type: 'unresolved'; ids: string[] }
  | { type: 'anchor-missing'; key: string };

/** Broadcast by a content script when it starts, so an open review panel can connect to it. */
export type ContentReady = { type: 'content-ready' };

export function isContentReady(message: unknown): message is ContentReady {
  return (message as ContentReady | null)?.type === 'content-ready';
}

/** Sent by the background to a tab's content script to show or hide the review panel. */
export type SetPanel = { type: 'set-panel'; open: boolean };

export function isSetPanel(message: unknown): message is SetPanel {
  return (message as SetPanel | null)?.type === 'set-panel';
}

/**
 * Sent by a content script to the background. The background remembers which tabs have the
 * panel open, so it reopens after a reload or a navigation; `open` changes that, and the reply
 * is the current state either way.
 */
export type PanelState = { type: 'panel-state'; open?: boolean };

export function isPanelState(message: unknown): message is PanelState {
  return (message as PanelState | null)?.type === 'panel-state';
}

/** Sent by a content script to the background about its tab's workflow recording. */
export type FlowContentMessage =
  /** Start recording this tab, or get back the recording it already has. */
  | { type: 'flow-start'; context: PageContext; viewport: Viewport }
  /** Sent when a document starts or comes back from the back/forward cache. */
  | { type: 'flow-hello'; context: PageContext | null; url: string; navigation: 'load' | 'reload' | 'history' }
  | { type: 'flow-step'; step: FlowStep };

const FLOW_CONTENT_TYPES: ReadonlyArray<FlowContentMessage['type']> = ['flow-start', 'flow-hello', 'flow-step'];

export function isFlowContentMessage(message: unknown): message is FlowContentMessage {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof type === 'string' && (FLOW_CONTENT_TYPES as readonly string[]).includes(type);
}

/** Sent by the background to a tab whenever its recording changes. */
export type FlowStatus = { type: 'flow-status'; state: RecordingState };

export function isFlowStatus(message: unknown): message is FlowStatus {
  return (message as FlowStatus | null)?.type === 'flow-status';
}

export type AuthState = { signedIn: boolean; user: User | null };

export type BackgroundRequest =
  /** `projectId` is the drafts' storage key; `url` is the page, which picks the demo job. */
  | { type: 'submit'; projectId: string; url: string; ids: string[] }
  | { type: 'sign-in' }
  | { type: 'sign-out' }
  | { type: 'auth-state' }
  | { type: 'resolve-job'; url: string }
  | { type: 'choose-job'; url: string; match: JobMatch }
  | { type: 'list-projects' }
  | { type: 'list-demo-jobs'; project: Project }
  /** The feedback runs on the demo job the page belongs to. */
  | { type: 'job-runs'; url: string }
  | { type: 'flow-pause'; tabId: number }
  | { type: 'flow-resume'; tabId: number }
  | { type: 'flow-stop'; tabId: number }
  | { type: 'flow-discard'; tabId: number }
  | { type: 'flow-note'; tabId: number; text: string; path: string }
  | { type: 'flow-save'; tabId: number; edits: FlowEdits };

export type FlowRequest = Extract<BackgroundRequest, { type: `flow-${string}` }>;

export type BackgroundResponse = {
  submit: SentFeedback[];
  'sign-in': AuthState;
  'sign-out': AuthState;
  'auth-state': AuthState;
  'resolve-job': JobMatch | null;
  'choose-job': JobMatch;
  'list-projects': Project[];
  'list-demo-jobs': JobMatch[];
  'job-runs': FeedbackRun[];
  'flow-pause': null;
  'flow-resume': null;
  'flow-stop': null;
  'flow-discard': null;
  'flow-note': null;
  'flow-save': FeedbackItem;
};

/**
 * `unauthorized`: sign in again. `forbidden`: the page's demo is no longer reachable and has been
 * forgotten. `not-configured`: no demo has been chosen for the page yet.
 */
export type ErrorCode = 'unauthorized' | 'forbidden' | 'not-configured' | 'failed';

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; error: string };

const REQUEST_TYPES: ReadonlyArray<BackgroundRequest['type']> = [
  'submit',
  'sign-in',
  'sign-out',
  'auth-state',
  'resolve-job',
  'choose-job',
  'list-projects',
  'list-demo-jobs',
  'job-runs',
  'flow-pause',
  'flow-resume',
  'flow-stop',
  'flow-discard',
  'flow-note',
  'flow-save',
];

export function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof type === 'string' && (REQUEST_TYPES as readonly string[]).includes(type);
}

/** Sent by Auto Agent's download page to learn which version is installed. */
export type Ping = { type: 'ping' };
export type PingReply = { installed: true; version: string };

export function isPing(message: unknown): message is Ping {
  return (message as Ping | null)?.type === 'ping';
}
