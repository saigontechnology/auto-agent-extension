import { addDraft } from '../draft-store';
import type { FlowContentMessage, FlowRequest } from '../messages';
import type { FlowAction, FlowStep } from '../types';
import { flowItem } from './flow-item';
import {
  getRecording,
  pauseRecording,
  putRecording,
  recordStep,
  removeRecording,
  resumeRecording,
  startRecording,
  stopRecording,
} from './recording-store';
import { type Recording, type RecordingState, recordingState } from './types';

export type FlowDeps = {
  now: () => Date;
  newId: () => string;
  /** Tells a tab's content script what its recording is doing now. */
  notify: (tabId: number, state: RecordingState) => void;
};

export type FlowHandlers = {
  content(message: FlowContentMessage, tabId: number): Promise<RecordingState>;
  request(request: FlowRequest): Promise<unknown>;
  tabCreated(tab: { id?: number; openerTabId?: number; pendingUrl?: string; url?: string }): Promise<void>;
  tabUpdated(tabId: number, url: string): Promise<void>;
  tabRemoved(tabId: number): Promise<void>;
};

const BLANK: ReadonlySet<string> = new Set(['', 'about:blank']);

export function createFlowHandlers(deps: FlowDeps): FlowHandlers {
  // Tabs opened from a recorded tab before their URL was known, mapped to the recorded tab.
  // Kept in memory only: losing it when the worker sleeps loses one "new tab" step at most.
  const awaitingUrl = new Map<number, number>();

  const step = (action: FlowAction, path: string): FlowStep => ({
    ...action,
    id: deps.newId(),
    at: deps.now().toISOString(),
    path,
  });

  const report = (tabId: number, recording: Recording | null): RecordingState => {
    const state = recordingState(recording);
    deps.notify(tabId, state);
    return state;
  };

  const lastPath = (recording: Recording) => recording.steps.at(-1)?.path ?? recording.startPage.path;

  const record = (tabId: number, recorded: FlowStep) => recordStep(tabId, recorded, deps.now());

  async function leave(tabId: number, recording: Recording, url: string): Promise<Recording | null> {
    await record(tabId, step({ type: 'left', url }, lastPath(recording)));
    return pauseRecording(tabId, 'left');
  }

  async function hello(
    message: Extract<FlowContentMessage, { type: 'flow-hello' }>,
    tabId: number,
  ): Promise<Recording | null> {
    const recording = await getRecording(tabId);
    if (!recording || recording.status === 'stopped') return recording;
    const { context } = message;
    const inProject = context !== null && context.projectId === recording.projectId;

    if (recording.status === 'paused') {
      // Only a pause caused by leaving the project ends by coming back to it.
      if (recording.pausedReason !== 'left' || !context || !inProject) return recording;
      await resumeRecording(tabId);
    } else if (!context || !inProject) {
      return leave(tabId, recording, message.url);
    }
    return record(tabId, step({ type: 'navigate', url: message.url, cause: message.navigation }, context.path));
  }

  async function newTab(openerId: number, url: string): Promise<void> {
    const recording = await getRecording(openerId);
    if (recording?.status !== 'recording') return;
    report(openerId, await record(openerId, step({ type: 'new-tab', url }, lastPath(recording))));
  }

  return {
    async content(message, tabId) {
      switch (message.type) {
        case 'flow-start':
          return report(
            tabId,
            await startRecording({ tabId, context: message.context, viewport: message.viewport, now: deps.now() }),
          );
        case 'flow-hello':
          return report(tabId, await hello(message, tabId));
        case 'flow-step':
          return report(tabId, await record(tabId, message.step));
      }
    },

    async request(request) {
      const { tabId } = request;
      switch (request.type) {
        case 'flow-pause':
          report(tabId, await pauseRecording(tabId, 'user'));
          return null;
        case 'flow-resume':
          report(tabId, await resumeRecording(tabId));
          return null;
        case 'flow-stop':
          report(tabId, await stopRecording(tabId, deps.now()));
          return null;
        case 'flow-discard':
          await removeRecording(tabId);
          report(tabId, null);
          return null;
        case 'flow-note':
          report(tabId, await record(tabId, step({ type: 'note', text: request.text.trim() }, request.path)));
          return null;
        case 'flow-save': {
          // Taking the recording out first means a second save, or the tab closing meanwhile,
          // finds nothing left to turn into a draft.
          const recording = await removeRecording(tabId);
          if (!recording) throw new Error('This recording no longer exists.');
          const item = flowItem(recording, request.edits, { id: deps.newId(), now: deps.now() });
          try {
            await addDraft(recording.projectId, item);
          } catch (error) {
            await putRecording(recording);
            throw error;
          }
          report(tabId, null);
          return item;
        }
      }
    },

    async tabCreated(tab) {
      if (tab.id === undefined || tab.openerTabId === undefined) return;
      const recording = await getRecording(tab.openerTabId);
      if (recording?.status !== 'recording') return;
      const url = tab.pendingUrl || tab.url || '';
      if (BLANK.has(url)) awaitingUrl.set(tab.id, tab.openerTabId);
      else await newTab(tab.openerTabId, url);
    },

    async tabUpdated(tabId, url) {
      const opener = awaitingUrl.get(tabId);
      if (opener === undefined || BLANK.has(url)) return;
      awaitingUrl.delete(tabId);
      await newTab(opener, url);
    },

    async tabRemoved(tabId) {
      awaitingUrl.delete(tabId);
      const recording = await removeRecording(tabId);
      if (!recording || recording.steps.length === 0) return;
      // Closing the tab must not lose the work; the draft needs a title before it can be sent.
      const item = flowItem(
        recording,
        { title: '', expected: '', actual: '', steps: recording.steps },
        { id: deps.newId(), now: deps.now() },
      );
      await addDraft(recording.projectId, item);
    },
  };
}
