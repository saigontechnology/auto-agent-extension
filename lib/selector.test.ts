import { beforeEach, describe, expect, it } from 'vitest';
import { buildSelector } from './selector';

function expectUnique(element: Element): string {
  const selector = buildSelector(element);
  expect(Array.from(document.querySelectorAll(selector))).toEqual([element]);
  return selector;
}

describe('buildSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header><h1 id="title">Shop</h1></header>
      <main>
        <section><p>One</p><p class="css-1x2y3z">Two</p><button data-testid="buy">Buy</button></section>
        <section><p>Three</p><span id="dup">a</span><span id="dup">b</span></section>
        <ul><li>x</li><li>y</li><li>z</li></ul>
      </main>`;
  });

  it('uses a unique id', () => {
    expect(expectUnique(document.querySelector('h1')!)).toBe('#title');
  });

  it('uses a unique data-testid', () => {
    expect(expectUnique(document.querySelector('button')!)).toBe('[data-testid="buy"]');
  });

  it('falls back to a tag path and never uses class names', () => {
    const selector = expectUnique(document.querySelectorAll('p')[1]!);
    expect(selector).toBe('html > body > main:nth-of-type(1) > section:nth-of-type(1) > p:nth-of-type(2)');
    expect(selector).not.toContain('css-');
  });

  it('distinguishes repeated siblings', () => {
    const items = Array.from(document.querySelectorAll('li'));
    const selectors = items.map(expectUnique);
    expect(new Set(selectors).size).toBe(3);
  });

  it('does not trust an id that is duplicated in the document', () => {
    const [first, second] = Array.from(document.querySelectorAll('span'));
    expect(expectUnique(first!)).not.toContain('#dup');
    expect(expectUnique(second!)).not.toContain('#dup');
  });

  it('anchors the path at the nearest ancestor with a unique id', () => {
    document.body.innerHTML = '<div id="card"><p>a</p><p>b</p></div>';
    expect(expectUnique(document.querySelectorAll('p')[1]!)).toBe('#card > p:nth-of-type(2)');
  });

  it('handles ids that are not valid CSS identifiers', () => {
    document.body.innerHTML = '<div id="1:a.b">x</div>';
    expect(expectUnique(document.querySelector('div')!)).toBe('[id="1:a.b"]');
  });

  it('handles body and html', () => {
    expect(buildSelector(document.body)).toBe('html > body');
    expect(buildSelector(document.documentElement)).toBe('html');
  });
});
