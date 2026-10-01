import { describe, expect, it } from 'vitest';
import { absoluteUrl, formatArgs, formatValue, isFailedStatus } from './probe-format';

describe('formatValue', () => {
  it('formats errors, strings and plain data', () => {
    expect(formatValue(new TypeError('bad'))).toBe('TypeError: bad');
    expect(formatValue('text')).toBe('text');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue(undefined)).toBe('undefined');
    expect(formatValue(function named() {})).toBe('[function named]');
  });

  it('never throws on values JSON cannot handle', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatValue(circular)).toBe('[object Object]');
    expect(formatValue(10n)).toBe('10');
    expect(formatValue(Symbol('s'))).toBe('Symbol(s)');
    expect(formatValue(Object.create(null))).toBe('{}');
    const hostile = { toJSON: () => { throw new Error('no'); }, toString: () => { throw new Error('no'); } };
    expect(formatValue(hostile)).toBe('[unprintable]');
  });
});

describe('formatArgs', () => {
  it('joins console arguments and keeps the stack of the first error', () => {
    const error = new Error('Boom');
    const result = formatArgs(['Failed:', error, 42]);
    expect(result.message).toBe('Failed: Error: Boom 42');
    expect(result.stack).toBe(error.stack);
  });

  it('has no stack when no argument is an error', () => {
    expect(formatArgs(['a', 'b'])).toEqual({ message: 'a b' });
  });

  it('slices message to MAX_REPORT', () => {
    const long = 'x'.repeat(5000);
    const result = formatArgs([long]);
    expect(result.message).toBe('x'.repeat(4000));
    expect(result.message.length).toBe(4000);
  });
});

describe('isFailedStatus', () => {
  it('treats 4xx and 5xx as failures', () => {
    expect(isFailedStatus(404)).toBe(true);
    expect(isFailedStatus(500)).toBe(true);
    expect(isFailedStatus(200)).toBe(false);
    expect(isFailedStatus(304)).toBe(false);
    // An opaque no-cors response has status 0 and is not known to have failed.
    expect(isFailedStatus(0)).toBe(false);
  });
});

describe('absoluteUrl', () => {
  it('resolves relative URLs against the page', () => {
    expect(absoluteUrl('/api/login', 'https://demo.web.app/login')).toBe('https://demo.web.app/api/login');
    expect(absoluteUrl(new URL('https://x.dev/a'), 'https://demo.web.app/')).toBe('https://x.dev/a');
  });

  it('returns the input when it cannot be parsed', () => {
    expect(absoluteUrl('http://[bad', 'https://demo.web.app/')).toBe('http://[bad');
  });
});
