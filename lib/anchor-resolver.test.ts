import { beforeEach, describe, expect, it } from 'vitest';
import { resolveAnchor } from './anchor-resolver';
import { describeElement } from './element-descriptor';
import type { Anchor } from './types';

const rect = { x: 0, y: 0, width: 0, height: 0 };

function anchor(partial: Partial<Anchor>): Anchor {
  return { selector: '#missing', tag: 'p', text: '', html: '', rect, ...partial };
}

describe('resolveAnchor', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <h1 data-vibe-source="src/Home.tsx:12">Welcome</h1>
      <ul>
        <li data-vibe-source="src/Home.tsx:30">Apples</li>
        <li data-vibe-source="src/Home.tsx:30">Pears</li>
        <li data-vibe-source="src/Home.tsx:30">Plums</li>
      </ul>
      <p id="note">Free shipping</p>
      <p>Returns accepted</p>`;
  });

  it('round-trips every described element', () => {
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      expect(resolveAnchor(describeElement(element), document)).toBe(element);
    }
  });

  it('finds an element by source even when the selector is stale', () => {
    const found = resolveAnchor(anchor({ source: 'src/Home.tsx:12', tag: 'h1' }), document);
    expect(found).toBe(document.querySelector('h1'));
  });

  it('uses the selector to pick among elements sharing one source', () => {
    const pears = document.querySelectorAll('li')[1];
    const found = resolveAnchor(
      anchor({ source: 'src/Home.tsx:30', tag: 'li', selector: 'html > body > ul:nth-of-type(1) > li:nth-of-type(2)', text: 'Apples' }),
      document,
    );
    expect(found).toBe(pears);
  });

  it('uses the text to pick among elements sharing one source when the selector misses', () => {
    const found = resolveAnchor(anchor({ source: 'src/Home.tsx:30', tag: 'li', text: 'Plums' }), document);
    expect(found).toBe(document.querySelectorAll('li')[2]);
  });

  it('falls back to the first element sharing the source', () => {
    const found = resolveAnchor(anchor({ source: 'src/Home.tsx:30', tag: 'li', text: 'Gone' }), document);
    expect(found).toBe(document.querySelectorAll('li')[0]);
  });

  it('falls back to the selector when there is no source', () => {
    expect(resolveAnchor(anchor({ selector: '#note' }), document)).toBe(document.querySelector('#note'));
  });

  it('rejects a selector hit with a different tag', () => {
    expect(resolveAnchor(anchor({ selector: '#note', tag: 'button' }), document)).toBeNull();
  });

  it('falls back to tag and text', () => {
    const found = resolveAnchor(anchor({ text: 'Returns accepted' }), document);
    expect(found).toBe(document.querySelectorAll('p')[1]);
  });

  it('returns null when nothing matches', () => {
    expect(resolveAnchor(anchor({ source: 'src/Gone.tsx:1', text: 'Nope' }), document)).toBeNull();
  });

  it('does not match on empty text', () => {
    document.body.innerHTML = '<p></p>';
    expect(resolveAnchor(anchor({ text: '' }), document)).toBeNull();
  });

  it('returns null instead of throwing on a malformed selector or tag', () => {
    expect(resolveAnchor(anchor({ selector: 'p:nth-of-type(', tag: '<bad tag>', text: 'x' }), document)).toBeNull();
  });
});
