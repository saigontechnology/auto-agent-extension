import { describe, expect, it } from 'vitest';
import { clickStep, consoleStep, inputStep, makeAnchor, networkStep } from '../test-helpers';
import type { FlowStep } from '../types';
import {
  editableValue,
  elementName,
  errorCount,
  flowSummary,
  formatElapsed,
  stepAnchor,
  stepLabel,
  stepTone,
} from './step-label';

const at = '2026-10-01T00:00:00.000Z';

describe('elementName', () => {
  it('prefers aria-label, from the element itself only', () => {
    const anchor = makeAnchor({ html: '<button aria-label="Close dialog"><span aria-label="x"></span></button>' });
    expect(elementName(anchor)).toBe('button "Close dialog"');
  });

  it('names form fields by placeholder, then name', () => {
    expect(elementName(makeAnchor({ tag: 'input', text: '', html: '<input placeholder="Email" name="e">' }))).toBe(
      'input "Email"',
    );
    expect(elementName(makeAnchor({ tag: 'select', text: 'Free Pro', html: '<select name="plan">' }))).toBe(
      'select "plan"',
    );
  });

  it('falls back to the visible text, shortened, then the selector', () => {
    expect(elementName(makeAnchor())).toBe('button "Sign in"');
    const long = 'x'.repeat(60);
    expect(elementName(makeAnchor({ text: long }))).toBe(`button "${'x'.repeat(39)}…"`);
    expect(elementName(makeAnchor({ tag: 'div', text: '', html: '<div>', selector: 'main > div' }))).toBe(
      'main > div',
    );
  });
});

describe('stepLabel', () => {
  const cases: Array<[FlowStep, string]> = [
    [clickStep('c'), 'Click button "Sign in"'],
    [
      { ...inputStep('i', '#email', 'ada@example.com'), anchor: makeAnchor({ tag: 'input', text: '', html: '<input placeholder="Email">' }) } as FlowStep,
      'Type "ada@example.com" into input "Email"',
    ],
    [
      { id: 's', at, path: '/', type: 'select', anchor: makeAnchor({ tag: 'select', html: '<select name="plan">' }), value: 'pro', label: 'Pro' },
      'Select "Pro" in select "plan"',
    ],
    [{ id: 'k', at, path: '/', type: 'check', anchor: makeAnchor({ tag: 'input', text: '', html: '<input>', selector: '#remember' }), checked: false }, 'Uncheck #remember'],
    [{ id: 'k', at, path: '/', type: 'key', key: 'Escape' }, 'Press Escape'],
    [{ id: 'n', at, path: '/about.html', type: 'navigate', url: 'x', cause: 'load' }, 'Go to /about.html'],
    [{ id: 'n', at, path: '/a', type: 'navigate', url: 'x', cause: 'reload' }, 'Reload /a'],
    [{ id: 'n', at, path: '/a', type: 'navigate', url: 'x', cause: 'history' }, 'Back or forward to /a'],
    [{ id: 'l', at, path: '/', type: 'left', url: 'https://accounts.example.com/' }, 'Left the preview for https://accounts.example.com/'],
    [{ id: 't', at, path: '/', type: 'new-tab', url: 'https://docs.example.com/' }, 'Opened a new tab: https://docs.example.com/'],
    [{ id: 'o', at, path: '/', type: 'note', text: 'Slow here' }, 'Note: Slow here'],
    [consoleStep('e', 'Boom\n    at x.js:1', 3), 'Console error: Boom ×3'],
    [{ id: 'e', at, path: '/', type: 'console', source: 'exception', message: 'Error: Boom', count: 1 }, 'Uncaught exception: Error: Boom'],
    [networkStep('w', 500), 'POST /api/login → 500'],
    [networkStep('w', null, 2), 'POST /api/login → failed ×2'],
  ];

  it.each(cases)('labels %#', (step, text) => {
    expect(stepLabel(step).text).toBe(text);
  });

  it('gives the source location of an element step', () => {
    expect(stepLabel(clickStep('c')).source).toBe('src/pages/Login.tsx:48');
    const nearest = { ...clickStep('c'), anchor: makeAnchor({ source: undefined, nearestSource: 'src/A.tsx:3' }) };
    expect(stepLabel(nearest).source).toBe('src/A.tsx:3');
    expect(stepLabel(networkStep('w', 500)).source).toBeUndefined();
  });
});

describe('step helpers', () => {
  it('finds the anchor of element steps only', () => {
    expect(stepAnchor(clickStep('c'))?.selector).toBe('#submit');
    expect(stepAnchor(networkStep('w', 500))).toBeUndefined();
  });

  it('colours errors, failed requests and notes', () => {
    expect(stepTone(consoleStep('e', 'x'))).toBe('error');
    expect(stepTone(networkStep('w', 500))).toBe('warning');
    expect(stepTone({ id: 'o', at, path: '/', type: 'note', text: 'x' })).toBe('note');
    expect(stepTone(clickStep('c'))).toBeNull();
  });

  it('exposes the editable value of input and note steps', () => {
    expect(editableValue(inputStep('i', '#e', 'v'))).toBe('v');
    expect(editableValue({ id: 'o', at, path: '/', type: 'note', text: 't' })).toBe('t');
    expect(editableValue(clickStep('c'))).toBeNull();
  });

  it('summarises steps and errors', () => {
    expect(errorCount([clickStep('c'), consoleStep('e', 'x', 4), networkStep('w', 500)])).toBe(2);
    expect(flowSummary([clickStep('c')])).toBe('1 step · 0 errors');
    expect(flowSummary([clickStep('c'), consoleStep('e', 'x')])).toBe('2 steps · 1 error');
  });

  it('formats elapsed time as minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_400)).toBe('1:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});
