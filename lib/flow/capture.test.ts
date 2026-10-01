import { beforeEach, describe, expect, it } from 'vitest';
import type { FlowAction } from '../types';
import { actionFromEvent, clickTarget, navigationCause } from './capture';

let host: HTMLElement;

/** Dispatches `event` on `target` and returns what a capture listener on window records. */
function record(target: EventTarget, event: Event): FlowAction | null {
  let action: FlowAction | null = null;
  const listener = (seen: Event) => {
    action = actionFromEvent(seen, host);
  };
  window.addEventListener(event.type, listener, true);
  target.dispatchEvent(event);
  window.removeEventListener(event.type, listener, true);
  return action;
}

const click = () => new MouseEvent('click', { bubbles: true, composed: true });
const input = () => new Event('input', { bubbles: true, composed: true });
const change = () => new Event('change', { bubbles: true, composed: true });
const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, composed: true, ...init });

function el<T extends Element>(selector: string): T {
  return document.querySelector<T>(selector)!;
}

describe('actionFromEvent', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <button id="buy" type="button" data-vibe-source="src/A.tsx:3"><span id="label">Buy</span></button>
        <input id="email" placeholder="Email">
        <input id="remember" type="checkbox">
        <input id="volume" type="range" value="3">
        <select id="plan"><option value="free">Free</option><option value="pro">Pro</option></select>
        <textarea id="bio"></textarea>
        <div id="editor" contenteditable="true">Hi</div>
        <a id="link" href="#x">Go</a>
      </form>
      <div id="host"></div>`;
    host = el<HTMLElement>('#host');
    host.attachShadow({ mode: 'open' }).innerHTML = '<button id="inner">Save</button><input id="note">';
  });

  it('records a click on the nearest interactive element', () => {
    expect(record(el('#label'), click())).toMatchObject({
      type: 'click',
      anchor: { selector: '#buy', source: 'src/A.tsx:3' },
    });
  });

  it('ignores clicks that only focus a form field', () => {
    expect(record(el('#email'), click())).toBeNull();
    expect(record(el('#remember'), click())).toBeNull();
    expect(record(el('#plan'), click())).toBeNull();
  });

  it('ignores clicks and typing inside the extension UI', () => {
    const shadow = host.shadowRoot!;
    expect(record(shadow.querySelector('#inner')!, click())).toBeNull();
    expect(record(shadow.querySelector('#note')!, input())).toBeNull();
  });

  it('records typing with the current value, verbatim', () => {
    el<HTMLInputElement>('#email').value = 'ada@example.com';
    expect(record(el('#email'), input())).toMatchObject({
      type: 'input',
      anchor: { selector: '#email' },
      value: 'ada@example.com',
    });
    el<HTMLTextAreaElement>('#bio').value = 'Hello';
    expect(record(el('#bio'), input())).toMatchObject({ type: 'input', value: 'Hello' });
    expect(record(el('#editor'), input())).toMatchObject({ type: 'input', value: 'Hi' });
  });

  it('records choices on change, not on input', () => {
    expect(record(el('#remember'), input())).toBeNull();
    el<HTMLSelectElement>('#plan').value = 'pro';
    expect(record(el('#plan'), change())).toMatchObject({ type: 'select', value: 'pro', label: 'Pro' });
    el<HTMLInputElement>('#remember').checked = true;
    expect(record(el('#remember'), change())).toMatchObject({ type: 'check', checked: true });
    expect(record(el('#volume'), change())).toMatchObject({ type: 'input', value: '3' });
    // Text fields are already recorded through their input events.
    expect(record(el('#email'), change())).toBeNull();
  });

  it('records Enter, Escape and Tab with the focused element', () => {
    expect(record(el('#email'), key({ key: 'Enter' }))).toMatchObject({
      type: 'key',
      key: 'Enter',
      anchor: { selector: '#email' },
    });
    const onBody = record(document.body, key({ key: 'Escape' }));
    expect(onBody).toEqual({ type: 'key', key: 'Escape' });
  });

  it('ignores other keys, repeats and composition', () => {
    expect(record(el('#email'), key({ key: 'a' }))).toBeNull();
    expect(record(el('#email'), key({ key: 'Enter', repeat: true }))).toBeNull();
    expect(record(el('#email'), key({ key: 'Enter', isComposing: true }))).toBeNull();
  });
});

describe('clickTarget', () => {
  it('climbs to a link or button and otherwise keeps the element', () => {
    document.body.innerHTML = '<a id="a" href="#"><b id="b">x</b></a><p id="p"><i id="i">y</i></p>';
    expect(clickTarget(el('#b')).id).toBe('a');
    expect(clickTarget(el('#i')).id).toBe('i');
  });
});

describe('navigationCause', () => {
  it('maps navigation timing types', () => {
    expect(navigationCause({ type: 'reload' } as unknown as PerformanceEntry)).toBe('reload');
    expect(navigationCause({ type: 'back_forward' } as unknown as PerformanceEntry)).toBe('history');
    expect(navigationCause({ type: 'navigate' } as unknown as PerformanceEntry)).toBe('load');
    expect(navigationCause(undefined)).toBe('load');
  });
});
