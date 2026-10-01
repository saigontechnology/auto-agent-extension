# Auto Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign reviewers in with Auto Agent, find the demo job the open preview belongs to, and turn **Send** into an Update Feedback run on that job, with its status shown in the panel.

**Architecture:** A session module runs Auto Agent's browser-extension sign-in in the background worker and keeps the tokens fresh. One HTTP client knows Auto Agent's URLs and envelope; a resolver matches the page's origin to a demo job's `deploymentUrl` and caches the answer. The background's `submit` uploads the drafts as a JSON file and starts a feedback run with a Markdown description; the panel gates everything behind sign-in, shows the matched demo (or a picker), and polls the demo's `feedbackHistory` for run status.

**Tech Stack:** WXT 0.21, React 19, TypeScript 7, Manifest V3, vitest 5 with `wxt/testing` fake browser, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-01-auto-agent-integration-design.md`

## Global Constraints

- API base: `https://vibe.saigontechnology.vn/api/v1`, overridable at build time with `WXT_API_BASE`. Tokens are sent only to that host and never logged.
- Extension ID stays `halobcdjpokedneejfmdjecjgdkejjdk`: do not touch `key` in `wxt.config.ts`.
- Sign-in runs in the background worker, silent first (`interactive: false`, `abortOnLoadForNonInteractive: false`, `timeoutMsForNonInteractive: 15000`), interactive on failure. The returned `state` must equal the `cli_state` sent.
- Refresh 60 s before `exp`; one refresh at a time; refresh `401` clears the session.
- Feedback is accepted only on `SUCCESS` jobs of `FRONTEND_DEMO`, `FRONTEND_DEMO_NEXT_PHASE`, `MOBILE_DEMO`, `MOBILE_DEMO_NEXT_PHASE`.
- `description` at most 10,000 characters. Exactly one uploaded `.json` file per Send.
- At most 4 detail requests (`GET /jobs/:id`) in flight during a scan.
- Run status polling: every 10 s, only while the panel is visible and a run is unfinished. `SUCCESS`, `FAILED`, `CANCELLED` are finished.
- User-facing messages, verbatim:
  - `Sign-in was cancelled. If the window showed the Auto Agent site, this extension is not allowed yet; ask the Auto Agent team to add its ID.`
  - `Sign-in response did not match the request. Try again.`
  - `Your session ended. Sign in again.`
  - `You no longer have access to this demo.`
  - `Could not reach Auto Agent. Check your connection.`
  - `Auto Agent sent an unexpected response.`
  - `Choose the demo this page belongs to before sending.`
  - `This page did not match any of your demos. Choose one:`
  - `Finding this demo in Auto Agent…`
- Code style: match the surrounding files (2-space indent, single quotes, JSDoc on exported functions where the neighbours have it, comments explain *why*).
- Commit messages: conventional prefix (`feat:`, `test:`, `fix:`, `docs:`) and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012zhLqcq7VSrn5DJJZg3ie3
  ```

## Review Focus

1. **A double click on Send** must start one run, not two. React state does not update between two clicks in the same frame, so the guard needs a ref. Test: Task 7 e2e double-clicks Send and checks the fake API has exactly one run.
2. **Page URL variants** (`<site>.firebaseapp.com`, upper-case host, path/query/hash, trailing slash) must match the same demo as `https://<site>.web.app`. Test: Task 3 `normalizeOrigin` and `pickMatch` cases.
3. **A demo job with `deploymentUrl: null` or a non-URL string** must be skipped, not crash the scan. Test: Task 3 `pickMatch` and resolver cases.
4. **The 15-minute token expiring while several calls run** (scan + poll) must cause one refresh, and every call must get the new token. Test: Task 1 concurrent `getAccessToken`.
5. **Losing access to the matched project** (403/404) must forget the cached match so the picker comes back, instead of failing forever. Test: Task 5 handler tests for `submit` and `job-runs`.

---

### Task 0: Clean working tree

The tree has staged, uncommitted changes from the user (the `WORKFLOW_RECORDING` flag in `lib/config.ts`, `README.md`, `entrypoints/panel/App.tsx`, `e2e/flow.spec.ts`). Tasks 1, 6 and 7 edit those files.

- [ ] **Step 1:** Run `git status --short`. If anything is listed, stop and ask the user to commit or stash it. Do not commit it on their behalf.

---

### Task 1: Session (sign-in, refresh, sign-out)

**Files:**
- Modify: `lib/config.ts`
- Create: `lib/api/errors.ts`
- Create: `lib/auth/session.ts`
- Create: `lib/auth/session.test.ts`
- Modify: `lib/test-helpers.ts`

**Interfaces:**
- Produces:
  - `lib/config.ts`: `API_BASE: string`, `WEB_BASE: string`
  - `lib/api/errors.ts`: `class ApiError(message: string, status?: number)`, `class UnauthorizedError extends ApiError`, `NETWORK_ERROR`, `UNEXPECTED_RESPONSE`, `envelopeMessage(body: unknown): string | undefined`
  - `lib/auth/session.ts`: `type User`, `type Session`, `type SessionDeps`, `signIn(deps): Promise<Session>`, `signOut(): Promise<void>`, `getSession(): Promise<Session | null>`, `watchSession(cb: (s: Session | null) => void): () => void`, `getAccessToken(deps, { forceRefresh? }): Promise<string | null>`, `buildLoginUrl`, `parseSignInRedirect`, `jwtExpiry`, `CANCELLED_MESSAGE`, `STATE_MISMATCH_MESSAGE`, `SignInError`
  - `lib/test-helpers.ts`: `makeJwt(expSeconds)`, `makeUser(overrides?)`, `makeSession(overrides?)`

- [ ] **Step 1: Add the API base to config**

Append to `lib/config.ts` (keep everything already there):

```ts
/** Auto Agent's API. End-to-end tests build against a fake one through `WXT_API_BASE`. */
export const API_BASE: string =
  (import.meta.env.WXT_API_BASE as string | undefined) || 'https://vibe.saigontechnology.vn/api/v1';

/** The Auto Agent web app; a run opens at `${WEB_BASE}/jobs/<id>`. */
export const WEB_BASE: string = new URL(API_BASE).origin;
```

- [ ] **Step 2: Create the shared error types**

`lib/api/errors.ts`:

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The session is gone: the reviewer has to sign in again. */
export class UnauthorizedError extends ApiError {
  constructor() {
    super('Your session ended. Sign in again.', 401);
    this.name = 'UnauthorizedError';
  }
}

export const NETWORK_ERROR = 'Could not reach Auto Agent. Check your connection.';
export const UNEXPECTED_RESPONSE = 'Auto Agent sent an unexpected response.';

/** The `message` of an Auto Agent response envelope, when the body has a usable one. */
export function envelopeMessage(body: unknown): string | undefined {
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() !== '' ? message : undefined;
}
```

- [ ] **Step 3: Add test helpers**

Append to `lib/test-helpers.ts`, and add `import type { Session, User } from './auth/session';` at the top:

```ts
/** An unsigned JWT whose payload carries `exp`, which is all the extension reads. */
export function makeJwt(expSeconds: number): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'u1', exp: expSeconds })}.signature`;
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    username: 'ada.l',
    displayName: 'Ada Lovelace',
    role: 'DEVELOPER',
    allowedServices: ['DEMO_FEEDBACK'],
    ...overrides,
  };
}

/** A session valid until 2026-10-01T11:00:00Z. */
export function makeSession(overrides: Partial<Session> = {}): Session {
  const expiresAt = Date.parse('2026-10-01T11:00:00Z');
  return {
    accessToken: makeJwt(expiresAt / 1000),
    refreshToken: 'refresh-1',
    expiresAt,
    user: makeUser(),
    ...overrides,
  };
}
```

- [ ] **Step 4: Write the failing tests**

`lib/auth/session.test.ts`:

```ts
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
    const fetch = vi.fn(async () => json({ data: { accessToken: next, refreshToken: 'r2' }, message: 'ok', error: null }));
    expect(await getAccessToken(makeDeps({ fetch }))).toBe(next);
    expect(fetch).toHaveBeenCalledWith(
      'https://aa.test/api/v1/auth/refresh',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ refreshToken: 'refresh-1' }) }),
    );
    expect(await getSession()).toMatchObject({ accessToken: next, refreshToken: 'r2', expiresAt: NOW + 900_000, user: { id: 'u1' } });
  });

  it('shares one refresh between concurrent callers', async () => {
    await storeSession({ expiresAt: NOW - 1 });
    const next = makeJwt(NOW / 1000 + 900);
    const fetch = vi.fn(async () => json({ data: { accessToken: next, refreshToken: 'r2' }, message: 'ok', error: null }));
    const deps = makeDeps({ fetch });
    const tokens = await Promise.all([getAccessToken(deps), getAccessToken(deps), getAccessToken(deps)]);
    expect(tokens).toEqual([next, next, next]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes on demand even when the token looks fresh', async () => {
    await storeSession();
    const next = makeJwt(NOW / 1000 + 900);
    const fetch = vi.fn(async () => json({ data: { accessToken: next, refreshToken: 'r2' }, message: 'ok', error: null }));
    expect(await getAccessToken(makeDeps({ fetch }), { forceRefresh: true })).toBe(next);
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
```

- [ ] **Step 5: Run the tests to see them fail**

Run: `pnpm vitest run lib/auth/session.test.ts`
Expected: FAIL, because `./session` cannot be resolved.

- [ ] **Step 6: Implement the session module**

`lib/auth/session.ts`:

```ts
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
  launchWebAuthFlow: (details: { url: string; interactive: boolean }) => Promise<string | undefined>;
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
    redirect = await deps.launchWebAuthFlow({
      url: buildLoginUrl(deps.apiBase, deps.redirectUri, state),
      interactive,
    });
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
  const body = (await response.json().catch(() => null)) as { data?: { accessToken?: unknown; refreshToken?: unknown } } | null;
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
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm vitest run lib/auth/session.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 8: Commit**

```bash
git add lib/config.ts lib/api/errors.ts lib/auth/session.ts lib/auth/session.test.ts lib/test-helpers.ts
git commit -m "feat: sign in with Auto Agent and keep the session fresh"
```

---

### Task 2: Auto Agent HTTP client

**Files:**
- Create: `lib/api/auto-agent-client.ts`
- Create: `lib/api/auto-agent-client.test.ts`

**Interfaces:**
- Consumes: `ApiError`, `UnauthorizedError`, `NETWORK_ERROR`, `UNEXPECTED_RESPONSE`, `envelopeMessage` from `lib/api/errors.ts` (Task 1).
- Produces:
  ```ts
  type Project = { id: string; name: string };
  type JobSummary = { id: string; serviceType: string; status: string; jobName: string; completedAt: string | null };
  type FeedbackRun = { id: string; status: string; createdAt: string; completedAt: string | null; feedbackDescription: string | null; feedbackFiles: string[]; createdBy: string };
  type JobDetail = JobSummary & { deploymentUrl: string | null; feedbackHistory: FeedbackRun[] };
  type CreatedRun = { id: string; status: string; requiresApproval: boolean };
  type ListPage<T> = { items: T[]; total: number };
  type AutoAgentClient = {
    listProjects(page: number): Promise<ListPage<Project>>;
    listJobs(projectId: string, page: number): Promise<ListPage<JobSummary>>; // SUCCESS only
    getJob(id: string): Promise<JobDetail>;
    uploadFeedbackFile(file: File): Promise<string>; // the file id
    createFeedbackRun(demoJobId: string, body: { description: string; fileIds: string[] }): Promise<CreatedRun>;
  };
  type ClientDeps = { apiBase: string; fetch: typeof fetch; getAccessToken: (o?: { forceRefresh?: boolean }) => Promise<string | null>; onUnauthorized: () => Promise<void> };
  function createAutoAgentClient(deps: ClientDeps): AutoAgentClient;
  const PAGE_SIZE = 100;
  ```

- [ ] **Step 1: Write the failing tests**

`lib/api/auto-agent-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { type ClientDeps, createAutoAgentClient } from './auto-agent-client';
import { NETWORK_ERROR, UNEXPECTED_RESPONSE, UnauthorizedError } from './errors';

const BASE = 'https://aa.test/api/v1';

function envelope(data: unknown, pagination: unknown = null, status = 200, message = 'ok'): Response {
  return new Response(JSON.stringify({ data, message, error: status < 400 ? null : 'ERROR', pagination }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeDeps(responses: Response[], overrides: Partial<ClientDeps> = {}): ClientDeps {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('No more responses');
    return next;
  });
  return {
    apiBase: BASE,
    fetch,
    getAccessToken: vi.fn(async (options?: { forceRefresh?: boolean }) => (options?.forceRefresh ? 'token-2' : 'token-1')),
    onUnauthorized: vi.fn(async () => undefined),
    ...overrides,
  };
}

const DETAIL = {
  id: 'job-1',
  serviceType: 'FRONTEND_DEMO',
  status: 'SUCCESS',
  jobName: 'Frontend Demo #job-1',
  completedAt: '2026-10-01T13:03:49.897Z',
  deploymentUrl: 'https://shop.web.app',
  project: { id: 'p1', name: 'Shop' },
  feedbackHistory: [
    {
      id: 'run-1',
      status: 'SUCCESS',
      createdAt: '2026-10-01T04:27:54.915Z',
      completedAt: '2026-10-01T04:29:55.431Z',
      feedbackDescription: null,
      feedbackFiles: ['a.json'],
      createdBy: 'Tung.Le',
    },
  ],
};

describe('createAutoAgentClient', () => {
  it('lists projects with the bearer token and the total from pagination', async () => {
    const deps = makeDeps([envelope([{ id: 'p1', name: 'Shop', stage: 'INQUIRY' }], { total: 3, page: 1, itemPerPage: 100 })]);
    const page = await createAutoAgentClient(deps).listProjects(1);
    expect(page).toEqual({ items: [{ id: 'p1', name: 'Shop' }], total: 3 });
    const [url, init] = vi.mocked(deps.fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/projects?page=1&itemPerPage=100`);
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('lists only successful jobs of a project', async () => {
    const deps = makeDeps([
      envelope([{ id: 'j1', serviceType: 'MOBILE_DEMO', status: 'SUCCESS', jobName: 'Mobile Demo #j1', completedAt: null, projectName: 'Shop' }], {
        total: 1,
        page: 2,
        itemPerPage: 100,
      }),
    ]);
    const page = await createAutoAgentClient(deps).listJobs('p 1', 2);
    expect(page.items).toEqual([{ id: 'j1', serviceType: 'MOBILE_DEMO', status: 'SUCCESS', jobName: 'Mobile Demo #j1', completedAt: null }]);
    expect(vi.mocked(deps.fetch).mock.calls[0]![0]).toBe(`${BASE}/jobs?projectId=p%201&status=SUCCESS&page=2&itemPerPage=100`);
  });

  it('reads a job with its deployment URL and feedback history', async () => {
    const job = await createAutoAgentClient(makeDeps([envelope(DETAIL)])).getJob('job-1');
    expect(job.deploymentUrl).toBe('https://shop.web.app');
    expect(job.feedbackHistory[0]).toMatchObject({ id: 'run-1', status: 'SUCCESS', createdBy: 'Tung.Le' });
  });

  it('treats a missing deployment URL and history as none', async () => {
    const job = await createAutoAgentClient(
      makeDeps([envelope({ ...DETAIL, deploymentUrl: undefined, feedbackHistory: undefined })]),
    ).getJob('job-1');
    expect(job.deploymentUrl).toBeNull();
    expect(job.feedbackHistory).toEqual([]);
  });

  it('uploads a feedback file as multipart field "files" and returns its id', async () => {
    const deps = makeDeps([envelope([{ id: 'file-1', originalName: 'a.json' }])]);
    const id = await createAutoAgentClient(deps).uploadFeedbackFile(new File(['{}'], 'a.json', { type: 'application/json' }));
    expect(id).toBe('file-1');
    const [url, init] = vi.mocked(deps.fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/files/upload?serviceType=DEMO_FEEDBACK`);
    expect(init!.method).toBe('POST');
    expect((init!.body as FormData).get('files')).toBeInstanceOf(File);
  });

  it('creates a feedback run and reads requiresApproval', async () => {
    const deps = makeDeps([envelope({ id: 'run-2', status: 'PENDING', requiresApproval: true })]);
    const run = await createAutoAgentClient(deps).createFeedbackRun('job-1', { description: 'Fix it', fileIds: ['file-1'] });
    expect(run).toEqual({ id: 'run-2', status: 'PENDING', requiresApproval: true });
    const [url, init] = vi.mocked(deps.fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/jobs/job-1/feedback`);
    expect(JSON.parse(init!.body as string)).toEqual({ description: 'Fix it', fileIds: ['file-1'] });
  });

  it('retries once with a refreshed token after a 401', async () => {
    const deps = makeDeps([envelope(null, null, 401, 'Authentication required'), envelope(DETAIL)]);
    await createAutoAgentClient(deps).getJob('job-1');
    const tokens = vi.mocked(deps.fetch).mock.calls.map(([, init]) => (init!.headers as Record<string, string>).Authorization);
    expect(tokens).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(deps.onUnauthorized).not.toHaveBeenCalled();
  });

  it('signs out after a second 401', async () => {
    const deps = makeDeps([envelope(null, null, 401), envelope(null, null, 401)]);
    await expect(createAutoAgentClient(deps).getJob('job-1')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('asks for sign-in without a request when there is no token', async () => {
    const deps = makeDeps([], { getAccessToken: vi.fn(async () => null) });
    await expect(createAutoAgentClient(deps).listProjects(1)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('shows the server message of an error envelope with its status', async () => {
    const deps = makeDeps([envelope(null, null, 400, 'Feedback updates require a successfully completed job')]);
    await expect(createAutoAgentClient(deps).createFeedbackRun('job-1', { description: 'x', fileIds: [] })).rejects.toMatchObject({
      message: 'Feedback updates require a successfully completed job',
      status: 400,
    });
  });

  it('reports a network failure in plain words', async () => {
    const deps = makeDeps([], {
      fetch: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    await expect(createAutoAgentClient(deps).getJob('job-1')).rejects.toThrow(NETWORK_ERROR);
  });

  it('rejects data that lacks the fields the extension reads', async () => {
    await expect(createAutoAgentClient(makeDeps([envelope([{ name: 'no id' }])])).listProjects(1)).rejects.toThrow(UNEXPECTED_RESPONSE);
    await expect(createAutoAgentClient(makeDeps([envelope({ id: 'job-1' })])).getJob('job-1')).rejects.toThrow(UNEXPECTED_RESPONSE);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run lib/api/auto-agent-client.test.ts`
Expected: FAIL, because `./auto-agent-client` cannot be resolved.

- [ ] **Step 3: Implement the client**

`lib/api/auto-agent-client.ts`:

```ts
import { ApiError, NETWORK_ERROR, UNEXPECTED_RESPONSE, UnauthorizedError, envelopeMessage } from './errors';

export type Project = { id: string; name: string };

export type JobSummary = {
  id: string;
  serviceType: string;
  status: string;
  jobName: string;
  completedAt: string | null;
};

/** One Update Feedback run, as listed in its demo job's `feedbackHistory`. */
export type FeedbackRun = {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  feedbackDescription: string | null;
  feedbackFiles: string[];
  createdBy: string;
};

export type JobDetail = JobSummary & { deploymentUrl: string | null; feedbackHistory: FeedbackRun[] };

export type CreatedRun = { id: string; status: string; requiresApproval: boolean };

export type ListPage<T> = { items: T[]; total: number };

export type AutoAgentClient = {
  listProjects(page: number): Promise<ListPage<Project>>;
  /** Only successful jobs: the only ones that can take feedback. */
  listJobs(projectId: string, page: number): Promise<ListPage<JobSummary>>;
  getJob(id: string): Promise<JobDetail>;
  /** Uploads one feedback file and returns its id. */
  uploadFeedbackFile(file: File): Promise<string>;
  /** Starts an Update Feedback run on a successful demo job. It starts right away. */
  createFeedbackRun(demoJobId: string, body: { description: string; fileIds: string[] }): Promise<CreatedRun>;
};

export type ClientDeps = {
  apiBase: string;
  fetch: typeof fetch;
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  /** Called when the API still answers 401 after a token refresh. */
  onUnauthorized: () => Promise<void>;
};

/** Auto Agent's largest page size. */
export const PAGE_SIZE = 100;

type Envelope = { data: unknown; pagination?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function optionalString(value: unknown): string | null {
  return isString(value) ? value : null;
}

function unexpected(): ApiError {
  return new ApiError(UNEXPECTED_RESPONSE);
}

function project(value: unknown): Project {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name)) throw unexpected();
  return { id: value.id, name: value.name };
}

function jobSummary(value: unknown): JobSummary {
  if (!isRecord(value) || !isString(value.id) || !isString(value.serviceType) || !isString(value.status)) {
    throw unexpected();
  }
  return {
    id: value.id,
    serviceType: value.serviceType,
    status: value.status,
    jobName: isString(value.jobName) ? value.jobName : value.id,
    completedAt: optionalString(value.completedAt),
  };
}

function feedbackRun(value: unknown): FeedbackRun {
  if (!isRecord(value) || !isString(value.id) || !isString(value.status) || !isString(value.createdAt)) {
    throw unexpected();
  }
  return {
    id: value.id,
    status: value.status,
    createdAt: value.createdAt,
    completedAt: optionalString(value.completedAt),
    feedbackDescription: optionalString(value.feedbackDescription),
    feedbackFiles: Array.isArray(value.feedbackFiles) ? value.feedbackFiles.filter(isString) : [],
    createdBy: isString(value.createdBy) ? value.createdBy : '',
  };
}

function jobDetail(value: unknown): JobDetail {
  const summary = jobSummary(value);
  const record = value as Record<string, unknown>;
  return {
    ...summary,
    deploymentUrl: optionalString(record.deploymentUrl),
    feedbackHistory: Array.isArray(record.feedbackHistory) ? record.feedbackHistory.map(feedbackRun) : [],
  };
}

function listPage<T>(body: Envelope, item: (value: unknown) => T): ListPage<T> {
  if (!Array.isArray(body.data)) throw unexpected();
  const items = body.data.map(item);
  const total =
    isRecord(body.pagination) && typeof body.pagination.total === 'number' ? body.pagination.total : items.length;
  return { items, total };
}

/** The only code that knows Auto Agent's URLs and response envelope. */
export function createAutoAgentClient(deps: ClientDeps): AutoAgentClient {
  async function send(path: string, init: RequestInit, token: string): Promise<Response> {
    try {
      return await deps.fetch(`${deps.apiBase}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new ApiError(NETWORK_ERROR);
    }
  }

  async function request(path: string, init: RequestInit = {}): Promise<Envelope> {
    let token = await deps.getAccessToken();
    if (!token) throw new UnauthorizedError();
    let response = await send(path, init, token);
    if (response.status === 401) {
      token = await deps.getAccessToken({ forceRefresh: true });
      if (!token) throw new UnauthorizedError();
      response = await send(path, init, token);
      if (response.status === 401) {
        await deps.onUnauthorized();
        throw new UnauthorizedError();
      }
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(envelopeMessage(body) ?? `Request failed (${response.status})`, response.status);
    }
    if (!isRecord(body) || !('data' in body)) throw unexpected();
    return body as Envelope;
  }

  const query = (params: Record<string, string | number>) =>
    new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();

  return {
    async listProjects(page) {
      return listPage(await request(`/projects?${query({ page, itemPerPage: PAGE_SIZE })}`), project);
    },

    async listJobs(projectId, page) {
      const path = `/jobs?${query({ projectId, status: 'SUCCESS', page, itemPerPage: PAGE_SIZE })}`;
      return listPage(await request(path), jobSummary);
    },

    async getJob(id) {
      return jobDetail((await request(`/jobs/${encodeURIComponent(id)}`)).data);
    },

    async uploadFeedbackFile(file) {
      const form = new FormData();
      form.append('files', file);
      const { data } = await request('/files/upload?serviceType=DEMO_FEEDBACK', { method: 'POST', body: form });
      const first: unknown = Array.isArray(data) ? data[0] : undefined;
      if (!isRecord(first) || !isString(first.id)) throw unexpected();
      return first.id;
    },

    async createFeedbackRun(demoJobId, body) {
      const { data } = await request(`/jobs/${encodeURIComponent(demoJobId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!isRecord(data) || !isString(data.id)) throw unexpected();
      return {
        id: data.id,
        status: isString(data.status) ? data.status : 'PENDING',
        requiresApproval: data.requiresApproval === true,
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run lib/api/auto-agent-client.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/api/auto-agent-client.ts lib/api/auto-agent-client.test.ts
git commit -m "feat: add the Auto Agent API client"
```

---

### Task 3: Match the page to its demo job

**Files:**
- Create: `lib/api/job-matcher.ts`, `lib/api/job-matcher.test.ts`
- Create: `lib/api/job-resolver.ts`, `lib/api/job-resolver.test.ts`

**Interfaces:**
- Consumes: `AutoAgentClient`, `Project`, `JobSummary`, `ListPage` from Task 2.
- Produces:
  - `job-matcher.ts`: `type JobMatch = { projectId: string; projectName: string; jobId: string; jobName: string; serviceType: string; completedAt: string | null }`, `DEMO_TYPES`, `isDemoJob(job)`, `normalizeOrigin(url): string | null`, `newestFirst(a, b)`, `pickMatch(url, candidates: Array<{ match: JobMatch; deploymentUrl: string | null }>): JobMatch | null`
  - `job-resolver.ts`: `resolveJob(client, url): Promise<JobMatch | null>`, `cachedJob(url): Promise<JobMatch | null>`, `chooseJob(url, match): Promise<JobMatch>`, `forgetJob(url): Promise<void>`, `listProjects(client): Promise<Project[]>`, `listDemoJobs(client, project): Promise<JobMatch[]>`, `mapLimit(items, limit, task)`

- [ ] **Step 1: Write the failing matcher tests**

`lib/api/job-matcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type JobMatch, isDemoJob, normalizeOrigin, pickMatch } from './job-matcher';

function match(jobId: string, completedAt: string | null): JobMatch {
  return { projectId: 'p1', projectName: 'Shop', jobId, jobName: jobId, serviceType: 'FRONTEND_DEMO', completedAt };
}

describe('normalizeOrigin', () => {
  it('keeps only scheme, host and port, lower-cased', () => {
    expect(normalizeOrigin('https://Shop.Web.App/home?x=1#/cart')).toBe('https://shop.web.app');
    expect(normalizeOrigin('https://shop.web.app/')).toBe('https://shop.web.app');
    expect(normalizeOrigin('http://localhost:4173/plain.html')).toBe('http://localhost:4173');
  });

  it('treats a Firebase site on firebaseapp.com as the same site on web.app', () => {
    expect(normalizeOrigin('https://shop.firebaseapp.com/home')).toBe('https://shop.web.app');
  });

  it('refuses anything that is not an http(s) URL', () => {
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigin('chrome://extensions')).toBeNull();
  });
});

describe('isDemoJob', () => {
  it('accepts only successful demo jobs', () => {
    expect(isDemoJob({ serviceType: 'FRONTEND_DEMO', status: 'SUCCESS' })).toBe(true);
    expect(isDemoJob({ serviceType: 'MOBILE_DEMO_NEXT_PHASE', status: 'SUCCESS' })).toBe(true);
    expect(isDemoJob({ serviceType: 'FRONTEND_DEMO', status: 'FAILED' })).toBe(false);
    expect(isDemoJob({ serviceType: 'DEMO_FEEDBACK', status: 'SUCCESS' })).toBe(false);
  });
});

describe('pickMatch', () => {
  it('finds the demo deployed at the page origin, whatever the path', () => {
    const candidates = [
      { match: match('a', '2026-09-01T00:00:00Z'), deploymentUrl: 'https://other.web.app' },
      { match: match('b', '2026-09-02T00:00:00Z'), deploymentUrl: 'https://shop.web.app' },
    ];
    expect(pickMatch('https://shop.firebaseapp.com/cart', candidates)?.jobId).toBe('b');
  });

  it('prefers the newest demo when several share a site', () => {
    const candidates = [
      { match: match('old', '2026-09-01T00:00:00Z'), deploymentUrl: 'https://shop.web.app' },
      { match: match('new', '2026-09-03T00:00:00Z'), deploymentUrl: 'https://shop.web.app/' },
      { match: match('none', null), deploymentUrl: 'https://shop.web.app' },
    ];
    expect(pickMatch('https://shop.web.app', candidates)?.jobId).toBe('new');
  });

  it('skips demos without a usable deployment URL', () => {
    const candidates = [
      { match: match('a', null), deploymentUrl: null },
      { match: match('b', null), deploymentUrl: 'garbage' },
    ];
    expect(pickMatch('https://shop.web.app', candidates)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run lib/api/job-matcher.test.ts`
Expected: FAIL, because `./job-matcher` cannot be resolved.

- [ ] **Step 3: Implement the matcher**

`lib/api/job-matcher.ts`:

```ts
import type { JobSummary } from './auto-agent-client';

/** A demo job a page belongs to: where its feedback runs are started. */
export type JobMatch = {
  projectId: string;
  projectName: string;
  jobId: string;
  jobName: string;
  serviceType: string;
  completedAt: string | null;
};

/** The job types Auto Agent accepts feedback on, once they have succeeded. */
export const DEMO_TYPES: ReadonlySet<string> = new Set([
  'FRONTEND_DEMO',
  'FRONTEND_DEMO_NEXT_PHASE',
  'MOBILE_DEMO',
  'MOBILE_DEMO_NEXT_PHASE',
]);

export function isDemoJob(job: Pick<JobSummary, 'serviceType' | 'status'>): boolean {
  return job.status === 'SUCCESS' && DEMO_TYPES.has(job.serviceType);
}

/**
 * The site a URL belongs to. Firebase serves every site on both `.web.app` and
 * `.firebaseapp.com`, so both count as the same site.
 */
export function normalizeOrigin(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/\.firebaseapp\.com$/, '.web.app');
  return `${parsed.protocol}//${host}${parsed.port ? `:${parsed.port}` : ''}`;
}

export function newestFirst(a: JobMatch, b: JobMatch): number {
  return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
}

/** The newest demo deployed at the same site as `url`, or null. */
export function pickMatch(
  url: string,
  candidates: Array<{ match: JobMatch; deploymentUrl: string | null }>,
): JobMatch | null {
  const wanted = normalizeOrigin(url);
  if (!wanted) return null;
  const hits = candidates
    .filter(({ deploymentUrl }) => deploymentUrl !== null && normalizeOrigin(deploymentUrl) === wanted)
    .map(({ match }) => match)
    .sort(newestFirst);
  return hits[0] ?? null;
}
```

- [ ] **Step 4: Run the matcher tests to see them pass**

Run: `pnpm vitest run lib/api/job-matcher.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing resolver tests**

`lib/api/job-resolver.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { AutoAgentClient, JobDetail, JobSummary } from './auto-agent-client';
import { cachedJob, chooseJob, forgetJob, listDemoJobs, mapLimit, resolveJob } from './job-resolver';

const JOBS: Record<string, Array<JobSummary & { deploymentUrl: string | null }>> = {
  p1: [
    { id: 'shop', serviceType: 'FRONTEND_DEMO', status: 'SUCCESS', jobName: 'Shop demo', completedAt: '2026-09-02T00:00:00Z', deploymentUrl: 'https://shop.web.app' },
    { id: 'fb', serviceType: 'DEMO_FEEDBACK', status: 'SUCCESS', jobName: 'Shop feedback', completedAt: '2026-09-03T00:00:00Z', deploymentUrl: 'https://shop.web.app' },
  ],
  p2: [
    { id: 'app', serviceType: 'MOBILE_DEMO', status: 'SUCCESS', jobName: 'App demo', completedAt: '2026-09-01T00:00:00Z', deploymentUrl: 'https://app.web.app' },
    { id: 'nourl', serviceType: 'MOBILE_DEMO', status: 'SUCCESS', jobName: 'No URL', completedAt: null, deploymentUrl: null },
  ],
};

function makeClient(): AutoAgentClient {
  return {
    listProjects: vi.fn(async (page: number) =>
      page === 1
        ? { items: [{ id: 'p1', name: 'Shop' }], total: 2 }
        : { items: [{ id: 'p2', name: 'App' }], total: 2 },
    ),
    listJobs: vi.fn(async (projectId: string) => {
      const items = (JOBS[projectId] ?? []).map(({ deploymentUrl: _url, ...summary }) => summary);
      return { items, total: items.length };
    }),
    getJob: vi.fn(async (id: string): Promise<JobDetail> => {
      const job = Object.values(JOBS).flat().find((candidate) => candidate.id === id)!;
      return { ...job, feedbackHistory: [] };
    }),
    uploadFeedbackFile: vi.fn(),
    createFeedbackRun: vi.fn(),
  };
}

describe('job resolver', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('lists a project’s finished demos, newest first, without feedback runs', async () => {
    const jobs = await listDemoJobs(makeClient(), { id: 'p2', name: 'App' });
    expect(jobs.map((job) => job.jobId)).toEqual(['app', 'nourl']);
    expect(jobs[0]).toMatchObject({ projectId: 'p2', projectName: 'App', jobName: 'App demo', serviceType: 'MOBILE_DEMO' });
  });

  it('scans every page of projects, matches by origin and remembers the answer', async () => {
    const client = makeClient();
    const match = await resolveJob(client, 'https://app.firebaseapp.com/home');
    expect(match).toMatchObject({ jobId: 'app', projectName: 'App' });
    expect(client.listProjects).toHaveBeenCalledTimes(2);
    // Feedback runs share the demo's URL but are never asked for.
    expect(vi.mocked(client.getJob).mock.calls.map(([id]) => id).sort()).toEqual(['app', 'nourl', 'shop']);
    expect(await cachedJob('https://app.web.app/other')).toEqual(match);

    vi.mocked(client.listProjects).mockClear();
    expect(await resolveJob(client, 'https://app.web.app/')).toEqual(match);
    expect(client.listProjects).not.toHaveBeenCalled();
  });

  it('does not fetch the same job twice across scans', async () => {
    const client = makeClient();
    expect(await resolveJob(client, 'https://unknown.web.app')).toBeNull();
    vi.mocked(client.getJob).mockClear();
    expect(await resolveJob(client, 'https://still-unknown.web.app')).toBeNull();
    expect(client.getJob).not.toHaveBeenCalled();
  });

  it('keeps a chosen demo for the origin until it is forgotten', async () => {
    const chosen = { projectId: 'p1', projectName: 'Shop', jobId: 'shop', jobName: 'Shop demo', serviceType: 'FRONTEND_DEMO', completedAt: null };
    await chooseJob('http://127.0.0.1:4173/plain.html', chosen);
    expect(await cachedJob('http://127.0.0.1:4173/')).toEqual(chosen);
    await forgetJob('http://127.0.0.1:4173/x');
    expect(await cachedJob('http://127.0.0.1:4173/')).toBeNull();
  });

  it('runs at most the given number of tasks at once and keeps result order', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return n * 2;
    });
    expect(peak).toBe(4);
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm vitest run lib/api/job-resolver.test.ts`
Expected: FAIL, because `./job-resolver` cannot be resolved.

- [ ] **Step 7: Implement the resolver**

`lib/api/job-resolver.ts`:

```ts
import { storage } from '#imports';
import type { AutoAgentClient, ListPage, Project } from './auto-agent-client';
import { type JobMatch, isDemoJob, newestFirst, normalizeOrigin, pickMatch } from './job-matcher';

/** How many requests a scan sends at once. */
const CONCURRENCY = 4;

/** The demo each reviewed site belongs to, by normalised origin. */
const matchesItem = storage.defineItem<Record<string, JobMatch>>('local:job-matches', { fallback: {} });

/**
 * Deployment URLs already read, by job id. A successful job's URL does not change, so a later
 * scan only asks about jobs it has not seen.
 */
const urlsItem = storage.defineItem<Record<string, string | null>>('local:job-urls', { fallback: {} });

/** Runs `task` over `items` with at most `limit` running at once; results keep the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function allPages<T>(load: (page: number) => Promise<ListPage<T>>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await load(page);
    items.push(...result.items);
    if (result.items.length === 0 || items.length >= result.total) return items;
  }
}

export function listProjects(client: AutoAgentClient): Promise<Project[]> {
  return allPages((page) => client.listProjects(page));
}

/** A project's demos that can take feedback, newest first. */
export async function listDemoJobs(client: AutoAgentClient, project: Project): Promise<JobMatch[]> {
  const jobs = await allPages((page) => client.listJobs(project.id, page));
  return jobs
    .filter(isDemoJob)
    .map((job) => ({
      projectId: project.id,
      projectName: project.name,
      jobId: job.id,
      jobName: job.jobName,
      serviceType: job.serviceType,
      completedAt: job.completedAt,
    }))
    .sort(newestFirst);
}

/** The job list has no deployment URL, so each new job's detail is read once. */
async function deploymentUrls(client: AutoAgentClient, jobs: JobMatch[]): Promise<Record<string, string | null>> {
  const known = await urlsItem.getValue();
  const missing = jobs.filter((job) => !(job.jobId in known));
  if (missing.length === 0) return known;
  const fetched = await mapLimit(missing, CONCURRENCY, async (job) => (await client.getJob(job.jobId)).deploymentUrl);
  const update = Object.fromEntries(missing.map((job, index) => [job.jobId, fetched[index] ?? null]));
  await urlsItem.setValue({ ...(await urlsItem.getValue()), ...update });
  return { ...known, ...update };
}

export async function cachedJob(url: string): Promise<JobMatch | null> {
  const origin = normalizeOrigin(url);
  return origin ? ((await matchesItem.getValue())[origin] ?? null) : null;
}

export async function chooseJob(url: string, match: JobMatch): Promise<JobMatch> {
  const origin = normalizeOrigin(url);
  if (!origin) throw new Error('Only http and https pages can be linked to a demo.');
  await matchesItem.setValue({ ...(await matchesItem.getValue()), [origin]: match });
  return match;
}

export async function forgetJob(url: string): Promise<void> {
  const origin = normalizeOrigin(url);
  if (!origin) return;
  const { [origin]: _forgotten, ...rest } = await matchesItem.getValue();
  await matchesItem.setValue(rest);
}

/**
 * The demo a page belongs to: the remembered one, or else the newest of the reviewer's demos
 * deployed at the page's site. Null when none is, so the reviewer can choose one.
 */
export async function resolveJob(client: AutoAgentClient, url: string): Promise<JobMatch | null> {
  if (!normalizeOrigin(url)) return null;
  const cached = await cachedJob(url);
  if (cached) return cached;

  const projects = await listProjects(client);
  const jobs = (await mapLimit(projects, CONCURRENCY, (project) => listDemoJobs(client, project))).flat();
  const urls = await deploymentUrls(client, jobs);
  const match = pickMatch(url, jobs.map((job) => ({ match: job, deploymentUrl: urls[job.jobId] ?? null })));
  return match ? chooseJob(url, match) : null;
}
```

- [ ] **Step 8: Run the resolver tests to see them pass**

Run: `pnpm vitest run lib/api/job-resolver.test.ts lib/api/job-matcher.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 9: Commit**

```bash
git add lib/api/job-matcher.ts lib/api/job-matcher.test.ts lib/api/job-resolver.ts lib/api/job-resolver.test.ts
git commit -m "feat: find the demo job a reviewed page was deployed from"
```

---

### Task 4: Feedback as Markdown, and the payload file name

**Files:**
- Create: `lib/api/feedback-markdown.ts`, `lib/api/feedback-markdown.test.ts`
- Modify: `lib/api/feedback-payload.ts`
- Create: `lib/api/feedback-payload.test.ts`

**Interfaces:**
- Consumes: `elementName`, `stepLabel` from `lib/flow/step-label.ts`; `FeedbackItem`, `Anchor` from `lib/types.ts`.
- Produces: `feedbackMarkdown(items: FeedbackItem[], fileName: string): string`, `MAX_DESCRIPTION = 10_000`, `feedbackFileName(projectId: string, at: Date): string`.

- [ ] **Step 1: Write the failing tests**

`lib/api/feedback-payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { feedbackFileName } from './feedback-payload';

describe('feedbackFileName', () => {
  it('names the file after the project and the time, safe for any file system', () => {
    expect(feedbackFileName('127.0.0.1:4173', new Date('2026-10-01T04:27:46.111Z'))).toBe(
      'auto-agent-feedback-127.0.0.1-4173-2026-10-01T04-27-46-111Z.json',
    );
  });
});
```

`lib/api/feedback-markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clickStep, makeFlowItem, makeItem, networkStep } from '../test-helpers';
import { MAX_DESCRIPTION, feedbackMarkdown } from './feedback-markdown';

const FILE = 'auto-agent-feedback-shop-1.json';

describe('feedbackMarkdown', () => {
  it('opens with a count and points to the attached file', () => {
    const text = feedbackMarkdown([makeItem()], FILE);
    expect(text.startsWith('# Feedback from the Auto Agent extension\n\n1 item.')).toBe(true);
    expect(text).toContain(`\`${FILE}\``);
  });

  it('describes an element comment with its source line', () => {
    const text = feedbackMarkdown([makeItem({ comment: 'Make this bigger' })], FILE);
    expect(text).toContain('## 1. Comment on h1 "Welcome" on /home');
    expect(text).toContain('Source: `src/pages/Home.tsx:12`');
    expect(text).toContain('Make this bigger');
  });

  it('falls back to the nearest source', () => {
    const item = makeItem();
    item.anchor = { ...item.anchor!, source: undefined, nearestSource: 'src/App.tsx:3' };
    expect(feedbackMarkdown([item], FILE)).toContain('Nearest source: `src/App.tsx:3`');
  });

  it('quotes both sides of a text change', () => {
    const item = makeItem({ kind: 'text-edit', comment: '', textEdit: { before: 'Fresh fruit', after: 'Fruit' } });
    const text = feedbackMarkdown([item], FILE);
    expect(text).toContain('## 1. Text change on /home');
    expect(text).toContain('Replace:\n> Fresh fruit\n\nWith:\n> Fruit');
  });

  it('describes a page comment', () => {
    const item = makeItem({ kind: 'page', anchor: undefined, comment: 'Needs a back button' });
    expect(feedbackMarkdown([item], FILE)).toContain('## 1. Comment on the page /home\n\nNeeds a back button');
  });

  it('lists a workflow’s steps and marks the failing one', () => {
    const item = makeFlowItem();
    item.flow = { ...item.flow!, steps: [clickStep('s1'), networkStep('s2', 500)], failedStepId: 's2' };
    const text = feedbackMarkdown([item], FILE);
    expect(text).toContain('## 1. Workflow: Sign-in fails (starts on /login)');
    expect(text).toContain('**Expected:** I land on the dashboard');
    expect(text).toContain('**Actual:** Nothing happens');
    expect(text).toContain('1. Click button "Sign in" (`src/pages/Login.tsx:48`)');
    expect(text).toMatch(/2\. POST \/api\/login → 500 \*\*← fails here\*\*/);
  });

  it('stops at a whole item and says so when the text would be too long', () => {
    const items = Array.from({ length: 30 }, (_, i) => makeItem({ id: `i${i}`, comment: 'x'.repeat(500) }));
    const text = feedbackMarkdown(items, FILE);
    expect(text.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    expect(text).toContain('## 1.');
    expect(text).not.toContain('## 30.');
    expect(text.endsWith(`_Truncated: the attached file \`${FILE}\` has all 30 items._`)).toBe(true);
  });

  it('cuts a single item that alone is too long', () => {
    const text = feedbackMarkdown([makeItem({ comment: 'y'.repeat(20_000) })], FILE);
    expect(text.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    expect(text).toContain('## 1. Comment on');
    expect(text).toContain('_Truncated:');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run lib/api/feedback-markdown.test.ts lib/api/feedback-payload.test.ts`
Expected: FAIL: `./feedback-markdown` cannot be resolved and `feedbackFileName` is not exported.

- [ ] **Step 3: Add the file name helper**

Append to `lib/api/feedback-payload.ts`:

```ts
/** The name of an exported or uploaded payload: `auto-agent-feedback-<project>-<time>.json`. */
export function feedbackFileName(projectId: string, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  const name = projectId.replace(/[^\w.-]+/g, '-');
  return `auto-agent-feedback-${name}-${stamp}.json`;
}
```

Also change the comment on `FeedbackPayload` to: `/** The JSON file a Send uploads to Auto Agent, and what Export JSON saves. */`

- [ ] **Step 4: Implement the Markdown builder**

`lib/api/feedback-markdown.ts`:

```ts
import { elementName, stepLabel } from '../flow/step-label';
import type { Anchor, FeedbackItem } from '../types';

/** Auto Agent's limit on a feedback run's description. */
export const MAX_DESCRIPTION = 10_000;

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function sourceLines(anchor: Anchor | undefined): string[] {
  if (anchor?.source) return [`Source: \`${anchor.source}\``];
  if (anchor?.nearestSource) return [`Nearest source: \`${anchor.nearestSource}\``];
  return [];
}

function section(item: FeedbackItem, index: number): string {
  const heading = `## ${index + 1}.`;
  const path = item.page.path;
  switch (item.kind) {
    case 'element':
      return [
        `${heading} Comment on ${item.anchor ? elementName(item.anchor) : 'an element'} on ${path}`,
        ...sourceLines(item.anchor),
        '',
        item.comment,
      ].join('\n');
    case 'text-edit':
      return [
        `${heading} Text change on ${path}`,
        ...sourceLines(item.anchor),
        '',
        'Replace:',
        quote(item.textEdit?.before ?? ''),
        '',
        'With:',
        quote(item.textEdit?.after ?? ''),
        ...(item.comment ? ['', item.comment] : []),
      ].join('\n');
    case 'page':
      return [`${heading} Comment on the page ${path}`, '', item.comment].join('\n');
    case 'flow': {
      const lines = [`${heading} Workflow: ${item.comment} (starts on ${path})`];
      const flow = item.flow;
      if (!flow) return lines.join('\n');
      if (flow.expected) lines.push('', `**Expected:** ${flow.expected}`);
      if (flow.actual) lines.push('', `**Actual:** ${flow.actual}`);
      lines.push('', 'Steps:');
      flow.steps.forEach((step, stepIndex) => {
        const { text, source } = stepLabel(step);
        const where = source ? ` (\`${source}\`)` : '';
        const fails = step.id === flow.failedStepId ? ' **← fails here**' : '';
        lines.push(`${stepIndex + 1}. ${text}${where}${fails}`);
      });
      return lines.join('\n');
    }
  }
}

/**
 * The description of a feedback run: a readable summary for Auto Agent's agent. It stops at a
 * whole item when it would pass Auto Agent's limit; the attached JSON file always has everything.
 */
export function feedbackMarkdown(items: FeedbackItem[], fileName: string): string {
  const count = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
  const header = `# Feedback from the Auto Agent extension\n\n${count}. Selectors, HTML and viewport details are in the attached file \`${fileName}\`.`;
  const note = `\n\n_Truncated: the attached file \`${fileName}\` has all ${count}._`;

  let text = header;
  let included = 0;
  for (const [index, item] of items.entries()) {
    const next = `${text}\n\n${section(item, index)}`;
    // Room for the note is kept unless this is the last item, which needs no note.
    const reserve = index === items.length - 1 ? 0 : note.length;
    if (next.length + reserve > MAX_DESCRIPTION) break;
    text = next;
    included += 1;
  }
  if (included === items.length) return text;
  if (included === 0) {
    const room = MAX_DESCRIPTION - text.length - note.length - 3;
    text = `${text}\n\n${section(items[0]!, 0).slice(0, Math.max(0, room))}…`;
  }
  return text + note;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run lib/api/feedback-markdown.test.ts lib/api/feedback-payload.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/api/feedback-markdown.ts lib/api/feedback-markdown.test.ts lib/api/feedback-payload.ts lib/api/feedback-payload.test.ts
git commit -m "feat: describe drafts as Markdown for a feedback run"
```

---

### Task 5: Background — sign-in, demo job, Send and run status

After this task `pnpm test` passes, but `pnpm compile` fails in `entrypoints/panel/*` and `entrypoints/options/*` until Task 6, because `AuthState` changes shape. That is expected; do not patch the panel here.

**Files:**
- Modify: `lib/types.ts` (add `SentRun`, `run?` on `SentFeedback`)
- Modify: `lib/messages.ts`
- Rewrite: `lib/background-handlers.ts`
- Rewrite: `lib/background-handlers.test.ts`
- Rewrite: `entrypoints/background.ts`
- Modify: `wxt.config.ts`

**Interfaces:**
- Consumes: Task 1 (`signIn`, `signOut`, `getSession`, `getAccessToken`, `SessionDeps`, `Session`, `User`), Task 2 (`createAutoAgentClient`, `AutoAgentClient`, `Project`, `FeedbackRun`), Task 3 (`JobMatch`, `resolveJob`, `cachedJob`, `chooseJob`, `forgetJob`, `listProjects`, `listDemoJobs`), Task 4 (`feedbackMarkdown`, `feedbackFileName`).
- Produces:
  ```ts
  // lib/types.ts
  type SentRun = { jobId: string; demoJobId: string; sentAt: string; requiresApproval: boolean };
  type SentFeedback = FeedbackItem & { author: { id: string; name: string }; status: 'open' | 'resolved'; run?: SentRun };
  // lib/messages.ts
  type AuthState = { signedIn: boolean; user: User | null };
  type BackgroundRequest =
    | { type: 'submit'; projectId: string; url: string; ids: string[] }
    | { type: 'sign-in' } | { type: 'sign-out' } | { type: 'auth-state' }
    | { type: 'resolve-job'; url: string }
    | { type: 'choose-job'; url: string; match: JobMatch }
    | { type: 'list-projects' }
    | { type: 'list-demo-jobs'; project: Project }
    | { type: 'job-runs'; url: string }
    | /* flow-* unchanged */;
  type ErrorCode = 'unauthorized' | 'forbidden' | 'not-configured' | 'failed';
  function isPing(message: unknown): message is { type: 'ping' };
  ```

- [ ] **Step 1: Add the run to sent feedback**

In `lib/types.ts`, replace the `SentFeedback` type with:

```ts
/** The Auto Agent feedback run an item went out in. */
export type SentRun = {
  /** The run's own job id. */
  jobId: string;
  /** The demo job the run updates. */
  demoJobId: string;
  sentAt: string;
  requiresApproval: boolean;
};

export type SentFeedback = FeedbackItem & {
  author: { id: string; name: string };
  status: 'open' | 'resolved';
  /** Absent on items sent before the extension was connected to Auto Agent. */
  run?: SentRun;
};
```

- [ ] **Step 2: Update the messages**

In `lib/messages.ts`:

1. Add imports at the top:
   ```ts
   import type { FeedbackRun, Project } from './api/auto-agent-client';
   import type { JobMatch } from './api/job-matcher';
   import type { User } from './auth/session';
   ```
2. Replace `AuthState`, `BackgroundRequest`, `BackgroundResponse`, `ErrorCode` and `REQUEST_TYPES` with:

```ts
export type AuthState = { signedIn: boolean; user: User | null };

export type BackgroundRequest =
  /** `projectId` is the drafts' storage key; `url` is the page, which picks the demo job. */
  | { type: 'submit'; projectId: string; url: string; ids: string[] }
  | { type: 'sign-in' }
  | { type: 'sign-out' }
  | { type: 'auth-state' }
  | { type: 'resolve-job'; url: string }
  | { type: 'choose-job'; url: string; match: JobMatch }
  | { type: 'list-projects' }
  | { type: 'list-demo-jobs'; project: Project }
  /** The feedback runs on the demo job the page belongs to. */
  | { type: 'job-runs'; url: string }
  | { type: 'flow-pause'; tabId: number }
  | { type: 'flow-resume'; tabId: number }
  | { type: 'flow-stop'; tabId: number }
  | { type: 'flow-discard'; tabId: number }
  | { type: 'flow-note'; tabId: number; text: string; path: string }
  | { type: 'flow-save'; tabId: number; edits: FlowEdits };

export type FlowRequest = Extract<BackgroundRequest, { type: `flow-${string}` }>;

export type BackgroundResponse = {
  submit: SentFeedback[];
  'sign-in': AuthState;
  'sign-out': AuthState;
  'auth-state': AuthState;
  'resolve-job': JobMatch | null;
  'choose-job': JobMatch;
  'list-projects': Project[];
  'list-demo-jobs': JobMatch[];
  'job-runs': FeedbackRun[];
  'flow-pause': null;
  'flow-resume': null;
  'flow-stop': null;
  'flow-discard': null;
  'flow-note': null;
  'flow-save': FeedbackItem;
};

/**
 * `unauthorized`: sign in again. `forbidden`: the page's demo is no longer reachable and has been
 * forgotten. `not-configured`: no demo has been chosen for the page yet.
 */
export type ErrorCode = 'unauthorized' | 'forbidden' | 'not-configured' | 'failed';

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; error: string };

const REQUEST_TYPES: ReadonlyArray<BackgroundRequest['type']> = [
  'submit',
  'sign-in',
  'sign-out',
  'auth-state',
  'resolve-job',
  'choose-job',
  'list-projects',
  'list-demo-jobs',
  'job-runs',
  'flow-pause',
  'flow-resume',
  'flow-stop',
  'flow-discard',
  'flow-note',
  'flow-save',
];
```

3. Append:

```ts
/** Sent by Auto Agent's download page to learn which version is installed. */
export type Ping = { type: 'ping' };
export type PingReply = { installed: true; version: string };

export function isPing(message: unknown): message is Ping {
  return (message as Ping | null)?.type === 'ping';
}
```

The existing `Result` declaration is replaced by the one above; keep only one.

- [ ] **Step 3: Write the failing handler tests**

Replace `lib/background-handlers.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { AutoAgentClient } from './api/auto-agent-client';
import { ApiError, UnauthorizedError } from './api/errors';
import type { JobMatch } from './api/job-matcher';
import { cachedJob, chooseJob } from './api/job-resolver';
import { type HandlerDeps, handleRequest } from './background-handlers';
import { addDraft, listDrafts } from './draft-store';
import { listFeedback } from './feedback-store';
import { createFlowHandlers } from './flow/flow-handlers';
import { isBackgroundRequest, isPing } from './messages';
import { makeFlowItem, makeItem, makeSession } from './test-helpers';

const PAGE = 'https://shop.web.app/home';
const MATCH: JobMatch = {
  projectId: 'p1',
  projectName: 'Shop',
  jobId: 'job-1',
  jobName: 'Frontend Demo #job-1',
  serviceType: 'FRONTEND_DEMO',
  completedAt: '2026-09-30T00:00:00.000Z',
};

function makeClient(overrides: Partial<AutoAgentClient> = {}): AutoAgentClient {
  return {
    listProjects: vi.fn(async () => ({ items: [], total: 0 })),
    listJobs: vi.fn(async () => ({ items: [], total: 0 })),
    getJob: vi.fn(async (id: string) => ({
      id,
      serviceType: 'FRONTEND_DEMO',
      status: 'SUCCESS',
      jobName: 'Demo',
      completedAt: null,
      deploymentUrl: 'https://shop.web.app',
      feedbackHistory: [
        { id: 'run-0', status: 'SUCCESS', createdAt: '2026-09-30T00:00:00Z', completedAt: null, feedbackDescription: null, feedbackFiles: [], createdBy: 'bob' },
      ],
    })),
    uploadFeedbackFile: vi.fn(async () => 'file-1'),
    createFeedbackRun: vi.fn(async () => ({ id: 'run-1', status: 'PENDING', requiresApproval: false })),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    client: makeClient(),
    signIn: vi.fn(async () => makeSession()),
    signOut: vi.fn(async () => undefined),
    getSession: vi.fn(async () => makeSession()),
    clientInfo: () => ({ extensionVersion: '0.1.0', userAgent: 'test' }),
    now: () => new Date('2026-10-01T04:27:46.111Z'),
    flow: createFlowHandlers({
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      newId: () => crypto.randomUUID(),
      notify: () => undefined,
    }),
    ...overrides,
  };
}

describe('handleRequest', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('wraps flow request failures in a Result', async () => {
    const result = await handleRequest(
      { type: 'flow-save', tabId: 3, edits: { title: 't', expected: '', actual: '', steps: [] } },
      makeDeps(),
    );
    expect(result).toEqual({ ok: false, code: 'failed', error: 'This recording no longer exists.' });
    expect(isBackgroundRequest({ type: 'flow-note', tabId: 1, text: 'x', path: '/' })).toBe(true);
    expect(isBackgroundRequest({ type: 'resolve-job', url: PAGE })).toBe(true);
  });

  it('recognises the download page’s ping and nothing else', () => {
    expect(isPing({ type: 'ping' })).toBe(true);
    expect(isPing({ type: 'sign-in' })).toBe(false);
    expect(isPing(null)).toBe(false);
  });

  it('reports who is signed in', async () => {
    expect(await handleRequest({ type: 'auth-state' }, makeDeps())).toEqual({
      ok: true,
      value: { signedIn: true, user: makeSession().user },
    });
    const signedOut = makeDeps({ getSession: vi.fn(async () => null) });
    expect(await handleRequest({ type: 'auth-state' }, signedOut)).toEqual({ ok: true, value: { signedIn: false, user: null } });
  });

  it('passes a sign-in error through as its message', async () => {
    const deps = makeDeps({
      signIn: vi.fn(async () => {
        throw new Error('Sign-in was cancelled.');
      }),
    });
    expect(await handleRequest({ type: 'sign-in' }, deps)).toEqual({ ok: false, code: 'failed', error: 'Sign-in was cancelled.' });
  });

  it('refuses to send before a demo is chosen for the page', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    const deps = makeDeps();
    const result = await handleRequest({ type: 'submit', projectId: 'p1', url: PAGE, ids: ['a'] }, deps);
    expect(result).toMatchObject({ ok: false, code: 'not-configured' });
    expect(deps.client.uploadFeedbackFile).not.toHaveBeenCalled();
    expect(await listDrafts('p1')).toHaveLength(1);
  });

  it('uploads the chosen drafts as JSON, starts a run with a Markdown description, and keeps the rest', async () => {
    await chooseJob(PAGE, MATCH);
    await addDraft('p1', makeItem({ id: 'a', comment: 'First' }));
    await addDraft('p1', makeItem({ id: 'b' }));
    await addDraft('p1', makeFlowItem({ id: 'c' }));
    const deps = makeDeps();

    const result = await handleRequest({ type: 'submit', projectId: 'p1', url: PAGE, ids: ['a', 'c', 'gone'] }, deps);

    expect(result).toMatchObject({ ok: true, value: [{ id: 'a' }, { id: 'c' }] });
    const upload = vi.mocked(deps.client.uploadFeedbackFile);
    const create = vi.mocked(deps.client.createFeedbackRun);
    const file = upload.mock.calls[0]![0];
    expect(file.name).toBe('auto-agent-feedback-p1-2026-10-01T04-27-46-111Z.json');
    expect(file.type).toBe('application/json');
    expect(JSON.parse(await file.text()).items.map((item: { id: string }) => item.id)).toEqual(['a', 'c']);
    expect(create).toHaveBeenCalledWith('job-1', {
      description: expect.stringContaining('# Feedback from the Auto Agent extension'),
      fileIds: ['file-1'],
    });
    expect(create.mock.calls[0]![1].description).toContain('First');
    expect(upload.mock.invocationCallOrder[0]!).toBeLessThan(create.mock.invocationCallOrder[0]!);

    expect((await listDrafts('p1')).map((draft) => draft.id)).toEqual(['b']);
    const sent = await listFeedback('p1');
    expect(sent.map((item) => item.id)).toEqual(['a', 'c']);
    expect(sent[0]).toMatchObject({
      status: 'open',
      author: { id: 'u1', name: 'Ada Lovelace' },
      run: { jobId: 'run-1', demoJobId: 'job-1', sentAt: '2026-10-01T04:27:46.111Z', requiresApproval: false },
    });
  });

  it('keeps every draft when the run cannot be created', async () => {
    await chooseJob(PAGE, MATCH);
    await addDraft('p1', makeItem({ id: 'a' }));
    const client = makeClient({
      createFeedbackRun: vi.fn(async () => {
        throw new ApiError('Feedback updates require a successfully completed job', 400);
      }),
    });
    const result = await handleRequest({ type: 'submit', projectId: 'p1', url: PAGE, ids: ['a'] }, makeDeps({ client }));
    expect(result).toEqual({ ok: false, code: 'failed', error: 'Feedback updates require a successfully completed job' });
    expect(await listDrafts('p1')).toHaveLength(1);
    expect(await listFeedback('p1')).toEqual([]);
  });

  it('forgets the demo when access to it is lost, so the page can be matched again', async () => {
    await chooseJob(PAGE, MATCH);
    await addDraft('p1', makeItem({ id: 'a' }));
    const client = makeClient({
      createFeedbackRun: vi.fn(async () => {
        throw new ApiError('Forbidden', 403);
      }),
    });
    const result = await handleRequest({ type: 'submit', projectId: 'p1', url: PAGE, ids: ['a'] }, makeDeps({ client }));
    expect(result).toEqual({ ok: false, code: 'forbidden', error: 'You no longer have access to this demo.' });
    expect(await cachedJob(PAGE)).toBeNull();
    expect(await listDrafts('p1')).toHaveLength(1);
  });

  it('reports an ended session as unauthorized', async () => {
    await chooseJob(PAGE, MATCH);
    await addDraft('p1', makeItem({ id: 'a' }));
    const client = makeClient({
      uploadFeedbackFile: vi.fn(async () => {
        throw new UnauthorizedError();
      }),
    });
    const result = await handleRequest({ type: 'submit', projectId: 'p1', url: PAGE, ids: ['a'] }, makeDeps({ client }));
    expect(result).toEqual({ ok: false, code: 'unauthorized', error: 'Your session ended. Sign in again.' });
  });

  it('sends nothing when no chosen draft is left', async () => {
    await chooseJob(PAGE, MATCH);
    await addDraft('p1', makeItem({ id: 'a' }));
    const deps = makeDeps();
    expect(await handleRequest({ type: 'submit', projectId: 'p1', url: PAGE, ids: [] }, deps)).toEqual({ ok: true, value: [] });
    expect(deps.client.uploadFeedbackFile).not.toHaveBeenCalled();
  });

  it('reads the runs of the page’s demo, and none before a demo is chosen', async () => {
    const deps = makeDeps();
    expect(await handleRequest({ type: 'job-runs', url: PAGE }, deps)).toEqual({ ok: true, value: [] });
    await chooseJob(PAGE, MATCH);
    const result = await handleRequest({ type: 'job-runs', url: PAGE }, deps);
    expect(result).toMatchObject({ ok: true, value: [{ id: 'run-0', createdBy: 'bob' }] });
    expect(deps.client.getJob).toHaveBeenCalledWith('job-1');
  });

  it('forgets the demo when its runs can no longer be read', async () => {
    await chooseJob(PAGE, MATCH);
    const client = makeClient({
      getJob: vi.fn(async () => {
        throw new ApiError('Job not found', 404);
      }),
    });
    const result = await handleRequest({ type: 'job-runs', url: PAGE }, makeDeps({ client }));
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await cachedJob(PAGE)).toBeNull();
  });

  it('remembers a demo the reviewer chose', async () => {
    expect(await handleRequest({ type: 'choose-job', url: PAGE, match: MATCH }, makeDeps())).toEqual({ ok: true, value: MATCH });
    expect(await handleRequest({ type: 'resolve-job', url: 'https://shop.web.app/other' }, makeDeps())).toEqual({
      ok: true,
      value: MATCH,
    });
  });
});
```

- [ ] **Step 4: Run them to see them fail**

Run: `pnpm vitest run lib/background-handlers.test.ts`
Expected: FAIL, because `HandlerDeps` has no `client` yet and `submit` still uses `createApi`.

- [ ] **Step 5: Rewrite the handlers**

Replace `lib/background-handlers.ts` with:

```ts
import type { AutoAgentClient } from './api/auto-agent-client';
import { ApiError, UnauthorizedError } from './api/errors';
import { feedbackMarkdown } from './api/feedback-markdown';
import { feedbackFileName, feedbackPayload } from './api/feedback-payload';
import { cachedJob, chooseJob, forgetJob, listDemoJobs, listProjects, resolveJob } from './api/job-resolver';
import type { Session } from './auth/session';
import { listDrafts, removeDrafts } from './draft-store';
import { saveFeedback } from './feedback-store';
import type { FlowHandlers } from './flow/flow-handlers';
import { isSendable } from './flow/flow-item';
import type { AuthState, BackgroundRequest, Result } from './messages';
import type { ClientInfo, SentFeedback } from './types';

export type HandlerDeps = {
  client: AutoAgentClient;
  signIn: () => Promise<Session>;
  signOut: () => Promise<void>;
  getSession: () => Promise<Session | null>;
  clientInfo: () => ClientInfo;
  now: () => Date;
  flow: FlowHandlers;
};

class NotConfiguredError extends Error {
  constructor() {
    super('Choose the demo this page belongs to before sending.');
  }
}

class ForbiddenError extends Error {
  constructor() {
    super('You no longer have access to this demo.');
  }
}

/**
 * Runs a call against the page's demo job. A 403 or 404 means the reviewer lost access or the
 * job is gone, so the match is forgotten and the page can be matched or chosen again.
 */
async function onDemoJob<T>(url: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      await forgetJob(url);
      throw new ForbiddenError();
    }
    throw error;
  }
}

async function authState(deps: HandlerDeps): Promise<AuthState> {
  const session = await deps.getSession();
  return { signedIn: session !== null, user: session?.user ?? null };
}

async function submit(
  request: Extract<BackgroundRequest, { type: 'submit' }>,
  deps: HandlerDeps,
): Promise<SentFeedback[]> {
  const match = await cachedJob(request.url);
  if (!match) throw new NotConfiguredError();
  // Only the drafts the reviewer chose; an id that no longer has a draft is skipped.
  const chosen = new Set(request.ids);
  const drafts = (await listDrafts(request.projectId)).filter(
    (draft) => chosen.has(draft.id) && isSendable(draft),
  );
  if (drafts.length === 0) return [];
  const session = await deps.getSession();
  if (!session) throw new UnauthorizedError();

  const sentAt = deps.now();
  const fileName = feedbackFileName(request.projectId, sentAt);
  const file = new File([JSON.stringify(feedbackPayload(drafts, deps.clientInfo()), null, 2)], fileName, {
    type: 'application/json',
  });
  const run = await onDemoJob(request.url, async () => {
    const fileId = await deps.client.uploadFeedbackFile(file);
    return deps.client.createFeedbackRun(match.jobId, {
      description: feedbackMarkdown(drafts, fileName),
      fileIds: [fileId],
    });
  });

  const sent = drafts.map(
    (draft): SentFeedback => ({
      ...draft,
      author: { id: session.user.id, name: session.user.displayName },
      status: 'open',
      run: {
        jobId: run.id,
        demoJobId: match.jobId,
        sentAt: sentAt.toISOString(),
        requiresApproval: run.requiresApproval,
      },
    }),
  );
  // Auto Agent keeps the run, not the items, so the items are kept here to draw their pins.
  await saveFeedback(request.projectId, sent);
  // Remove only what was sent: a draft added while the request was in flight must survive.
  await removeDrafts(
    request.projectId,
    drafts.map((draft) => draft.id),
  );
  return sent;
}

async function dispatch(request: BackgroundRequest, deps: HandlerDeps): Promise<unknown> {
  switch (request.type) {
    case 'auth-state':
      return authState(deps);

    case 'sign-in':
      await deps.signIn();
      return authState(deps);

    case 'sign-out':
      await deps.signOut();
      return authState(deps);

    case 'resolve-job':
      return resolveJob(deps.client, request.url);

    case 'choose-job':
      return chooseJob(request.url, request.match);

    case 'list-projects':
      return listProjects(deps.client);

    case 'list-demo-jobs':
      return listDemoJobs(deps.client, request.project);

    case 'job-runs': {
      const match = await cachedJob(request.url);
      if (!match) return [];
      return onDemoJob(request.url, async () => (await deps.client.getJob(match.jobId)).feedbackHistory);
    }

    case 'flow-pause':
    case 'flow-resume':
    case 'flow-stop':
    case 'flow-discard':
    case 'flow-note':
    case 'flow-save':
      return deps.flow.request(request);

    case 'submit':
      return submit(request, deps);
  }
}

export async function handleRequest(
  request: BackgroundRequest,
  deps: HandlerDeps,
): Promise<Result<unknown>> {
  try {
    return { ok: true, value: await dispatch(request, deps) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong';
    if (error instanceof UnauthorizedError) return { ok: false, code: 'unauthorized', error: message };
    if (error instanceof ForbiddenError) return { ok: false, code: 'forbidden', error: message };
    if (error instanceof NotConfiguredError) return { ok: false, code: 'not-configured', error: message };
    return { ok: false, code: 'failed', error: message };
  }
}
```

- [ ] **Step 6: Run the handler tests to see them pass**

Run: `pnpm vitest run lib/background-handlers.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 7: Wire the background worker**

Replace `entrypoints/background.ts` with the version below. The panel-toggle and flow wiring is unchanged; only the imports, the dependencies and the external ping are new.

```ts
import { browser, defineBackground, storage } from '#imports';
import { createAutoAgentClient } from '@/lib/api/auto-agent-client';
import { type SessionDeps, getAccessToken, getSession, signIn, signOut } from '@/lib/auth/session';
import { type HandlerDeps, handleRequest } from '@/lib/background-handlers';
import { clientInfo } from '@/lib/client-info';
import { API_BASE } from '@/lib/config';
import { createFlowHandlers } from '@/lib/flow/flow-handlers';
import {
  type FlowStatus,
  type PingReply,
  type SetPanel,
  isBackgroundRequest,
  isFlowContentMessage,
  isPanelState,
  isPing,
} from '@/lib/messages';

export default defineBackground(() => {
  // The review panel floats over the page instead of docking beside it, so the page keeps its
  // full width. The toolbar icon opens and closes it; which tabs have it open is kept here so
  // it comes back after a reload or a navigation.
  const openPanels = storage.defineItem<number[]>('session:open-panels', { fallback: [] });

  // Serialised so a click and a message arriving together cannot overwrite each other.
  let panelQueue: Promise<unknown> = Promise.resolve();
  const setPanelOpen = (tabId: number, open: boolean): Promise<void> => {
    const run = panelQueue.then(async () => {
      const tabs = (await openPanels.getValue()).filter((id) => id !== tabId);
      await openPanels.setValue(open ? [...tabs, tabId] : tabs);
    });
    panelQueue = run.catch(() => undefined);
    return run;
  };

  const flow = createFlowHandlers({
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    notify: (tabId, state) => {
      const message: FlowStatus = { type: 'flow-status', state };
      // The tab may be between documents; its next content script asks for the state itself.
      browser.tabs.sendMessage(tabId, message).catch(() => undefined);
    },
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void setPanelOpen(tabId, false);
    void flow.tabRemoved(tabId);
  });
  browser.tabs.onCreated.addListener((tab) => void flow.tabCreated(tab));
  // Host permissions reveal http and https URLs, which is all a new tab's step needs.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) void flow.tabUpdated(tabId, changeInfo.url);
  });

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id === undefined) return;
    const open = !(await openPanels.getValue()).includes(tab.id);
    await setPanelOpen(tab.id, open);
    const message: SetPanel = { type: 'set-panel', open };
    try {
      await browser.tabs.sendMessage(tab.id, message);
      return;
    } catch {
      // No content script yet: the tab was open before the extension was installed or reloaded.
    }
    try {
      // The injected script reads the open state itself when it starts.
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['/content-scripts/content.js'],
      });
    } catch {
      // Pages such as chrome:// and the Web Store do not allow extensions to run.
      await setPanelOpen(tab.id, false);
      await browser.action.setBadgeText({ tabId: tab.id, text: '!' });
      await browser.action.setTitle({ tabId: tab.id, title: 'Auto Agent cannot run on this page' });
    }
  });

  // Sign-in runs here, not in the panel: the Microsoft window takes focus, which would close a
  // popup and lose the pending result.
  const sessionDeps: SessionDeps = {
    apiBase: API_BASE,
    redirectUri: browser.identity.getRedirectURL('auth'),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    newState: () => crypto.randomUUID(),
    launchWebAuthFlow: ({ url, interactive }) =>
      browser.identity.launchWebAuthFlow({
        url,
        interactive,
        // The silent attempt lets Microsoft redirect on its own when the browser is already
        // signed in to the company account.
        abortOnLoadForNonInteractive: false,
        timeoutMsForNonInteractive: 15_000,
      }),
  };

  const deps: HandlerDeps = {
    client: createAutoAgentClient({
      apiBase: API_BASE,
      fetch: (input, init) => fetch(input, init),
      getAccessToken: (options) => getAccessToken(sessionDeps, options),
      onUnauthorized: signOut,
    }),
    signIn: () => signIn(sessionDeps),
    signOut,
    getSession,
    clientInfo,
    now: () => new Date(),
    flow,
  };

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isPanelState(message)) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      const update = message.open === undefined ? Promise.resolve() : setPanelOpen(tabId, message.open);
      update
        .then(() => openPanels.getValue())
        .then((tabs) => sendResponse(tabs.includes(tabId)));
      return true;
    }
    if (isFlowContentMessage(message)) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      flow.content(message, tabId).then(sendResponse);
      return true;
    }
    if (!isBackgroundRequest(message)) return;
    handleRequest(message, deps).then(sendResponse);
    return true;
  });

  // Auto Agent's download page asks which version is installed, to offer an update.
  browser.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
    if (!isPing(message)) return;
    const reply: PingReply = { installed: true, version: browser.runtime.getManifest().version };
    sendResponse(reply);
  });
});
```

If `pnpm compile` reports that `abortOnLoadForNonInteractive` or `timeoutMsForNonInteractive` are not in the type of `launchWebAuthFlow`'s details, cast that object: `{ ... } as Parameters<typeof browser.identity.launchWebAuthFlow>[0]`. Chrome supports both options since version 113.

- [ ] **Step 8: Let the download page reach the extension**

In `wxt.config.ts`, add to `manifest` after `action`:

```ts
    // Auto Agent's download page asks the installed extension for its version.
    externally_connectable: {
      matches: ['https://vibe.saigontechnology.vn/*', 'http://localhost:5173/*'],
    },
```

- [ ] **Step 9: Run the unit tests**

Run: `pnpm test`
Expected: PASS for every file under `lib/`. The old `lib/auth/oauth.test.ts`, `lib/api/http-feedback-api.test.ts`, `lib/api/mock-feedback-api.test.ts` and `lib/settings-store.test.ts` still pass; they are removed in Task 6.

- [ ] **Step 10: Commit**

```bash
git add lib/types.ts lib/messages.ts lib/background-handlers.ts lib/background-handlers.test.ts entrypoints/background.ts wxt.config.ts
git commit -m "feat: send drafts as Auto Agent feedback runs from the background"
```

---

### Task 6: Panel and Options; remove the old API code

**Files:**
- Create: `lib/run-status.ts`, `lib/run-status.test.ts`
- Create: `lib/sent-groups.ts`, `lib/sent-groups.test.ts`
- Modify: `entrypoints/panel/hooks.ts`
- Create: `entrypoints/panel/SignIn.tsx`, `entrypoints/panel/JobPicker.tsx`, `entrypoints/panel/RunGroup.tsx`
- Modify: `entrypoints/panel/App.tsx`, `entrypoints/panel/style.css`
- Rewrite: `entrypoints/options/App.tsx`, `e2e/options.spec.ts`
- Modify: `lib/config.ts` (remove `LOCAL_ONLY`), `lib/types.ts` (remove `Settings`, `OAuthSettings`)
- Delete: `lib/auth/oauth.ts`, `lib/auth/oauth.test.ts`, `lib/auth/pkce.ts`, `lib/auth/pkce.test.ts`, `lib/api/feedback-api.ts`, `lib/api/http-feedback-api.ts`, `lib/api/http-feedback-api.test.ts`, `lib/api/mock-feedback-api.ts`, `lib/api/mock-feedback-api.test.ts`, `lib/settings-store.ts`, `lib/settings-store.test.ts`

**Interfaces:**
- Consumes: everything in `lib/messages.ts` from Task 5; `watchSession`, `getSession`, `Session` (Task 1); `WEB_BASE` (Task 1); `JobMatch` (Task 3); `Project`, `FeedbackRun` (Task 2); `feedbackFileName` (Task 4).
- Produces:
  - `lib/run-status.ts`: `isFinished(status: string): boolean`, `runStatus(status: string | undefined, requiresApproval: boolean): { label: string; tone: 'pending' | 'running' | 'done' | 'failed' }`
  - `lib/sent-groups.ts`: `type SentGroup`, `groupSent(sent, runs): SentGroup[]`, `hasUnfinishedRuns(sent, runs, demoJobId): boolean`
  - Panel UI names the e2e tests in Task 7 rely on: button **Sign in with Microsoft**, button **Sign out**, form **Choose demo** with selects labelled **Project** and **Demo** and button **Use this demo**, demo line text `<projectName> · <jobName>` with button **Change**, region **Sent**, link **Open in Auto Agent**, status chip texts **Queued**, **Running**, **Waiting for approval**, **Done**, **Failed**, **Cancelled**.

- [ ] **Step 1: Write the failing tests for status and grouping**

`lib/run-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isFinished, runStatus } from './run-status';

describe('run status', () => {
  it('knows which statuses are final', () => {
    expect(['SUCCESS', 'FAILED', 'CANCELLED'].every(isFinished)).toBe(true);
    expect(isFinished('RUNNING')).toBe(false);
  });

  it('labels each status for the chip', () => {
    expect(runStatus('SUCCESS', false)).toEqual({ label: 'Done', tone: 'done' });
    expect(runStatus('FAILED', false)).toEqual({ label: 'Failed', tone: 'failed' });
    expect(runStatus('CANCELLED', false)).toEqual({ label: 'Cancelled', tone: 'failed' });
    expect(runStatus('RUNNING', true)).toEqual({ label: 'Running', tone: 'running' });
    expect(runStatus('PENDING', false)).toEqual({ label: 'Queued', tone: 'pending' });
    expect(runStatus(undefined, false)).toEqual({ label: 'Queued', tone: 'pending' });
  });

  it('shows approval only while the run has not started', () => {
    expect(runStatus(undefined, true)).toEqual({ label: 'Waiting for approval', tone: 'pending' });
    expect(runStatus('PENDING', true)).toEqual({ label: 'Waiting for approval', tone: 'pending' });
  });

  it('shows an unknown status in words', () => {
    expect(runStatus('AWAITING_REVIEW', false)).toEqual({ label: 'Awaiting review', tone: 'running' });
  });
});
```

`lib/sent-groups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FeedbackRun } from './api/auto-agent-client';
import { groupSent, hasUnfinishedRuns } from './sent-groups';
import { makeSent } from './test-helpers';

function run(id: string, status: string, createdAt: string, createdBy = 'bob'): FeedbackRun {
  return { id, status, createdAt, completedAt: null, feedbackDescription: null, feedbackFiles: [], createdBy };
}

const mine = (id: string, runId: string, sentAt: string) =>
  makeSent({ id, run: { jobId: runId, demoJobId: 'job-1', sentAt, requiresApproval: false } });

describe('groupSent', () => {
  it('groups items by run, newest first, with the status from Auto Agent', () => {
    const groups = groupSent(
      [mine('a', 'run-1', '2026-10-01T01:00:00Z'), mine('b', 'run-1', '2026-10-01T01:00:00Z'), mine('c', 'run-2', '2026-10-01T02:00:00Z')],
      [run('run-1', 'SUCCESS', '2026-10-01T01:00:01Z'), run('run-2', 'RUNNING', '2026-10-01T02:00:01Z')],
    );
    expect(groups.map((group) => [group.runId, group.status, group.items.map((item) => item.id)])).toEqual([
      ['run-2', 'RUNNING', ['c']],
      ['run-1', 'SUCCESS', ['a', 'b']],
    ]);
    expect(groups[0]!.createdBy).toBeNull();
  });

  it('adds runs sent by others, or from elsewhere, as groups without items', () => {
    const groups = groupSent([], [run('run-9', 'RUNNING', '2026-10-01T03:00:00Z', 'carol')]);
    expect(groups).toEqual([
      { key: 'run-9', runId: 'run-9', sentAt: '2026-10-01T03:00:00Z', status: 'RUNNING', requiresApproval: false, createdBy: 'carol', items: [] },
    ]);
  });

  it('keeps items sent before Auto Agent was connected in a last group', () => {
    const groups = groupSent([makeSent({ id: 'old' }), mine('a', 'run-1', '2026-10-01T01:00:00Z')], []);
    expect(groups.map((group) => group.key)).toEqual(['run-1', 'earlier']);
    expect(groups[1]!.items.map((item) => item.id)).toEqual(['old']);
  });
});

describe('hasUnfinishedRuns', () => {
  it('is true while a run of this demo is not final, including one Auto Agent has not listed yet', () => {
    expect(hasUnfinishedRuns([], [run('r', 'RUNNING', 'x')], 'job-1')).toBe(true);
    expect(hasUnfinishedRuns([mine('a', 'run-new', 'x')], [], 'job-1')).toBe(true);
    expect(hasUnfinishedRuns([mine('a', 'run-1', 'x')], [run('run-1', 'SUCCESS', 'x')], 'job-1')).toBe(false);
  });

  it('ignores items sent to another demo', () => {
    expect(hasUnfinishedRuns([mine('a', 'run-new', 'x')], [], 'job-2')).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run lib/run-status.test.ts lib/sent-groups.test.ts`
Expected: FAIL, because neither module exists.

- [ ] **Step 3: Implement status and grouping**

`lib/run-status.ts`:

```ts
export type RunTone = 'pending' | 'running' | 'done' | 'failed';

const FINISHED: ReadonlySet<string> = new Set(['SUCCESS', 'FAILED', 'CANCELLED']);

export function isFinished(status: string): boolean {
  return FINISHED.has(status);
}

function inWords(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The chip for a feedback run. `status` is undefined until Auto Agent lists the run;
 * `requiresApproval` comes from creating it and matters only until the run starts.
 */
export function runStatus(status: string | undefined, requiresApproval: boolean): { label: string; tone: RunTone } {
  switch (status) {
    case 'SUCCESS':
      return { label: 'Done', tone: 'done' };
    case 'FAILED':
      return { label: 'Failed', tone: 'failed' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'failed' };
    case 'RUNNING':
      return { label: 'Running', tone: 'running' };
    case undefined:
    case 'PENDING':
      return requiresApproval
        ? { label: 'Waiting for approval', tone: 'pending' }
        : { label: 'Queued', tone: 'pending' };
    default:
      return { label: inWords(status), tone: 'running' };
  }
}
```

`lib/sent-groups.ts`:

```ts
import type { FeedbackRun } from './api/auto-agent-client';
import { isFinished } from './run-status';
import type { SentFeedback } from './types';

export type SentGroup = {
  key: string;
  /** Null for items sent before the extension was connected to Auto Agent. */
  runId: string | null;
  sentAt: string;
  /** Undefined until Auto Agent lists the run. */
  status: string | undefined;
  requiresApproval: boolean;
  /** Set for runs this browser has no items for: someone else's, or sent from another page. */
  createdBy: string | null;
  items: SentFeedback[];
};

/** Sent items grouped by the run they went out in, newest run first, plus the demo's other runs. */
export function groupSent(sent: SentFeedback[], runs: FeedbackRun[]): SentGroup[] {
  const byRun = new Map<string, SentGroup>();
  const earlier: SentFeedback[] = [];
  for (const item of sent) {
    if (!item.run) {
      earlier.push(item);
      continue;
    }
    const group = byRun.get(item.run.jobId) ?? {
      key: item.run.jobId,
      runId: item.run.jobId,
      sentAt: item.run.sentAt,
      status: undefined,
      requiresApproval: item.run.requiresApproval,
      createdBy: null,
      items: [],
    };
    group.items.push(item);
    byRun.set(item.run.jobId, group);
  }
  for (const run of runs) {
    const group = byRun.get(run.id);
    if (group) {
      group.status = run.status;
    } else {
      byRun.set(run.id, {
        key: run.id,
        runId: run.id,
        sentAt: run.createdAt,
        status: run.status,
        requiresApproval: false,
        createdBy: run.createdBy,
        items: [],
      });
    }
  }
  const groups = [...byRun.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  if (earlier.length > 0) {
    groups.push({
      key: 'earlier',
      runId: null,
      sentAt: '',
      status: undefined,
      requiresApproval: false,
      createdBy: null,
      items: earlier,
    });
  }
  return groups;
}

/** True while a run on `demoJobId` may still change, so its status is worth asking for again. */
export function hasUnfinishedRuns(sent: SentFeedback[], runs: FeedbackRun[], demoJobId: string): boolean {
  if (runs.some((run) => !isFinished(run.status))) return true;
  const listed = new Set(runs.map((run) => run.id));
  return sent.some((item) => item.run?.demoJobId === demoJobId && !listed.has(item.run.jobId));
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run lib/run-status.test.ts lib/sent-groups.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Replace `useAuth` and add `useJobMatch` and `useRuns`**

In `entrypoints/panel/hooks.ts`:

1. Replace the imports of `watchTokens` (`@/lib/auth/oauth`) and `watchSettings` (`@/lib/settings-store`) with:
   ```ts
   import type { FeedbackRun } from '@/lib/api/auto-agent-client';
   import type { JobMatch } from '@/lib/api/job-matcher';
   import { watchSession } from '@/lib/auth/session';
   import { hasUnfinishedRuns } from '@/lib/sent-groups';
   ```
   Remove `type Result` from the `@/lib/messages` import if nothing else uses it.
2. Replace the `Auth` type and `useAuth` function with:

```ts
export type Auth = {
  state: AuthState | null;
  error: string | null;
  busy: boolean;
  signIn: () => void;
  signOut: () => void;
};

export function useAuth(): Auth {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedIn = useRef(false);
  // Set while the reviewer signs out, so that is not reported as an ended session.
  const leaving = useRef(false);

  const apply = useCallback((next: AuthState) => {
    if (signedIn.current && !next.signedIn && !leaving.current) {
      setError('Your session ended. Sign in again.');
    } else if (next.signedIn) {
      setError(null);
    }
    signedIn.current = next.signedIn;
    leaving.current = false;
    setState(next);
  }, []);

  const refresh = useCallback(() => {
    void sendToBackground({ type: 'auth-state' }).then((result) => {
      if (result.ok) apply(result.value);
      else setError(result.error);
    });
  }, [apply]);

  // The session also changes outside this panel: a failed refresh, or Options.
  useEffect(() => {
    refresh();
    return watchSession(refresh);
  }, [refresh]);

  const signIn = () => {
    setBusy(true);
    setError(null);
    void sendToBackground({ type: 'sign-in' }).then((result) => {
      setBusy(false);
      if (result.ok) apply(result.value);
      else setError(result.error);
    });
  };

  const signOut = () => {
    leaving.current = true;
    setBusy(true);
    void sendToBackground({ type: 'sign-out' }).then((result) => {
      setBusy(false);
      if (result.ok) apply(result.value);
      else setError(result.error);
    });
  };

  return { state, error, busy, signIn, signOut };
}
```

3. Append:

```ts
export type JobState =
  | { status: 'idle' }
  | { status: 'resolving' }
  | { status: 'matched'; match: JobMatch }
  /** The picker is open; `previous` is the demo to go back to on Cancel. */
  | { status: 'choosing'; previous: JobMatch | null; error: string | null };

export type JobMatching = {
  state: JobState;
  choose: (match: JobMatch) => void;
  change: () => void;
  cancel: () => void;
  retry: () => void;
};

/** Which demo job the page belongs to: found by its site, or chosen by the reviewer. */
export function useJobMatch(url: string | undefined, enabled: boolean): JobMatching {
  const [state, setState] = useState<JobState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef(url);
  urlRef.current = url;
  // Every page of a demo belongs to the same job, so a route change must not look it up again.
  const origin = useMemo(() => {
    try {
      return url ? new URL(url).origin : null;
    } catch {
      return null;
    }
  }, [url]);

  useEffect(() => {
    const pageUrl = urlRef.current;
    if (!enabled || !origin || !pageUrl) {
      setState({ status: 'idle' });
      return;
    }
    let active = true;
    setState({ status: 'resolving' });
    void sendToBackground({ type: 'resolve-job', url: pageUrl }).then((result) => {
      if (!active) return;
      if (result.ok && result.value) setState({ status: 'matched', match: result.value });
      else setState({ status: 'choosing', previous: null, error: result.ok ? null : result.error });
    });
    return () => {
      active = false;
    };
  }, [origin, enabled, attempt]);

  const choose = (match: JobMatch) => {
    const pageUrl = urlRef.current;
    if (!pageUrl) return;
    void sendToBackground({ type: 'choose-job', url: pageUrl, match }).then((result) => {
      if (result.ok) setState({ status: 'matched', match: result.value });
      else setState({ status: 'choosing', previous: null, error: result.error });
    });
  };

  return {
    state,
    choose,
    change: () =>
      setState((current) => ({
        status: 'choosing',
        previous: current.status === 'matched' ? current.match : null,
        error: null,
      })),
    cancel: () =>
      setState((current) =>
        current.status === 'choosing' && current.previous ? { status: 'matched', match: current.previous } : current,
      ),
    retry: () => setAttempt((n) => n + 1),
  };
}

const RUN_POLL_MS = 10_000;

/**
 * The feedback runs on the page's demo, asked for again every 10 seconds while one is
 * unfinished and the panel is visible.
 */
export function useRuns(
  url: string | undefined,
  demoJobId: string | null,
  sent: SentFeedback[],
  onForbidden: () => void,
): { runs: FeedbackRun[]; error: string | null; reload: () => void } {
  const [runs, setRuns] = useState<FeedbackRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const urlRef = useRef(url);
  urlRef.current = url;
  const forbiddenRef = useRef(onForbidden);
  forbiddenRef.current = onForbidden;

  useEffect(() => {
    setRuns([]);
    setError(null);
  }, [demoJobId]);

  useEffect(() => {
    const pageUrl = urlRef.current;
    if (!demoJobId || !pageUrl) return;
    let active = true;
    void sendToBackground({ type: 'job-runs', url: pageUrl }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setRuns(result.value);
        setError(null);
      } else {
        setError(result.error);
        if (result.code === 'forbidden') forbiddenRef.current();
      }
    });
    return () => {
      active = false;
    };
  }, [demoJobId, tick]);

  const waiting = useMemo(
    () => demoJobId !== null && hasUnfinishedRuns(sent, runs, demoJobId),
    [sent, runs, demoJobId],
  );

  useEffect(() => {
    if (!waiting) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = setTimeout(() => setTick((n) => n + 1), RUN_POLL_MS);
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [waiting, tick]);

  return { runs, error, reload: () => setTick((n) => n + 1) };
}
```

- [ ] **Step 6: Add the panel components**

`entrypoints/panel/SignIn.tsx`:

```tsx
type Props = { busy: boolean; error: string | null; onSignIn: () => void };

/** The whole panel while signed out: nothing can be reviewed or sent without an account. */
export function SignIn({ busy, error, onSignIn }: Props) {
  return (
    <div className="signin">
      <p>
        Sign in with your Saigon Technology Microsoft account to review this page and send feedback
        to Auto Agent.
      </p>
      <button type="button" className="primary signin__button" disabled={busy} onClick={onSignIn}>
        {busy ? 'Signing in…' : 'Sign in with Microsoft'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

`entrypoints/panel/JobPicker.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { Project } from '@/lib/api/auto-agent-client';
import type { JobMatch } from '@/lib/api/job-matcher';
import { sendToBackground } from '@/lib/background-client';

const SERVICE_LABELS: Record<string, string> = {
  FRONTEND_DEMO: 'Frontend demo',
  FRONTEND_DEMO_NEXT_PHASE: 'Frontend demo, next phase',
  MOBILE_DEMO: 'Mobile demo',
  MOBILE_DEMO_NEXT_PHASE: 'Mobile demo, next phase',
};

function jobLabel(job: JobMatch): string {
  const date = job.completedAt ? new Date(job.completedAt).toLocaleDateString() : '';
  return [job.jobName, SERVICE_LABELS[job.serviceType] ?? job.serviceType, date].filter(Boolean).join(' · ');
}

type Props = {
  note: string;
  error: string | null;
  onChoose: (match: JobMatch) => void;
  /** Absent when there is no demo to go back to. */
  onCancel?: () => void;
};

/** Project → demo, for a page whose site does not match any demo the reviewer can see. */
export function JobPicker({ note, error, onChoose, onCancel }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [jobs, setJobs] = useState<JobMatch[] | null>(null);
  const [jobId, setJobId] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void sendToBackground({ type: 'list-projects' }).then((result) => {
      if (result.ok) setProjects(result.value);
      else setLoadError(result.error);
    });
  }, []);

  useEffect(() => {
    setJobs(null);
    setJobId('');
    const project = projects?.find((candidate) => candidate.id === projectId);
    if (!project) return;
    let active = true;
    void sendToBackground({ type: 'list-demo-jobs', project }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setJobs(result.value);
        setJobId(result.value[0]?.jobId ?? '');
      } else {
        setLoadError(result.error);
      }
    });
    return () => {
      active = false;
    };
  }, [projectId, projects]);

  const job = jobs?.find((candidate) => candidate.jobId === jobId);

  return (
    <form
      className="picker"
      aria-label="Choose demo"
      onSubmit={(event) => {
        event.preventDefault();
        if (job) onChoose(job);
      }}
    >
      <p>{note}</p>
      {error && <p className="error">{error}</p>}
      <label>
        Project
        <select value={projectId} disabled={!projects} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">{projects ? 'Choose a project' : 'Loading…'}</option>
          {projects?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Demo
        <select value={jobId} disabled={!jobs || jobs.length === 0} onChange={(event) => setJobId(event.target.value)}>
          {!jobs && <option value="">{projectId ? 'Loading…' : 'Choose a project first'}</option>}
          {jobs?.length === 0 && <option value="">No finished demos in this project</option>}
          {jobs?.map((candidate) => (
            <option key={candidate.jobId} value={candidate.jobId}>
              {jobLabel(candidate)}
            </option>
          ))}
        </select>
      </label>
      {loadError && <p className="error">{loadError}</p>}
      <div className="row__actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary" disabled={!job}>
          Use this demo
        </button>
      </div>
    </form>
  );
}
```

`entrypoints/panel/RunGroup.tsx`:

```tsx
import type { ReactNode } from 'react';
import { WEB_BASE } from '@/lib/config';
import { runStatus } from '@/lib/run-status';
import type { SentGroup } from '@/lib/sent-groups';

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** One feedback run: when it was sent, how it is going, and the items that went out in it. */
export function RunGroup({ group, children }: { group: SentGroup; children: ReactNode }) {
  const status = group.runId ? runStatus(group.status, group.requiresApproval) : null;
  return (
    <li className="run">
      <div className="run__heading">
        <span className="run__title">
          {group.runId ? `Sent ${formatSentAt(group.sentAt)}` : 'Sent earlier'}
          {group.createdBy && <span className="muted"> by {group.createdBy}</span>}
        </span>
        {status && <span className={`chip chip--${status.tone}`}>{status.label}</span>}
        {group.runId && (
          <a className="run__link" href={`${WEB_BASE}/jobs/${group.runId}`} target="_blank" rel="noreferrer">
            Open in Auto Agent
          </a>
        )}
      </div>
      {group.items.length > 0 && <ul>{children}</ul>}
    </li>
  );
}
```

- [ ] **Step 7: Update the panel**

In `entrypoints/panel/App.tsx`:

1. Imports:
   - Remove `import { browser } from 'wxt/browser';`.
   - Change `import { feedbackPayload } from '@/lib/api/feedback-payload';` to `import { feedbackFileName, feedbackPayload } from '@/lib/api/feedback-payload';`.
   - Change `import { LOCAL_ONLY, WORKFLOW_RECORDING } from '@/lib/config';` to `import { WORKFLOW_RECORDING } from '@/lib/config';`.
   - Add `import { useRef } from 'react';` to the existing React import (`useEffect, useMemo, useRef, useState`).
   - Add:
     ```ts
     import { groupSent } from '@/lib/sent-groups';
     import { JobPicker } from './JobPicker';
     import { RunGroup } from './RunGroup';
     import { SignIn } from './SignIn';
     ```
   - Add `useJobMatch` and `useRuns` to the `./hooks` import.

2. Directly after `const sent = useSent(context, send);` add:

```ts
  const signedIn = auth.state?.signedIn === true;
  const jobs = useJobMatch(context?.url, signedIn);
  const match = jobs.state.status === 'matched' ? jobs.state.match : null;
  const runs = useRuns(context?.url, match?.jobId ?? null, sent, jobs.retry);
  const sentGroups = useMemo(() => groupSent(sent, runs.runs), [sent, runs.runs]);
```

3. Below `const [sendError, setSendError] = useState<string | null>(null);` add:

```ts
  // Two clicks in one frame both see `sending` false; the ref stops the second from starting a run.
  const sendingRef = useRef(false);
```

4. Replace `const openOptions = …` and the whole `accountActions` definition with:

```tsx
  const user = auth.state?.user;
  const accountActions = user && (
    <div className="header__actions">
      <span className="header__user" title={user.username}>
        {user.displayName}
      </span>
      <button type="button" onClick={auth.signOut} disabled={auth.busy}>
        Sign out
      </button>
    </div>
  );
```

5. Directly after the `header` definition (before `if (review) {`), add the sign-in gate:

```tsx
  if (!auth.state || !auth.state.signedIn) {
    return (
      <div className="panel">
        {header}
        <div className="panel__body">
          {auth.state ? (
            <SignIn busy={auth.busy} error={auth.error} onSignIn={auth.signIn} />
          ) : (
            auth.error && <p className="error">{auth.error}</p>
          )}
        </div>
      </div>
    );
  }
```

6. Replace `const canSend = auth.state !== null && auth.state.configured && auth.state.signedIn;` and the `submit` and `exportDrafts` functions with:

```tsx
  const canSend = match !== null;

  const submit = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    const result = await sendToBackground({
      type: 'submit',
      projectId,
      url: context.url,
      ids: chosen.map((draft) => draft.id),
    });
    sendingRef.current = false;
    setSending(false);
    if (result.ok) {
      runs.reload();
    } else {
      setSendError(result.error);
      if (result.code === 'forbidden') jobs.retry();
    }
  };

  // The same file Send uploads, for a reviewer who wants to keep or inspect it.
  const exportDrafts = () => {
    downloadJson(feedbackFileName(projectId, new Date()), feedbackPayload(chosen, clientInfo()));
  };

  let demo: React.ReactNode = null;
  if (jobs.state.status === 'resolving') {
    demo = <p className="demo muted">Finding this demo in Auto Agent…</p>;
  } else if (jobs.state.status === 'matched') {
    demo = (
      <div className="demo">
        <span className="demo__label">Demo</span>
        <span className="demo__name">
          {jobs.state.match.projectName} · {jobs.state.match.jobName}
        </span>
        <button type="button" className="link" onClick={jobs.change}>
          Change
        </button>
      </div>
    );
  } else if (jobs.state.status === 'choosing') {
    demo = (
      <JobPicker
        note={
          jobs.state.previous
            ? 'Choose the demo this page belongs to:'
            : 'This page did not match any of your demos. Choose one:'
        }
        error={jobs.state.error}
        onChoose={jobs.choose}
        onCancel={jobs.state.previous ? jobs.cancel : undefined}
      />
    );
  }
```

   Use `import type { ReactNode } from 'react'` and `ReactNode` instead of `React.ReactNode` if the file does not already have `React` in scope.

7. In the main return, replace the block

```tsx
        {auth.state && !auth.state.configured && (
          <p className="notice">
            The API is not set up yet.{' '}
            <button type="button" className="link" onClick={openOptions}>
              Open Options
            </button>
          </p>
        )}
```

with `{demo}`.

8. Replace the whole `<section aria-label="Sent">…</section>` with:

```tsx
          <section aria-label="Sent">
            <h2>Sent</h2>
            {runs.error && <p className="error">{runs.error}</p>}
            {sentGroups.length === 0 && <p className="empty">Nothing has been sent to this demo yet.</p>}
            <ul className="runs">
              {sentGroups.map((group) => (
                <RunGroup key={group.key} group={group}>
                  {group.items.map((item) => (
                    <SentRow
                      key={item.id}
                      item={item}
                      number={numbers.get(item.id)}
                      missing={missing.has(item.id)}
                      missingSteps={missingSteps}
                      onGoTo={(step) => goTo(item, step)}
                      onFocus={numbers.has(item.id) ? () => send({ type: 'focus-item', id: item.id }) : undefined}
                      onResolve={() => void setFeedbackStatus(projectId, item.id, 'resolved')}
                      onReopen={() => void setFeedbackStatus(projectId, item.id, 'open')}
                    />
                  ))}
                </RunGroup>
              ))}
            </ul>
          </section>
```

9. In the footer, replace

```tsx
        {auth.state && auth.state.configured && !auth.state.signedIn && (
          <p className="muted">Sign in to send your drafts.</p>
        )}
```

with

```tsx
        {!canSend && <p className="muted">Choose the demo this page belongs to before sending.</p>}
```

- [ ] **Step 8: Style the new parts**

Append to `entrypoints/panel/style.css`:

```css
/* Sign-in */

.signin {
  display: grid;
  gap: 14px;
  margin-top: 22px;
}

.signin__button {
  justify-self: start;
  padding: 8px 18px;
}

.header__user {
  max-width: 160px;
  overflow: hidden;
  font-size: 13px;
  color: #d6d3d1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The demo the page belongs to */

.demo {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.demo__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.demo__name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.picker {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.picker label {
  display: grid;
  gap: 4px;
  font-weight: 500;
}

.picker select {
  padding: 6px 8px;
  font: inherit;
  color: inherit;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.picker .error {
  margin-top: 0;
}

/* Sent, grouped by feedback run */

.runs > li + li {
  margin-top: 12px;
}

.run__heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 0;
}

.run__title {
  flex: 1;
  min-width: 0;
  font-weight: 500;
}

.run__link {
  font-weight: 500;
  color: var(--green-text);
}

.chip {
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--line);
  border-radius: 999px;
}

.chip--pending {
  color: var(--muted);
}

.chip--running {
  color: var(--green-text);
  border-color: var(--green-text);
}

.chip--done {
  color: var(--ink-deep);
  background: var(--green);
  border-color: var(--green);
}

.chip--failed {
  color: var(--danger);
  border-color: var(--danger);
}
```

- [ ] **Step 9: Rewrite Options**

Replace `entrypoints/options/App.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { type Session, getSession, watchSession } from '@/lib/auth/session';
import { sendToBackground } from '@/lib/background-client';

function CompanyLogo() {
  return (
    <picture>
      <source srcSet="/brand/logo-white.svg" media="(prefers-color-scheme: dark)" />
      <img
        className="options__logo"
        src="/brand/logo-black.svg"
        alt="Saigon Technology"
        width="175"
        height="40"
      />
    </picture>
  );
}

export function App() {
  // Undefined until the stored session has been read, so the page does not flash "Not signed in".
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void getSession().then(setSession);
    return watchSession(setSession);
  }, []);

  return (
    <div className="options">
      <CompanyLogo />
      <h1>Auto Agent options</h1>
      {session === null && (
        <p className="notice">Not signed in. Open the Auto Agent panel on a page to sign in.</p>
      )}
      {session && (
        <>
          <p className="options__account">
            Signed in as <strong>{session.user.displayName}</strong> ({session.user.username})
          </p>
          <button type="button" className="primary submit" onClick={() => void sendToBackground({ type: 'sign-out' })}>
            Sign out
          </button>
        </>
      )}
    </div>
  );
}
```

Append to `entrypoints/options/style.css`:

```css
.options__account {
  margin-top: 16px;
}
```

Replace `e2e/options.spec.ts` with (it runs in Task 7):

```ts
import { expect, test } from './fixtures';
import { openReview } from './helpers';

test('options show the account and sign out of the panel too', async ({ context, worker, extensionId }) => {
  const { panel } = await openReview(context, worker, extensionId);
  await expect(panel.getByText('Test Reviewer')).toBeVisible();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByText('Signed in as Test Reviewer (tester)')).toBeVisible();

  await options.getByRole('button', { name: 'Sign out' }).click();
  await expect(options.getByText('Not signed in. Open the Auto Agent panel on a page to sign in.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
});
```

- [ ] **Step 10: Remove the old API code**

```bash
git rm lib/auth/oauth.ts lib/auth/oauth.test.ts lib/auth/pkce.ts lib/auth/pkce.test.ts \
  lib/api/feedback-api.ts lib/api/http-feedback-api.ts lib/api/http-feedback-api.test.ts \
  lib/api/mock-feedback-api.ts lib/api/mock-feedback-api.test.ts \
  lib/settings-store.ts lib/settings-store.test.ts
```

Then:
- In `lib/types.ts`, delete the `OAuthSettings` and `Settings` types.
- In `lib/config.ts`, delete the `LOCAL_ONLY` constant with its comment, and change the file's top comment to: `/** Build-time switches. */`.

Run: `grep -rn "LOCAL_ONLY\|settings-store\|auth/oauth\|auth/pkce\|feedback-api'\|mock-feedback-api\|http-feedback-api\|OAuthSettings\|MOCK_AUTHOR" lib entrypoints components e2e`
Expected: no output.

- [ ] **Step 11: Type-check and unit-test**

Run: `pnpm compile && pnpm test`
Expected: both succeed with no errors.

- [ ] **Step 12: Commit**

```bash
git add -A lib entrypoints e2e/options.spec.ts
git commit -m "feat: sign in, pick the demo and follow feedback runs in the panel"
```

---

### Task 7: End-to-end tests against a fake Auto Agent, and docs

**Files:**
- Create: `.env.e2e`
- Modify: `package.json`, `e2e/serve.mjs`, `e2e/fixtures.ts`, `e2e/helpers.ts`, `e2e/smoke.spec.ts`
- Create: `e2e/auto-agent.spec.ts`
- Modify: `README.md`
- Delete: `docs/tool-api-requirements.md`

**Interfaces:**
- Consumes: the UI names listed in Task 6's Produces block.
- Produces: `FAKE_API` (exported from `e2e/helpers.ts`), and a `signedIn` fixture option (default `true`) in `e2e/fixtures.ts`.

- [ ] **Step 1: Build the e2e extension against the fake API**

Create `.env.e2e`:

```
# `pnpm test:e2e` builds with this mode, so the extension talks to the fake API in e2e/serve.mjs.
WXT_API_BASE=http://localhost:4173/fake-auto-agent/api/v1
```

In `package.json`, change the `test:e2e` script to:

```json
"test:e2e": "wxt build --mode e2e && playwright test",
```

Run: `pnpm wxt build --mode e2e && ls .output`
Expected: a folder for the e2e build, normally `chrome-mv3-e2e`, next to any production `chrome-mv3`. If WXT names it differently, use that name in Step 3. Then check the API base was baked in:

Run: `grep -rl "fake-auto-agent" .output/chrome-mv3-e2e/background.js`
Expected: the file path is printed.

- [ ] **Step 2: Add the fake Auto Agent API**

Replace `e2e/serve.mjs` with:

```js
// Serves the end-to-end test pages in e2e/pages on http://localhost:4173, and a fake Auto Agent
// API under /fake-auto-agent/api/v1 that the e2e build of the extension talks to.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./pages', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

const FAKE = '/fake-auto-agent/api/v1';
const USER = { id: 'u-test', username: 'tester', displayName: 'Test Reviewer', role: 'DEVELOPER', allowedServices: ['DEMO_FEEDBACK'] };
const PROJECTS = [
  { id: 'p-shop', name: 'Demo Shop', stage: 'INQUIRY' },
  { id: 'p-other', name: 'Other Project', stage: 'PROJECT' },
];
// job-shop is deployed at this server, so the fixture pages on localhost match it.
const JOBS = [
  { id: 'job-shop', projectId: 'p-shop', serviceType: 'FRONTEND_DEMO', status: 'SUCCESS', jobName: 'Frontend Demo #shop', completedAt: '2026-09-30T10:00:00.000Z', deploymentUrl: `http://localhost:${port}` },
  { id: 'job-shop-failed', projectId: 'p-shop', serviceType: 'FRONTEND_DEMO', status: 'FAILED', jobName: 'Frontend Demo #failed', completedAt: '2026-09-30T11:00:00.000Z', deploymentUrl: null },
  { id: 'job-other', projectId: 'p-other', serviceType: 'MOBILE_DEMO', status: 'SUCCESS', jobName: 'Mobile Demo #other', completedAt: '2026-09-29T10:00:00.000Z', deploymentUrl: 'https://other-demo.web.app' },
];

const fresh = () => ({ runs: [], uploads: [] });
let state = fresh();

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: USER.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
}

function reply(response, status, data, pagination = null) {
  response
    .writeHead(status, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ data, message: 'OK', error: null, pagination }));
}

function fail(response, status, message) {
  response
    .writeHead(status, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ data: null, message, error: 'ERROR', pagination: null }));
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const summary = ({ id, serviceType, status, jobName, completedAt }) => ({ id, serviceType, status, jobName, completedAt, projectName: 'Demo Shop' });

async function fakeApi(request, response, url) {
  const path = url.pathname.slice(FAKE.length);

  // Test controls.
  if (path === '/_reset') {
    state = fresh();
    return reply(response, 200, null);
  }
  if (path === '/_state') return reply(response, 200, state);
  if (path.startsWith('/_finish/')) {
    const run = state.runs.find((candidate) => candidate.id === path.slice('/_finish/'.length));
    if (run) Object.assign(run, { status: 'SUCCESS', completedAt: new Date().toISOString() });
    return reply(response, 200, run ?? null);
  }

  if (path === '/auth/login') {
    const redirect = new URL(url.searchParams.get('cli_redirect'));
    redirect.searchParams.set('token', fakeJwt());
    redirect.searchParams.set('refreshToken', 'refresh-test');
    redirect.searchParams.set('user', JSON.stringify(USER));
    redirect.searchParams.set('state', url.searchParams.get('cli_state') ?? '');
    response.writeHead(302, { Location: redirect.toString() }).end();
    return;
  }
  if (path === '/auth/refresh' && request.method === 'POST') {
    return reply(response, 200, { accessToken: fakeJwt(), refreshToken: 'refresh-test' });
  }

  if (!request.headers.authorization?.startsWith('Bearer ')) return fail(response, 401, 'Authentication required');

  if (path === '/projects') return reply(response, 200, PROJECTS, { total: PROJECTS.length, page: 1, itemPerPage: 100 });
  if (path === '/jobs') {
    const status = url.searchParams.get('status');
    const items = JOBS.filter((job) => job.projectId === url.searchParams.get('projectId') && (!status || job.status === status)).map(summary);
    return reply(response, 200, items, { total: items.length, page: 1, itemPerPage: 100 });
  }
  if (path === '/files/upload' && request.method === 'POST') {
    const body = await readBody(request);
    const name = /filename="([^"]+)"/.exec(body)?.[1] ?? 'upload';
    const upload = { id: `file-${state.uploads.length + 1}`, name, body };
    state.uploads.push(upload);
    return reply(response, 201, [{ id: upload.id, originalName: name }]);
  }
  const feedback = /^\/jobs\/([^/]+)\/feedback$/.exec(path);
  if (feedback && request.method === 'POST') {
    const body = JSON.parse(await readBody(request));
    const run = {
      id: `run-${state.runs.length + 1}`,
      demoJobId: feedback[1],
      status: 'RUNNING',
      createdAt: new Date().toISOString(),
      completedAt: null,
      feedbackDescription: body.description ?? null,
      feedbackFiles: (body.fileIds ?? []).map((id) => state.uploads.find((upload) => upload.id === id)?.name ?? id),
      createdBy: USER.username,
    };
    state.runs.push(run);
    return reply(response, 201, { id: run.id, status: 'PENDING', requiresApproval: false });
  }
  const job = /^\/jobs\/([^/]+)$/.exec(path);
  if (job) {
    const found = JOBS.find((candidate) => candidate.id === job[1]);
    if (!found) return fail(response, 404, 'Job not found');
    const project = PROJECTS.find((candidate) => candidate.id === found.projectId);
    return reply(response, 200, {
      ...summary(found),
      deploymentUrl: found.deploymentUrl,
      project: { id: project.id, name: project.name },
      feedbackHistory: state.runs.filter((run) => run.demoJobId === found.id).map(({ demoJobId: _job, ...run }) => run),
    });
  }
  return fail(response, 404, 'Not found');
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith(FAKE)) {
    void fakeApi(request, response, url);
    return;
  }
  // Lets test pages make a request that fails.
  if (url.pathname.startsWith('/api/')) {
    response.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"boom"}');
    return;
  }
  const pathname = decodeURIComponent(url.pathname);
  const relative = normalize(pathname === '/' ? '/index.html' : pathname);
  const file = join(root, relative);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, () => console.log(`Test pages at http://localhost:${port}/`));
```

- [ ] **Step 3: Start each test signed in, with a fresh fake API**

Replace `e2e/fixtures.ts` with:

```ts
import { fileURLToPath } from 'node:url';
import { type BrowserContext, type Worker, test as base, chromium } from '@playwright/test';
import type { browser } from 'wxt/browser';

// `worker.evaluate` callbacks run inside the extension's service worker, where `chrome` exists.
declare const chrome: typeof browser;

const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3-e2e', import.meta.url));
const FAKE_API = 'http://localhost:4173/fake-auto-agent/api/v1';

type Fixtures = { context: BrowserContext; worker: Worker; extensionId: string; signedIn: boolean };

function fakeJwt(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u-test', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
}

/** Launches Chromium with the e2e build loaded, signed in to the fake Auto Agent unless a test opts out. */
export const test = base.extend<Fixtures>({
  signedIn: [true, { option: true }],
  // Playwright requires the first argument to be a destructuring pattern, even an empty one.
  context: async ({}, use) => {
    await fetch(`${FAKE_API}/_reset`, { method: 'POST' });
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // Playwright turns the back/forward cache off; real Chrome has it on.
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context, signedIn }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    if (signedIn) {
      const accessToken = fakeJwt();
      await worker.evaluate(async (session) => {
        await chrome.storage.local.set({ session });
      }, {
        accessToken,
        refreshToken: 'refresh-test',
        expiresAt: Date.now() + 3_600_000,
        user: { id: 'u-test', username: 'tester', displayName: 'Test Reviewer', role: 'DEVELOPER', allowedServices: ['DEMO_FEEDBACK'] },
      });
    }
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
```

In `e2e/helpers.ts`, add below `OTHER_HOST`:

```ts
/** The fake Auto Agent API served by e2e/serve.mjs. */
export const FAKE_API = 'http://localhost:4173/fake-auto-agent/api/v1';

/** What the fake Auto Agent has received so far. */
export async function fakeApiState(): Promise<{
  runs: Array<{ id: string; demoJobId: string; status: string; feedbackDescription: string; feedbackFiles: string[] }>;
  uploads: Array<{ id: string; name: string; body: string }>;
}> {
  return (await (await fetch(`${FAKE_API}/_state`)).json()).data;
}
```

- [ ] **Step 4: Write the new e2e tests**

`e2e/auto-agent.spec.ts`:

```ts
import { expect, test } from './fixtures';
import { FAKE_API, OTHER_HOST, expectConnected, fakeApiState, openReview, pinComment, setMode } from './helpers';

test.describe('signed out', () => {
  test.use({ signedIn: false });

  test('the panel asks for sign-in first, and signing out returns to it', async ({ context, worker, extensionId }) => {
    const { panel } = await openReview(context, worker, extensionId);
    await expect(panel.getByRole('group', { name: 'Mode' })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Sign in with Microsoft' }).click();
    await expect(panel.getByText('Test Reviewer')).toBeVisible();
    await expectConnected(panel);

    await panel.getByRole('button', { name: 'Sign out' }).click();
    await expect(panel.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
    await expect(panel.getByText('Your session ended')).toHaveCount(0);
  });
});

test('a page on a demo’s site finds the demo, and Send starts one feedback run', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await expect(panel.getByText('Demo Shop · Frontend Demo #shop')).toBeVisible();

  await setMode(panel, 'Select');
  await page.bringToFront();
  await pinComment(page, '#buy', 'Make this button bigger');
  await panel.bringToFront();
  // A double click must not start two runs.
  await panel.getByRole('button', { name: 'Send 1 draft' }).dblclick();

  const sent = panel.getByRole('region', { name: 'Sent' });
  await expect(sent.getByText('Make this button bigger')).toBeVisible();
  await expect(sent.getByText('Running', { exact: true })).toBeVisible();
  await expect(sent.getByRole('link', { name: 'Open in Auto Agent' })).toHaveAttribute('href', 'http://localhost:4173/jobs/run-1');
  await expect(page.locator('[data-vf-pin="sent"]')).toHaveText('1');

  const state = await fakeApiState();
  expect(state.runs).toHaveLength(1);
  expect(state.runs[0]!.demoJobId).toBe('job-shop');
  expect(state.runs[0]!.feedbackDescription).toContain('Make this button bigger');
  expect(state.runs[0]!.feedbackFiles[0]).toMatch(/^auto-agent-feedback-localhost-4173-.+\.json$/);
  expect(state.uploads[0]!.body).toContain('"comment": "Make this button bigger"');

  // The finished run shows up without reopening the panel.
  await fetch(`${FAKE_API}/_finish/run-1`, { method: 'POST' });
  await expect(sent.getByText('Done', { exact: true })).toBeVisible({ timeout: 15_000 });
});

test('a page that matches no demo asks which one it belongs to and remembers the answer', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'plain.html', OTHER_HOST);
  const picker = panel.getByRole('form', { name: 'Choose demo' });
  await expect(picker.getByText('This page did not match any of your demos. Choose one:')).toBeVisible();

  await setMode(panel, 'Select');
  await pinComment(page, 'h1', 'Works on any host');
  await expect(panel.getByRole('button', { name: 'Send 1 draft' })).toBeDisabled();

  await picker.getByLabel('Project').selectOption({ label: 'Other Project' });
  await expect(picker.getByLabel('Demo')).toContainText('Mobile Demo #other');
  await picker.getByRole('button', { name: 'Use this demo' }).click();
  await expect(panel.getByText('Other Project · Mobile Demo #other')).toBeVisible();

  await panel.reload();
  await expect(panel.getByText('Other Project · Mobile Demo #other')).toBeVisible();
  await panel.getByRole('button', { name: 'Send 1 draft' }).click();
  await expect(panel.getByRole('region', { name: 'Sent' }).getByText('Works on any host')).toBeVisible();
  expect((await fakeApiState()).runs[0]!.demoJobId).toBe('job-other');
});
```

- [ ] **Step 5: Update the existing smoke tests**

In `e2e/smoke.spec.ts`:
- In the third test (`any page can be reviewed, without preview markers and on any host`), delete the last block that clicks `Send 1` and checks the Sent region (the picker test in `auto-agent.spec.ts` covers sending from a host with no demo). Keep the Export JSON checks.
- Delete the fourth test (`the panel offers no API settings or sign-in while feedback is local only`) entirely; `e2e/options.spec.ts` replaces it.

- [ ] **Step 6: Run the whole e2e suite**

Run: `pnpm test:e2e`
Expected: every test passes.

If the signed-out test fails because `launchWebAuthFlow` never completes under Playwright (the silent attempt times out after 15 s and the interactive window does not follow the 302), replace the click on **Sign in with Microsoft** in that test with seeding the session through the worker, the same way the `worker` fixture does, and keep the sign-out half of the test. Report that this happened.

If a test from `flow.spec.ts` or `review.spec.ts` fails because Send stays disabled, check that the page is on `http://localhost:4173` (the only origin with a fake demo). These tests do not need other changes.

- [ ] **Step 7: Update the README and remove the obsolete API request doc**

```bash
git rm docs/tool-api-requirements.md
```

In `README.md`:

1. Replace the line `Open a preview, pick an element, pin a comment, and send the batch to the tool.` with:
   `Open a demo deployed by Auto Agent, pick an element, pin a comment, and send the batch as an Update Feedback run.`
2. Add below the `Design:` line: ``Auto Agent integration: `docs/superpowers/specs/2026-10-01-auto-agent-integration-design.md` ``
3. In the commands table, change the `pnpm test:e2e` row to: `Builds with \`--mode e2e\` (into \`.output/chrome-mv3-e2e\`, talking to a fake Auto Agent API) and runs the Playwright tests; \`e2e/serve.mjs\` serves the pages and the fake API on port 4173`.
4. Replace the `## Testing mode` section with:

   ```markdown
   ## Switches

   `lib/config.ts` holds build-time switches:

   - `REQUIRE_PREVIEW_MARKERS = false`: it works on any web page. A page without the meta tags
     below uses its host as the project and `local` as the build.
   - `WORKFLOW_RECORDING = false`: the **Record workflow** button is hidden, so step 4 below is
     not available for now. Set it to `true` to turn workflow recording back on.
   - `API_BASE`: Auto Agent's API, `https://vibe.saigontechnology.vn/api/v1`. A build can point
     elsewhere with `WXT_API_BASE`, as `.env.e2e` does for the end-to-end tests.
   ```

5. In `## Using it`, insert a new step 1 and renumber the rest:

   ```markdown
   1. Click **Sign in with Microsoft** in the panel. Your Saigon Technology account must be a
      user in Auto Agent. The panel then looks for the demo deployed at the page's address; if
      none of your demos matches, choose the project and demo yourself. **Change** picks another.
   ```

   and change the sentence `Only ticked drafts are sent; the others stay as drafts.` to:
   `Only ticked drafts are sent, as one Update Feedback run on the demo; the others stay as drafts. The panel shows each run's status and links to it in Auto Agent.`

6. Replace the `## Connecting the real API` section with:

   ```markdown
   ## Auto Agent

   - Sign-in uses Auto Agent's browser-extension flow, so the extension id must be in the
     server's `BROWSER_EXTENSION_IDS`. The `key` in `wxt.config.ts` pins the id to
     `halobcdjpokedneejfmdjecjgdkejjdk` on every machine; do not change it.
   - `lib/api/auto-agent-client.ts` is the only file that knows Auto Agent's URLs and response
     shapes.
   - Auto Agent's download page asks the installed extension for its version through
     `externally_connectable`; the background answers `{ type: "ping" }`.
   - To publish a release: bump `version` in `package.json`, run `pnpm zip`, and upload the zip
     in Auto Agent under **System Settings → Browser Extension**.
   ```

- [ ] **Step 8: Run everything once more**

Run: `pnpm compile && pnpm test && pnpm test:e2e && pnpm build`
Expected: all succeed; `pnpm build` leaves a production build in `.output/chrome-mv3` with no `fake-auto-agent` in it:

Run: `grep -rl "fake-auto-agent" .output/chrome-mv3 || echo clean`
Expected: `clean`

- [ ] **Step 9: Commit**

```bash
git add .env.e2e package.json e2e README.md docs/tool-api-requirements.md
git commit -m "test: run the end-to-end suite against a fake Auto Agent API"
```

- [ ] **Step 10: Manual check against production (report the result, do not skip silently)**

1. `pnpm build`, then load `.output/chrome-mv3` unpacked in Chrome and check the id on `chrome://extensions` is `halobcdjpokedneejfmdjecjgdkejjdk`.
2. Open `https://test-browseros-portal-admin.web.app`, open the panel, sign in.
3. Expect the demo line `Test BrowserOS · Frontend Demo #f8a4b214` without a picker.
4. Only with the user's go-ahead (it starts a real run that redeploys the demo): pin one comment, Send, and check the run appears in Auto Agent with the Markdown description and the JSON file.
