import { describe, expect, it } from 'vitest';
import { collapseText, truncate } from './text';

describe('collapseText', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(collapseText('  Buy \n\t now  ')).toBe('Buy now');
  });

  it('returns an empty string for whitespace only', () => {
    expect(collapseText(' \n ')).toBe('');
  });
});

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('abc', 3)).toBe('abc');
  });

  it('cuts long strings to the limit', () => {
    expect(truncate('abcdef', 3)).toBe('abc');
  });
});
