import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_HTML, MAX_TEXT, describeElement } from './element-descriptor';

describe('describeElement', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section data-vibe-source="src/pages/Home.tsx:10">
        <h1 data-vibe-source="src/pages/Home.tsx:12">  Welcome
          back </h1>
        <div><button id="buy">Buy</button></div>
      </section>
      <footer><p id="plain">No source here</p></footer>`;
  });

  it('records the element own source', () => {
    const anchor = describeElement(document.querySelector('h1')!);
    expect(anchor.source).toBe('src/pages/Home.tsx:12');
    expect(anchor).not.toHaveProperty('nearestSource');
    expect(anchor.tag).toBe('h1');
    expect(anchor.text).toBe('Welcome back');
  });

  it('records the nearest ancestor source when the element has none', () => {
    const anchor = describeElement(document.querySelector('#buy')!);
    expect(anchor).not.toHaveProperty('source');
    expect(anchor.nearestSource).toBe('src/pages/Home.tsx:10');
    expect(anchor.selector).toBe('#buy');
    expect(anchor.html).toBe('<button id="buy">Buy</button>');
  });

  it('records neither when no ancestor has a source', () => {
    const anchor = describeElement(document.querySelector('#plain')!);
    expect(anchor).not.toHaveProperty('source');
    expect(anchor).not.toHaveProperty('nearestSource');
  });

  it('truncates long text and html', () => {
    const p = document.querySelector('#plain')!;
    p.textContent = 'x'.repeat(5000);
    const anchor = describeElement(p);
    expect(anchor.text).toHaveLength(MAX_TEXT);
    expect(anchor.html).toHaveLength(MAX_HTML);
  });

  it('reports a rect with numeric fields', () => {
    const { rect } = describeElement(document.querySelector('#buy')!);
    expect(Object.keys(rect).sort()).toEqual(['height', 'width', 'x', 'y']);
    for (const value of Object.values(rect)) expect(typeof value).toBe('number');
  });
});
