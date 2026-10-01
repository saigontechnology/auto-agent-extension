import { describe, expect, it } from 'vitest';
import { isProbeMessage, probeAction } from './probe-events';
import { PROBE_TAG } from './probe-format';
import { MAX_MESSAGE } from './steps';

describe('isProbeMessage', () => {
  it('accepts well-formed probe messages', () => {
    expect(isProbeMessage({ tag: PROBE_TAG, event: { kind: 'console', source: 'error', message: 'x' } })).toBe(true);
    expect(
      isProbeMessage({ tag: PROBE_TAG, event: { kind: 'network', method: 'GET', url: 'u', status: null } }),
    ).toBe(true);
  });

  it('rejects other messages the page posts', () => {
    expect(isProbeMessage(null)).toBe(false);
    expect(isProbeMessage('hello')).toBe(false);
    expect(isProbeMessage({ tag: 'other', event: { kind: 'console', source: 'error', message: 'x' } })).toBe(false);
    expect(isProbeMessage({ tag: PROBE_TAG, event: { kind: 'console', source: 'warn', message: 'x' } })).toBe(false);
    expect(isProbeMessage({ tag: PROBE_TAG, event: { kind: 'network', method: 'GET', url: 'u', status: '500' } })).toBe(
      false,
    );
  });
});

describe('probeAction', () => {
  it('turns a console event into a console step body, truncated', () => {
    const long = 'x'.repeat(MAX_MESSAGE + 10);
    expect(probeAction({ kind: 'console', source: 'exception', message: long, stack: long })).toEqual({
      type: 'console',
      source: 'exception',
      message: 'x'.repeat(MAX_MESSAGE),
      stack: 'x'.repeat(MAX_MESSAGE),
      count: 1,
    });
  });

  it('turns a failed request into a network step body', () => {
    expect(probeAction({ kind: 'network', method: 'post', url: 'https://a.dev/x', status: 500 })).toEqual({
      type: 'network',
      method: 'POST',
      url: 'https://a.dev/x',
      status: 500,
      count: 1,
    });
  });

  it('ignores requests to extension pages', () => {
    expect(probeAction({ kind: 'network', method: 'GET', url: 'chrome-extension://abc/x', status: 404 })).toBeNull();
  });
});
