import { describeElement } from '../element-descriptor';
import { eventElement } from '../picker';
import type { FlowAction } from '../types';

export const CAPTURED_EVENTS = ['click', 'input', 'change', 'keydown'] as const;

const INTERACTIVE =
  'a[href], button, summary, label, [role="button"], [role="link"], [role="tab"], ' +
  '[role="menuitem"], [role="option"], [role="checkbox"], [role="switch"]';

/** Input types that are pressed like buttons rather than typed into or chosen from. */
const BUTTON_INPUTS: ReadonlySet<string> = new Set(['submit', 'button', 'reset', 'image']);
/** Input types whose value is chosen, not typed: recorded on change. */
const CHOICE_INPUTS: ReadonlySet<string> = new Set(['checkbox', 'radio', 'file', 'range', 'color', 'hidden']);
const KEYS: ReadonlySet<string> = new Set(['Enter', 'Escape', 'Tab']);

/** A click is about the control the reviewer meant, not the icon or span inside it. */
export function clickTarget(element: Element): Element {
  return element.closest(INTERACTIVE) ?? element;
}

function isEditable(element: Element): boolean {
  return element.matches('[contenteditable]:not([contenteditable="false"])');
}

function isTextEntry(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return !BUTTON_INPUTS.has(element.type) && !CHOICE_INPUTS.has(element.type);
  }
  return isEditable(element);
}

/** Fields are recorded by what changes in them, not by the click that focused them. */
function isFormField(element: Element): boolean {
  if (element instanceof HTMLInputElement) return !BUTTON_INPUTS.has(element.type);
  return (
    element instanceof HTMLSelectElement ||
    element instanceof HTMLOptionElement ||
    element instanceof HTMLTextAreaElement ||
    isEditable(element)
  );
}

function textValue(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
  return element.textContent ?? '';
}

/**
 * The step a page event records, or null when it records nothing. Call it while the event is
 * being dispatched: `composedPath()` is empty afterwards.
 */
export function actionFromEvent(event: Event, host: Element): FlowAction | null {
  const target = eventElement(event, host);
  if (!target) return null;

  switch (event.type) {
    case 'click':
      return isFormField(target) ? null : { type: 'click', anchor: describeElement(clickTarget(target)) };

    case 'input':
      return isTextEntry(target)
        ? { type: 'input', anchor: describeElement(target), value: textValue(target) }
        : null;

    case 'change':
      if (target instanceof HTMLSelectElement) {
        const label = Array.from(target.selectedOptions, (option) => option.text.trim()).join(', ');
        return { type: 'select', anchor: describeElement(target), value: target.value, label };
      }
      if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
        return { type: 'check', anchor: describeElement(target), checked: target.checked };
      }
      if (target instanceof HTMLInputElement && CHOICE_INPUTS.has(target.type)) {
        return { type: 'input', anchor: describeElement(target), value: target.value };
      }
      return null;

    case 'keydown': {
      const keyboard = event as KeyboardEvent;
      if (!KEYS.has(keyboard.key) || keyboard.repeat || keyboard.isComposing) return null;
      const keyName = keyboard.key as 'Enter' | 'Escape' | 'Tab';
      return target === target.ownerDocument.body
        ? { type: 'key', key: keyName }
        : { type: 'key', key: keyName, anchor: describeElement(target) };
    }
  }
  return null;
}

/** How the current document was reached, from its navigation timing entry. */
export function navigationCause(entry: PerformanceEntry | undefined): 'load' | 'reload' | 'history' {
  const type = (entry as PerformanceNavigationTiming | undefined)?.type;
  if (type === 'reload') return 'reload';
  if (type === 'back_forward') return 'history';
  return 'load';
}
