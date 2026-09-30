import { describe, expect, it } from 'vitest';
import { base64UrlEncode, createChallenge, createState, createVerifier } from './pkce';

describe('pkce', () => {
  it('encodes without padding or URL-unsafe characters', () => {
    expect(base64UrlEncode(new Uint8Array([251, 255, 254]))).toBe('-__-');
    expect(base64UrlEncode(new Uint8Array([1]))).toBe('AQ');
  });

  it('matches the RFC 7636 appendix B example', async () => {
    expect(await createChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('creates a 43-character verifier from the unreserved alphabet', () => {
    expect(createVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('creates a different verifier and state each time', () => {
    expect(createVerifier()).not.toBe(createVerifier());
    expect(createState()).not.toBe(createState());
  });
});
