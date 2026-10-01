import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { NETWORK_ERROR } from '../api/errors';
import { makeJwt, makeSession, makeUser } from '../test-helpers';
import {
  CANCELLED_MESSAGE,
  STATE_MISMATCH_MESSAGE,
  type SessionDeps,
  buildLoginUrl,
  getAccessToken,
  getSession,
  jwtExpiry,
  parseSignInRedirect,
  signIn,
  signOut,
} from './session';

const NOW = Date.parse('2026-10-01T10:00:00Z');
const REDIRECT = 'https://halobcdjpokedneejfmdjecjgdkejjdk.chromiumapp.org/auth';

function redirectWith(params: Record<string, string>): string {
  const url = new URL(REDIRECT);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function goodRedirect(state = 'state-1'): string {
  return redirectWith({
    token: makeJwt(NOW / 1000 + 900),
    refreshToken: 'r1',
    user: JSON.stringify(makeUser()),
    state,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function refreshed(accessToken: string) {
  return vi.fn(async () => json({ data: { accessToken, refreshToken: 'r2' }, message: 'ok', error: null }));
}

function makeDeps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    apiBase: 'https://aa.test/api/v1',
    redirectUri: REDIRECT,
    fetch: vi.fn(),
    now: () => NOW,
    newState: () => 'state-1',
    launchWebAuthFlow: vi.fn(async () => goodRedirect()),
    ...overrides,
  };
}

async function storeSession(overrides = {}) {
  await fakeBrowser.storage.local.set({ session: makeSession(overrides) });
}

describe('session', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('builds the login URL with the redirect and state', () => {
    const url = new URL(buildLoginUrl('https://aa.test/api/v1', REDIRECT, 'nonce'));
    expect(url.origin + url.pathname).toBe('https://aa.test/api/v1/auth/login');
    expect(url.searchParams.get('cli_redirect')).toBe(REDIRECT);
    expect(url.searchParams.get('cli_state')).toBe('nonce');
  });

  it('reads tokens, user and expiry from the sign-in redirect', () => {
    const session = parseSignInRedirect(goodRedirect(), 'state-1', NOW);
    expect(session.refreshToken).toBe('r1');
    expect(session.user.displayName).toBe('Ada Lovelace');
    expect(session.expiresAt).toBe(NOW + 900_000);
  });

  it('rejects a redirect whose state is not the one sent', () => {
    expect(() => parseSignInRedirect(goodRedirect('other'), 'state-1', NOW)).toThrow(STATE_MISMATCH_MESSAGE);
  });

  it('rejects a redirect without tokens or user', () => {
    expect(() => parseSignInRedirect(redirectWith({ state: 'state-1' }), 'state-1', NOW)).toThrow();
    const noUser = redirectWith({ token: 't', refreshToken: 'r', user: '{}', state: 'state-1' });
    expect(() => parseSignInRedirect(noUser, 'state-1', NOW)).toThrow();
  });

  it('falls back to a 15-minute lifetime when the token has no readable exp', () => {
    expect(jwtExpiry('not-a-jwt')).toBeNull();
    const redirect = redirectWith({
      token: 'opaque',
      refreshToken: 'r1',
      user: JSON.stringify(makeUser()),
      state: 'state-1',
    });
    expect(parseSignInRedirect(redirect, 'state-1', NOW).expiresAt).toBe(NOW + 15 * 60_000);
  });

  it('signs in silently first and stores the session', async () => {
    const deps = makeDeps();
    const session = await signIn(deps);
    expect(session.user.username).toBe('ada.l');
    expect(deps.launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.launchWebAuthFlow).mock.calls[0]![0].interactive).toBe(false);
    expect(await getSession()).toEqual(session);
  });

  it('shows the Microsoft window when the silent attempt fails', async () => {
    const launch = vi
      .fn<SessionDeps['launchWebAuthFlow']>()
      .mockRejectedValueOnce(new Error('User interaction required.'))
      .mockResolvedValueOnce(goodRedirect());
    await signIn(makeDeps({ launchWebAuthFlow: launch }));
    expect(launch.mock.calls.map((call) => call[0].interactive)).toEqual([false, true]);
    expect(await getSession()).not.toBeNull();
  });

  it('reports a cancelled sign-in and stores nothing', async () => {
    const launch = vi.fn(async () => {
      throw new Error('The user did not approve access.');
    });
    await expect(signIn(makeDeps({ launchWebAuthFlow: launch }))).rejects.toThrow(CANCELLED_MESSAGE);
    expect(await getSession()).toBeNull();
  });

  it('returns null when signed out', async () => {
    expect(await getAccessToken(makeDeps())).toBeNull();
  });

  it('returns the stored token while it is fresh, without a request', async () => {
    await storeSession();
    const deps = makeDeps();
    expect(await getAccessToken(deps)).toBe(makeSession().accessToken);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('refreshes within a minute of expiry and keeps both new tokens and the user', async () => {
    await storeSession({ expiresAt: NOW + 30_000 });
    const next = makeJwt(NOW / 1000 + 900);
    const fetch = refreshed(next);
    expect(await getAccessToken(makeDeps({ fetch }))).toBe(next);
    expect(fetch).toHaveBeenCalledWith(
      'https://aa.test/api/v1/auth/refresh',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ refreshToken: 'refresh-1' }) }),
    );
    expect(await getSession()).toMatchObject({
      accessToken: next,
      refreshToken: 'r2',
      expiresAt: NOW + 900_000,
      user: { id: 'u1' },
    });
  });

  it('shares one refresh between concurrent callers', async () => {
    await storeSession({ expiresAt: NOW - 1 });
    const next = makeJwt(NOW / 1000 + 900);
    const fetch = refreshed(next);
    const deps = makeDeps({ fetch });
    const tokens = await Promise.all([getAccessToken(deps), getAccessToken(deps), getAccessToken(deps)]);
    expect(tokens).toEqual([next, next, next]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes on demand even when the token looks fresh', async () => {
    await storeSession();
    const next = makeJwt(NOW / 1000 + 900);
    expect(await getAccessToken(makeDeps({ fetch: refreshed(next) }), { forceRefresh: true })).toBe(next);
  });

  it('ends the session when refresh answers 401', async () => {
    await storeSession({ expiresAt: NOW - 1 });
    const fetch = vi.fn(async () => json({ data: null, message: 'Invalid refresh token', error: 'UNAUTHORIZED' }, 401));
    expect(await getAccessToken(makeDeps({ fetch }))).toBeNull();
    expect(await getSession()).toBeNull();
  });

  it('keeps the session when refresh cannot reach the server', async () => {
    await storeSession({ expiresAt: NOW - 1 });
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(getAccessToken(makeDeps({ fetch }))).rejects.toThrow(NETWORK_ERROR);
    expect(await getSession()).not.toBeNull();
  });

  it('signs out by removing the session', async () => {
    await storeSession();
    await signOut();
    expect(await getSession()).toBeNull();
  });
});
