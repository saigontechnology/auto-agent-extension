import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  type OAuthDeps,
  buildAuthorizeUrl,
  getAccessToken,
  isSignedIn,
  parseRedirect,
  signIn,
  signOut,
  watchTokens,
} from './oauth';

const settings = {
  authorizeUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/token',
  clientId: 'ext',
  scopes: 'feedback',
};
const redirectUri = 'https://abc.chromiumapp.org/';

function tokenResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeDeps(overrides: Partial<OAuthDeps> = {}): OAuthDeps {
  return {
    settings,
    redirectUri,
    now: () => 1_000_000,
    fetch: vi.fn(async () =>
      tokenResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }),
    ) as unknown as typeof fetch,
    launchWebAuthFlow: vi.fn(async (url: string) => {
      const state = new URL(url).searchParams.get('state');
      return `${redirectUri}?code=the-code&state=${state}`;
    }),
    ...overrides,
  };
}

function bodyOf(fetchMock: unknown, call = 0): URLSearchParams {
  const init = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[call]![1] as RequestInit;
  return new URLSearchParams(init.body as string);
}

describe('buildAuthorizeUrl', () => {
  it('includes the PKCE and client parameters', () => {
    const url = new URL(buildAuthorizeUrl(settings, redirectUri, 'chal', 'st'));
    expect(url.origin + url.pathname).toBe('https://auth.example.com/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'ext',
      redirect_uri: redirectUri,
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      state: 'st',
      scope: 'feedback',
    });
  });

  it('omits scope when none is configured', () => {
    const url = new URL(buildAuthorizeUrl({ ...settings, scopes: '' }, redirectUri, 'c', 's'));
    expect(url.searchParams.has('scope')).toBe(false);
  });
});

describe('parseRedirect', () => {
  it('returns the code when the state matches', () => {
    expect(parseRedirect(`${redirectUri}?code=abc&state=st`, 'st')).toBe('abc');
  });

  it('rejects a state mismatch', () => {
    expect(() => parseRedirect(`${redirectUri}?code=abc&state=other`, 'st')).toThrow('state mismatch');
  });

  it('surfaces the provider error', () => {
    expect(() =>
      parseRedirect(`${redirectUri}?error=access_denied&error_description=Nope&state=st`, 'st'),
    ).toThrow('Sign-in failed: Nope');
  });

  it('rejects a redirect without a code', () => {
    expect(() => parseRedirect(`${redirectUri}?state=st`, 'st')).toThrow('no authorization code');
  });
});

describe('sign-in and tokens', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('exchanges the code with the PKCE verifier and stores the tokens', async () => {
    const deps = makeDeps();
    await signIn(deps);

    const body = bodyOf(deps.fetch);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('client_id')).toBe('ext');
    expect(body.get('redirect_uri')).toBe(redirectUri);
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await isSignedIn()).toBe(true);
    expect(await getAccessToken(deps)).toBe('access-1');
  });

  it('fails when the auth window is closed', async () => {
    const deps = makeDeps({ launchWebAuthFlow: vi.fn(async () => undefined) });
    await expect(signIn(deps)).rejects.toThrow('Sign-in was cancelled');
    expect(await isSignedIn()).toBe(false);
  });

  it('fails when the token endpoint rejects the code', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => tokenResponse({}, 400)) as unknown as typeof fetch,
    });
    await expect(signIn(deps)).rejects.toThrow('Token request failed (400)');
    expect(await isSignedIn()).toBe(false);
  });

  it('returns null when signed out', async () => {
    expect(await getAccessToken(makeDeps())).toBeNull();
  });

  it('signs out', async () => {
    const deps = makeDeps();
    await signIn(deps);
    await signOut();
    expect(await isSignedIn()).toBe(false);
    expect(await getAccessToken(deps)).toBeNull();
  });

  it('notifies token watchers on sign-in and sign-out', async () => {
    const onChange = vi.fn();
    const unwatch = watchTokens(onChange);
    await signIn(makeDeps());
    expect(onChange).toHaveBeenCalledTimes(1);
    await signOut();
    expect(onChange).toHaveBeenCalledTimes(2);
    unwatch();
    await signIn(makeDeps());
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('refreshes a token that is about to expire and keeps the old refresh token', async () => {
    const deps = makeDeps();
    await signIn(deps);

    const later = makeDeps({
      now: () => 1_000_000 + 3600_000 - 30_000,
      fetch: vi.fn(async () =>
        tokenResponse({ access_token: 'access-2', expires_in: 3600 }),
      ) as unknown as typeof fetch,
    });
    expect(await getAccessToken(later)).toBe('access-2');
    const body = bodyOf(later.fetch);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-1');

    const afterwards = makeDeps({ now: () => 1_000_000 + 3600_000 + 3600_000 - 30_000 });
    await getAccessToken(afterwards);
    expect(bodyOf(afterwards.fetch).get('refresh_token')).toBe('refresh-1');
  });

  it('refreshes on demand even when the token looks fresh', async () => {
    const deps = makeDeps();
    await signIn(deps);
    const forced = makeDeps({
      fetch: vi.fn(async () =>
        tokenResponse({ access_token: 'access-2', expires_in: 3600 }),
      ) as unknown as typeof fetch,
    });
    expect(await getAccessToken(forced, { forceRefresh: true })).toBe('access-2');
  });

  it('shares one refresh between concurrent callers', async () => {
    const deps = makeDeps();
    await signIn(deps);
    const later = makeDeps({
      now: () => 1_000_000 + 3600_000,
      fetch: vi.fn(async () =>
        tokenResponse({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }),
      ) as unknown as typeof fetch,
    });
    const [a, b] = await Promise.all([getAccessToken(later), getAccessToken(later)]);
    expect([a, b]).toEqual(['access-2', 'access-2']);
    expect(later.fetch).toHaveBeenCalledTimes(1);
  });

  it('signs out when the refresh is rejected', async () => {
    const deps = makeDeps();
    await signIn(deps);
    const later = makeDeps({
      now: () => 1_000_000 + 3600_000,
      fetch: vi.fn(async () => tokenResponse({}, 400)) as unknown as typeof fetch,
    });
    expect(await getAccessToken(later)).toBeNull();
    expect(await isSignedIn()).toBe(false);
  });

  it('signs out when the token expired and there is no refresh token', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () =>
        tokenResponse({ access_token: 'access-1', expires_in: 3600 }),
      ) as unknown as typeof fetch,
    });
    await signIn(deps);
    const later = makeDeps({ now: () => 1_000_000 + 3600_000 });
    expect(await getAccessToken(later)).toBeNull();
    expect(later.fetch).not.toHaveBeenCalled();
    expect(await isSignedIn()).toBe(false);
  });

  it('defaults to a one-hour lifetime when expires_in is missing', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () =>
        tokenResponse({ access_token: 'access-1', refresh_token: 'r' }),
      ) as unknown as typeof fetch,
    });
    await signIn(deps);
    const almostHour = makeDeps({ now: () => 1_000_000 + 3600_000 - 120_000 });
    expect(await getAccessToken(almostHour)).toBe('access-1');
    expect(almostHour.fetch).not.toHaveBeenCalled();
  });
});
