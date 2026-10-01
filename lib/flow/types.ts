import type { FlowStep, PageRef, Viewport } from '../types';

export type RecordingStatus = 'recording' | 'paused' | 'stopped';

/** One tab's workflow recording, kept by the background in session storage. */
export type Recording = {
  tabId: number;
  projectId: string;
  buildId: string;
  startPage: PageRef;
  viewport: Viewport;
  status: RecordingStatus;
  /** Why a paused recording is paused: the reviewer pressed Pause, or the tab left the project. */
  pausedReason?: 'user' | 'left';
  /** Set when the recording stopped itself at the step limit. */
  limitReached?: boolean;
  steps: FlowStep[];
  startedAt: string;
  endedAt?: string;
};

/** What a tab's content script needs to know about its recording. */
export type RecordingState = { status: RecordingStatus | 'none'; steps: number };

/** What the reviewer fills in or changes on the review screen. */
export type FlowEdits = {
  title: string;
  expected: string;
  actual: string;
  failedStepId?: string;
  steps: FlowStep[];
};

export function recordingState(recording: Recording | null): RecordingState {
  return recording
    ? { status: recording.status, steps: recording.steps.length }
    : { status: 'none', steps: 0 };
}

const STATES: ReadonlySet<string> = new Set(['recording', 'paused', 'stopped', 'none']);

export function isRecordingState(value: unknown): value is RecordingState {
  const state = value as Partial<RecordingState> | null;
  return (
    typeof state === 'object' &&
    state !== null &&
    typeof state.status === 'string' &&
    STATES.has(state.status) &&
    typeof state.steps === 'number'
  );
}
