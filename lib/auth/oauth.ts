import { storage } from '#imports';
import type { OAuthSettings } from '../types';
import { createChallenge, createState, createVerifier } from './pkce';

export type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number };

export type OAuthDeps = {
  settings: OAuthSettings;
  redirectUri: string;
  fetch: typeof fetch;
  now: () => number;
  launchWebAuthFlow: (url: string) => Promise<string | undefined>;
};

const EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_EXPIRES_IN_S = 3600;

const tokensItem = storage.defineItem<Tokens | null>('local:tokens', { fallback: null });

export function buildAuthorizeUrl(
  settings: OAuthSettings,
  redirectUri: string,
  challenge: string,
  state: string,
): string {
  const url = new URL(settings.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (settings.scopes) url.searchParams.set('scope', settings.scopes);
  return url.toString();
}

/** Extracts the authorization code from the redirect, rejecting errors and forged states. */
export function parseRedirect(redirectUrl: string, expectedState: string): string {
  const params = new URL(redirectUrl).searchParams;
  const error = params.get('error');
  if (error) throw new Error(`Sign-in failed: ${params.get('error_description') ?? error}`);
  if (params.get('state') !== expectedState) throw new Error('Sign-in failed: state mismatch');
  const code = params.get('code');
  if (!code) throw new Error('Sign-in failed: no authorization code returned');
  return code;
}

async function requestTokens(
  deps: OAuthDeps,
  body: Record<string, string>,
  previous?: Tokens,
): Promise<Tokens> {
  const response = await deps.fetch(deps.settings.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: deps.settings.clientId, ...body }).toString(),
  });
  if (!response.ok) throw new Error(`Token request failed (${response.status})`);
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error('Token response had no access_token');
  const refreshToken = json.refresh_token ?? previous?.refreshToken;
  return {
    accessToken: json.access_token,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: deps.now() + (json.expires_in ?? DEFAULT_EXPIRES_IN_S) * 1000,
  };
}

export async function signIn(deps: OAuthDeps): Promise<void> {
  const verifier = createVerifier();
  const state = createState();
  const challenge = await createChallenge(verifier);
  const redirectUrl = await deps.launchWebAuthFlow(
    buildAuthorizeUrl(deps.settings, deps.redirectUri, challenge, state),
  );
  if (!redirectUrl) throw new Error('Sign-in was cancelled');
  const code = parseRedirect(redirectUrl, state);
  const tokens = await requestTokens(deps, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: deps.redirectUri,
    code_verifier: verifier,
  });
  await tokensItem.setValue(tokens);
}

export async function signOut(): Promise<void> {
  await tokensItem.setValue(null);
}

export async function isSignedIn(): Promise<boolean> {
  return (await tokensItem.getValue()) !== null;
}

/** Fires whenever the stored tokens change: sign-in, sign-out, refresh, or a forced sign-out. */
export function watchTokens(callback: () => void): () => void {
  return tokensItem.watch(() => callback());
}

// Refresh tokens are often single-use, so concurrent callers must share one refresh.
let refreshing: Promise<string | null> | null = null;

async function refresh(deps: OAuthDeps, tokens: Tokens): Promise<string | null> {
  if (!tokens.refreshToken) {
    await signOut();
    return null;
  }
  try {
    const next = await requestTokens(
      deps,
      { grant_type: 'refresh_token', refresh_token: tokens.refreshToken },
      tokens,
    );
    await tokensItem.setValue(next);
    return next.accessToken;
  } catch {
    await signOut();
    return null;
  }
}

/** Returns a usable access token, refreshing it when needed, or null when sign-in is required. */
export async function getAccessToken(
  deps: OAuthDeps,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const tokens = await tokensItem.getValue();
  if (!tokens) return null;
  const fresh = tokens.expiresAt - deps.now() > EXPIRY_MARGIN_MS;
  if (fresh && !options.forceRefresh) return tokens.accessToken;
  refreshing ??= refresh(deps, tokens).finally(() => {
    refreshing = null;
  });
  return refreshing;
}
