import { SOURCE_ATTR, anchorText } from './element-descriptor';
import type { Anchor } from './types';

/** Anchors can come from the server, so a malformed selector must not throw. */
function safeQuery(doc: Document, selector: string): Element | null {
  try {
    return doc.querySelector(selector);
  } catch {
    return null;
  }
}

function safeTagMatches(doc: Document, tag: string): Element[] {
  try {
    return Array.from(doc.getElementsByTagName(tag));
  } catch {
    return [];
  }
}

export function resolveAnchor(anchor: Anchor, doc: Document): Element | null {
  const bySelector = safeQuery(doc, anchor.selector);

  if (anchor.source) {
    const matches = Array.from(doc.querySelectorAll(`[${SOURCE_ATTR}]`)).filter(
      (element) => element.getAttribute(SOURCE_ATTR)?.trim() === anchor.source,
    );
    const [first] = matches;
    if (first) {
      if (matches.length === 1) return first;
      if (bySelector && matches.includes(bySelector)) return bySelector;
      return matches.find((element) => anchorText(element) === anchor.text) ?? first;
    }
  }

  if (bySelector && bySelector.localName === anchor.tag) return bySelector;

  if (anchor.text) {
    return (
      safeTagMatches(doc, anchor.tag).find((element) => anchorText(element) === anchor.text) ?? null
    );
  }
  return null;
}
