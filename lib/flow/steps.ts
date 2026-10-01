import type { FlowStep } from '../types';

export const MAX_STEPS = 300;
export const MAX_MESSAGE = 2000;

function replaceLast(steps: FlowStep[], step: FlowStep): FlowStep[] {
  return [...steps.slice(0, -1), step];
}

/**
 * Adds a step to a recording. Typing into one field becomes one step holding the final value,
 * and an error repeated back to back is counted rather than listed again, so an error loop on
 * the page cannot use up the step limit.
 */
export function addStep(
  steps: FlowStep[],
  step: FlowStep,
): { steps: FlowStep[]; limitReached: boolean } {
  const last = steps.at(-1);
  if (last?.type === 'input' && step.type === 'input' && last.anchor.selector === step.anchor.selector) {
    return { steps: replaceLast(steps, { ...step, id: last.id }), limitReached: false };
  }
  if (
    last?.type === 'console' &&
    step.type === 'console' &&
    last.source === step.source &&
    last.message === step.message
  ) {
    return { steps: replaceLast(steps, { ...last, count: last.count + step.count }), limitReached: false };
  }
  if (
    last?.type === 'network' &&
    step.type === 'network' &&
    last.method === step.method &&
    last.url === step.url &&
    last.status === step.status
  ) {
    return { steps: replaceLast(steps, { ...last, count: last.count + step.count }), limitReached: false };
  }
  if (steps.length >= MAX_STEPS) return { steps, limitReached: true };
  return { steps: [...steps, step], limitReached: false };
}
