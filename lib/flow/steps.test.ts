import { describe, expect, it } from 'vitest';
import { clickStep, consoleStep, inputStep, networkStep } from '../test-helpers';
import type { FlowStep } from '../types';
import { MAX_STEPS, addStep } from './steps';

function addAll(steps: FlowStep[]): FlowStep[] {
  return steps.reduce<FlowStep[]>((list, step) => addStep(list, step).steps, []);
}

describe('addStep', () => {
  it('appends steps in order', () => {
    expect(addAll([clickStep('a'), clickStep('b')]).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('merges typing into the same field into one step with the latest value', () => {
    const steps = addAll([
      inputStep('i1', '#email', 'a'),
      inputStep('i2', '#email', 'ad'),
      inputStep('i3', '#email', 'ada'),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ id: 'i1', value: 'ada' });
  });

  it('keeps typing in different fields, or after another step, apart', () => {
    const steps = addAll([
      inputStep('i1', '#email', 'a'),
      inputStep('i2', '#password', 'b'),
      clickStep('c'),
      inputStep('i3', '#password', 'bc'),
    ]);
    expect(steps.map((s) => s.id)).toEqual(['i1', 'i2', 'c', 'i3']);
  });

  it('counts an error repeated back to back instead of adding steps', () => {
    const steps = addAll([consoleStep('e1', 'Boom'), consoleStep('e2', 'Boom'), consoleStep('e3', 'Other')]);
    expect(steps.map((s) => [s.id, s.type === 'console' && s.count])).toEqual([
      ['e1', 2],
      ['e3', 1],
    ]);
  });

  it('counts a repeated failed request but not one with another status', () => {
    const steps = addAll([networkStep('n1', 500), networkStep('n2', 500), networkStep('n3', 502)]);
    expect(steps.map((s) => [s.id, s.type === 'network' && s.count])).toEqual([
      ['n1', 2],
      ['n3', 1],
    ]);
  });

  it('survives an error storm without using up the step limit', () => {
    const storm = Array.from({ length: 1000 }, (_, i) => consoleStep(`e${i}`, 'Loop'));
    const steps = addAll(storm);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ count: 1000 });
  });

  it('drops a new step once the limit is reached and says so', () => {
    const full = Array.from({ length: MAX_STEPS }, (_, i) => clickStep(`c${i}`));
    const result = addStep(full, clickStep('extra'));
    expect(result.limitReached).toBe(true);
    expect(result.steps).toBe(full);
  });

  it('still merges a repeat when the list is full', () => {
    const full = [...Array.from({ length: MAX_STEPS - 1 }, (_, i) => clickStep(`c${i}`)), consoleStep('e', 'Boom')];
    const result = addStep(full, consoleStep('e2', 'Boom'));
    expect(result.limitReached).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ count: 2 });
  });
});
