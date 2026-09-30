import { beforeEach, describe, expect, it } from 'vitest';
import { eventElement, firstChildOf, isEditableText, isOwnUi, parentOf } from './picker';

function capture(target: Element): Event {
  let seen: Event | undefined;
  const listener = (event: Event) => {
    seen = event;
  };
  document.addEventListener('click', listener, true);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  document.removeEventListener('click', listener, true);
  return seen!;
}

describe('picker helpers', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <main><p id="p">Hello <b id="b">world</b></p><button id="btn">Buy</button><div id="empty"> </div></main>
      <textarea id="ta">text</textarea>
      <div id="host"></div>`;
    host = document.querySelector<HTMLElement>('#host')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<button id="inner">Save</button>';
  });

  it('returns the page element an event started on', () => {
    const button = document.querySelector('#btn')!;
    expect(eventElement(capture(button), host)).toBe(button);
  });

  it('ignores events from inside the extension UI', () => {
    const inner = host.shadowRoot!.querySelector('#inner')!;
    const event = capture(inner);
    expect(isOwnUi(event, host)).toBe(true);
    expect(eventElement(event, host)).toBeNull();
  });

  it('ignores the root element', () => {
    expect(eventElement(capture(document.documentElement), host)).toBeNull();
  });

  it('walks to the parent but not past body', () => {
    expect(parentOf(document.querySelector('#b')!)).toBe(document.querySelector('#p'));
    expect(parentOf(document.body)).toBeNull();
  });

  it('walks to the first child element', () => {
    expect(firstChildOf(document.querySelector('#p')!)).toBe(document.querySelector('#b'));
    expect(firstChildOf(document.querySelector('#btn')!)).toBeNull();
  });

  it('allows inline editing only for text-only elements', () => {
    expect(isEditableText(document.querySelector('#btn')!)).toBe(true);
    expect(isEditableText(document.querySelector('#b')!)).toBe(true);
    expect(isEditableText(document.querySelector('#p')!)).toBe(false);
    expect(isEditableText(document.querySelector('#empty')!)).toBe(false);
    expect(isEditableText(document.querySelector('#ta')!)).toBe(false);
  });
});
