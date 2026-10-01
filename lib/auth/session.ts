import { storage } from '#imports';
import { ApiError, NETWORK_ERROR, UNEXPECTED_RESPONSE, envelopeMessage } from '../api/errors';

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  allowedServices: string[];
};

export type Session = { accessToken: string; refreshToken: string; expiresAt: number; user: User };

export type SessionDeps = {
  apiBase: string;
  /** `chrome.identity.getRedirectURL('auth')`, the address Auto Agent sends the tokens to. */
  redirectUri: string;
  fetch: typeof fetch;
  now: () => number;
  newState: () => string;
  launchWebAuthFlow: (details: WebAuthFlowDetails) => Promise<string | undefined>;
};

/** The subset of `chrome.identity.launchWebAuthFlow`'s details that sign-in uses. */
export type WebAuthFlowDetails = {
  url: string;
  interactive: boolean;
  abortOnLoadForNonInteractive?: boolean;
  timeoutMsForNonInteractive?: number;
};

export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInError';
  }
}

export const CANCELLED_MESSAGE =
  'Sign-in was cancelled. If the window showed the Auto Agent site, this extension is not allowed yet; ask the Auto Agent team to add its ID.';
export const STATE_MISMATCH_MESSAGE = 'Sign-in response did not match the request. Try again.';
const NO_SESSION_MESSAGE = 'Sign-in did not return a session. Try again.';

/** Auto Agent's access tokens last 15 minutes; used only when a token's `exp` cannot be read. */
const DEFAULT_LIFETIME_MS = 15 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;
/**
 * How long the silent attempt may take. A browser already signed in to the company account
 * finishes Microsoft's redirects well within this; anyone else waits this long for the window.
 */
const SILENT_TIMEOUT_MS = 5000;

const sessionItem = storage.defineItem<Session | null>('local:session', { fallback: null });

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
}

/** The expiry of a JWT in epoch milliseconds, or null when it has no readable `exp`. */
export function jwtExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const exp = (JSON.parse(decodeBase64Url(payload)) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function isUser(value: unknown): value is User {
  const user = value as Partial<User> | null;
  return (
    typeof user === 'object' &&
    user !== null &&
    typeof user.id === 'string' &&
    typeof user.username === 'string' &&
    typeof user.displayName === 'string' &&
    typeof user.role === 'string' &&
    Array.isArray(user.allowedServices)
  );
}

export function buildLoginUrl(apiBase: string, redirectUri: string, state: string): string {
  const url = new URL(`${apiBase}/auth/login`);
  url.searchParams.set('cli_redirect', redirectUri);
  url.searchParams.set('cli_state', state);
  return url.toString();
}

/** Reads the session out of the URL Auto Agent redirected to, rejecting a forged or partial one. */
export function parseSignInRedirect(redirectUrl: string, expectedState: string, now: number): Session {
  const params = new URL(redirectUrl).searchParams;
  if (params.get('state') !== expectedState) throw new SignInError(STATE_MISMATCH_MESSAGE);
  const accessToken = params.get('token');
  const refreshToken = params.get('refreshToken');
  let user: unknown = null;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    // Reported below as a missing session.
  }
  if (!accessToken || !refreshToken || !isUser(user)) throw new SignInError(NO_SESSION_MESSAGE);
  return { accessToken, refreshToken, expiresAt: jwtExpiry(accessToken) ?? now + DEFAULT_LIFETIME_MS, user };
}

async function attempt(deps: SessionDeps, interactive: boolean): Promise<Session> {
  const state = deps.newState();
  let redirect: string | undefined;
  try {
    const url = buildLoginUrl(deps.apiBase, deps.redirectUri, state);
    redirect = await deps.launchWebAuthFlow(
      interactive
        ? { url, interactive }
        : // Let Microsoft redirect on its own instead of giving up when its first page loads.
          { url, interactive, abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: SILENT_TIMEOUT_MS },
    );
  } catch {
    throw new SignInError(CANCELLED_MESSAGE);
  }
  if (!redirect) throw new SignInError(CANCELLED_MESSAGE);
  return parseSignInRedirect(redirect, state, deps.now());
}

// Two sign-ins at once would each send their own state, and one would always fail to match.
let signingIn: Promise<Session> | null = null;

/** Tries the Microsoft account the browser already uses, and shows the window only if needed. */
export function signIn(deps: SessionDeps): Promise<Session> {
  signingIn ??= (async () => {
    let session: Session;
    try {
      session = await attempt(deps, false);
    } catch {
      session = await attempt(deps, true);
    }
    await sessionItem.setValue(session);
    return session;
  })().finally(() => {
    signingIn = null;
  });
  return signingIn;
}

/** Auto Agent keeps no server session, so forgetting the tokens is all signing out takes. */
export async function signOut(): Promise<void> {
  await sessionItem.setValue(null);
}

export function getSession(): Promise<Session | null> {
  return sessionItem.getValue();
}

/** Fires on sign-in, sign-out, refresh, and when a failed refresh ends the session. */
export function watchSession(callback: (session: Session | null) => void): () => void {
  return sessionItem.watch((session) => callback(session ?? null));
}

// Refresh tokens rotate, so concurrent callers must share one refresh.
let refreshing: Promise<string | null> | null = null;

async function refresh(deps: SessionDeps, session: Session): Promise<string | null> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.apiBase}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
  } catch {
    throw new ApiError(NETWORK_ERROR);
  }
  if (response.status === 401) {
    await signOut();
    return null;
  }
  const body = (await response.json().catch(() => null)) as {
    data?: { accessToken?: unknown; refreshToken?: unknown };
  } | null;
  if (!response.ok) {
    throw new ApiError(envelopeMessage(body) ?? `Request failed (${response.status})`, response.status);
  }
  const accessToken = body?.data?.accessToken;
  const refreshToken = body?.data?.refreshToken;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') throw new ApiError(UNEXPECTED_RESPONSE);

  // The reviewer may have signed out or in again while the request was out.
  const current = await sessionItem.getValue();
  if (current?.refreshToken !== session.refreshToken) return current?.accessToken ?? null;
  await sessionItem.setValue({
    ...current,
    accessToken,
    refreshToken,
    expiresAt: jwtExpiry(accessToken) ?? deps.now() + DEFAULT_LIFETIME_MS,
  });
  return accessToken;
}

/** A usable access token, refreshed when it is about to expire, or null when sign-in is needed. */
export async function getAccessToken(
  deps: SessionDeps,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const session = await sessionItem.getValue();
  if (!session) return null;
  const fresh = session.expiresAt - deps.now() > EXPIRY_MARGIN_MS;
  if (fresh && !options.forceRefresh) return session.accessToken;
  refreshing ??= refresh(deps, session).finally(() => {
    refreshing = null;
  });
  return refreshing;
}
