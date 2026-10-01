import { describe, expect, it } from 'vitest';
import { clickStep, inputStep, makeFlowItem, makeItem, networkStep } from '../test-helpers';
import { flowEditsOf, flowItem, flowPatch, isSendable, withValue } from './flow-item';
import type { FlowEdits, Recording } from './types';

const recording: Recording = {
  tabId: 7,
  projectId: 'proj',
  buildId: 'build_9',
  startPage: { url: 'https://demo.web.app/login', path: '/login', title: 'Sign in' },
  viewport: { width: 1280, height: 720, dpr: 2 },
  status: 'stopped',
  steps: [clickStep('s1'), networkStep('s2', 500)],
  startedAt: '2026-10-01T00:00:00.000Z',
  endedAt: '2026-10-01T00:02:00.000Z',
};

const edits: FlowEdits = {
  title: '  Sign-in fails  ',
  expected: ' Dashboard ',
  actual: 'Error 500',
  failedStepId: 's2',
  steps: recording.steps,
};

const env = { id: 'flow-1', now: new Date('2026-10-01T00:05:00.000Z') };

describe('flowItem', () => {
  it('builds a flow draft from a recording and the review edits', () => {
    expect(flowItem(recording, edits, env)).toEqual({
      id: 'flow-1',
      buildId: 'build_9',
      kind: 'flow',
      comment: 'Sign-in fails',
      page: recording.startPage,
      flow: {
        expected: 'Dashboard',
        actual: 'Error 500',
        failedStepId: 's2',
        startedAt: '2026-10-01T00:00:00.000Z',
        endedAt: '2026-10-01T00:02:00.000Z',
        steps: recording.steps,
      },
      viewport: recording.viewport,
      createdAt: '2026-10-01T00:05:00.000Z',
    });
  });

  it('drops a failing step that is no longer in the list', () => {
    const item = flowItem(recording, { ...edits, failedStepId: 'gone' }, env);
    expect(item.flow).not.toHaveProperty('failedStepId');
  });

  it('ends at the save time when the recording never stopped', () => {
    const { endedAt: _endedAt, ...open } = recording;
    expect(flowItem(open, edits, env).flow?.endedAt).toBe('2026-10-01T00:05:00.000Z');
  });
});

describe('flowEditsOf and flowPatch', () => {
  it('reads the editable fields of a flow draft', () => {
    const item = makeFlowItem({ flow: { ...makeFlowItem().flow!, failedStepId: 's2' } });
    expect(flowEditsOf(item)).toEqual({
      title: 'Sign-in fails',
      expected: 'I land on the dashboard',
      actual: 'Nothing happens',
      failedStepId: 's2',
      steps: item.flow!.steps,
    });
  });

  it('patches title and flow but keeps the recording times', () => {
    const item = makeFlowItem();
    const patch = flowPatch(item, {
      title: 'New title ',
      expected: '',
      actual: 'x',
      steps: [clickStep('s1')],
    });
    expect(patch).toEqual({
      comment: 'New title',
      flow: {
        expected: '',
        actual: 'x',
        startedAt: item.flow!.startedAt,
        endedAt: item.flow!.endedAt,
        steps: [clickStep('s1')],
      },
    });
  });
});

describe('withValue', () => {
  it('changes the value of an input step and the text of a note', () => {
    expect(withValue(inputStep('i', '#email', 'a'), 'b')).toMatchObject({ value: 'b' });
    const note = { id: 'n', at: 'x', path: '/', type: 'note' as const, text: 'old' };
    expect(withValue(note, 'new')).toMatchObject({ text: 'new' });
  });

  it('leaves other steps unchanged', () => {
    const step = clickStep('c');
    expect(withValue(step, 'x')).toBe(step);
  });
});

describe('isSendable', () => {
  it('sends every non-flow item and flows with a title', () => {
    expect(isSendable(makeItem())).toBe(true);
    expect(isSendable(makeItem({ kind: 'text-edit', comment: '' }))).toBe(true);
    expect(isSendable(makeFlowItem())).toBe(true);
  });

  it('holds back a flow without a title', () => {
    expect(isSendable(makeFlowItem({ comment: '   ' }))).toBe(false);
  });
});
