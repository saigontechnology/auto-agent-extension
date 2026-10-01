import type { DraftPatch } from '../draft-store';
import { createItem } from '../feedback-factory';
import type { FeedbackItem, Flow, FlowStep } from '../types';
import type { FlowEdits, Recording } from './types';

export function flowFromEdits(
  times: { startedAt: string; endedAt: string },
  edits: FlowEdits,
): Flow {
  // A flagged step the reviewer deleted afterwards must not leave a dangling id.
  const failed =
    edits.failedStepId && edits.steps.some((step) => step.id === edits.failedStepId)
      ? { failedStepId: edits.failedStepId }
      : {};
  return {
    expected: edits.expected.trim(),
    actual: edits.actual.trim(),
    ...failed,
    startedAt: times.startedAt,
    endedAt: times.endedAt,
    steps: edits.steps,
  };
}

/** The draft a recording becomes once it is saved. */
export function flowItem(
  recording: Recording,
  edits: FlowEdits,
  env: { id: string; now: Date },
): FeedbackItem {
  const flow = flowFromEdits(
    { startedAt: recording.startedAt, endedAt: recording.endedAt ?? env.now.toISOString() },
    edits,
  );
  return createItem(
    {
      kind: 'flow',
      comment: edits.title,
      context: { projectId: recording.projectId, buildId: recording.buildId, ...recording.startPage },
      flow,
    },
    { id: env.id, now: env.now, viewport: recording.viewport },
  );
}

export function flowEditsOf(item: FeedbackItem): FlowEdits {
  const flow = item.flow;
  return {
    title: item.comment,
    expected: flow?.expected ?? '',
    actual: flow?.actual ?? '',
    ...(flow?.failedStepId ? { failedStepId: flow.failedStepId } : {}),
    steps: flow?.steps ?? [],
  };
}

export function flowPatch(item: FeedbackItem, edits: FlowEdits): DraftPatch {
  const times = {
    startedAt: item.flow?.startedAt ?? item.createdAt,
    endedAt: item.flow?.endedAt ?? item.createdAt,
  };
  return { comment: edits.title.trim(), flow: flowFromEdits(times, edits) };
}

/** Replaces the one value a step lets the reviewer correct: typed text, or a note. */
export function withValue(step: FlowStep, value: string): FlowStep {
  if (step.type === 'input') return { ...step, value };
  if (step.type === 'note') return { ...step, text: value };
  return step;
}

/** A workflow needs a title before it can be sent; auto-saved ones start without. */
export function isSendable(item: FeedbackItem): boolean {
  return item.kind !== 'flow' || item.comment.trim() !== '';
}
