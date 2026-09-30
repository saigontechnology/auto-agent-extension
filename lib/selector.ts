const SIMPLE_IDENT = /^[A-Za-z_][\w-]*$/;

function quote(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function isUnique(doc: Document, selector: string): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function idSelector(id: string): string {
  return SIMPLE_IDENT.test(id) ? `#${id}` : `[id="${quote(id)}"]`;
}

function nthOfType(element: Element): string {
  const parent = element.parentElement;
  if (!parent) return element.localName;
  const sameType = Array.from(parent.children).filter(
    (child) => child.localName === element.localName,
  );
  return `${element.localName}:nth-of-type(${sameType.indexOf(element) + 1})`;
}

/**
 * Builds a selector matching exactly `element`. Class names are ignored on purpose:
 * generated builds hash them, so they change between deploys.
 */
export function buildSelector(element: Element): string {
  const doc = element.ownerDocument;
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== doc.documentElement) {
    if (current.id) {
      const byId = idSelector(current.id);
      if (isUnique(doc, byId)) return [byId, ...parts].join(' > ');
    }
    const testId = current.getAttribute('data-testid');
    if (testId) {
      const byTestId = `[data-testid="${quote(testId)}"]`;
      if (isUnique(doc, byTestId)) return [byTestId, ...parts].join(' > ');
    }
    parts.unshift(current === doc.body ? 'body' : nthOfType(current));
    current = current.parentElement;
  }

  return ['html', ...parts].join(' > ');
}
