import { collapseText } from './text';

const NOT_EDITABLE = new Set(['textarea', 'input', 'select', 'option', 'script', 'style']);

/** True when the event started inside the extension's own UI, which lives under `host`. */
export function isOwnUi(event: Event, host: Element): boolean {
  return event.composedPath().includes(host);
}

/** The page element an event points at, or null for our own UI and for the root element. */
export function eventElement(event: Event, host: Element): Element | null {
  if (isOwnUi(event, host)) return null;
  const target = event.composedPath()[0];
  if (!(target instanceof Element)) return null;
  return target === target.ownerDocument.documentElement ? null : target;
}

export function parentOf(element: Element): Element | null {
  const parent = element.parentElement;
  return parent && parent !== element.ownerDocument.documentElement ? parent : null;
}

export function firstChildOf(element: Element): Element | null {
  return element.firstElementChild;
}

/**
 * Inline text editing is limited to elements that contain text and nothing else, so that
 * cancelling an edit can restore the original without destroying child elements.
 */
export function isEditableText(element: Element): boolean {
  if (NOT_EDITABLE.has(element.localName)) return false;
  if (element.children.length > 0) return false;
  return collapseText(element.textContent ?? '') !== '';
}
