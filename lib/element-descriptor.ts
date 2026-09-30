import { buildSelector } from './selector';
import { collapseText, truncate } from './text';
import type { Anchor } from './types';

export const SOURCE_ATTR = 'data-vibe-source';
export const MAX_TEXT = 200;
export const MAX_HTML = 2000;

/** The normalised text stored in an anchor and compared when re-finding the element. */
export function anchorText(element: Element): string {
  return truncate(collapseText(element.textContent ?? ''), MAX_TEXT);
}

function sourceOf(element: Element | null | undefined): string | undefined {
  return element?.getAttribute(SOURCE_ATTR)?.trim() || undefined;
}

export function describeElement(element: Element): Anchor {
  const source = sourceOf(element);
  const nearestSource = source
    ? undefined
    : sourceOf(element.parentElement?.closest(`[${SOURCE_ATTR}]`));
  const box = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;

  return {
    ...(source ? { source } : {}),
    ...(nearestSource ? { nearestSource } : {}),
    selector: buildSelector(element),
    tag: element.localName,
    text: anchorText(element),
    html: truncate(element.outerHTML, MAX_HTML),
    rect: {
      x: box.x + (view?.scrollX ?? 0),
      y: box.y + (view?.scrollY ?? 0),
      width: box.width,
      height: box.height,
    },
  };
}
