import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ApiError, type FeedbackApi, UnauthorizedError } from './api/feedback-api';
import { createMockFeedbackApi } from './api/mock-feedback-api';
import { type HandlerDeps, handleRequest } from './background-handlers';
import { addDraft, listDrafts } from './draft-store';
import { listFeedback } from './feedback-store';
import { isBackgroundRequest } from './messages';
import { DEFAULT_SETTINGS } from './settings-store';
import { makeItem } from './test-helpers';
import type { FeedbackItem, Settings } from './types';

const real: Settings = {
  useMock: false,
  apiBase: 'https://api.example.com',
  oauth: {
    authorizeUrl: 'https://auth.example.com/authorize',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'ext',
    scopes: '',
  },
};

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getSettings: async () => DEFAULT_SETTINGS,
    createApi: () => createMockFeedbackApi(),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    isSignedIn: vi.fn(async () => false),
    ...overrides,
  };
}

function failingApi(error: Error): FeedbackApi {
  return {
    submit: async () => {
      throw error;
    },
  };
}

describe('handleRequest', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('submits every draft of the project and clears them', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await addDraft('p1', makeItem({ id: 'b' }));
    await addDraft('p2', makeItem({ id: 'other' }));

    const result = await handleRequest(
      { type: 'submit', projectId: 'p1', ids: ['a', 'b'] },
      makeDeps(),
    );

    expect(result).toMatchObject({ ok: true, value: [{ id: 'a' }, { id: 'b' }] });
    expect(await listDrafts('p1')).toEqual([]);
    expect((await listDrafts('p2')).map((d) => d.id)).toEqual(['other']);
  });

  it('sends only the chosen drafts and keeps the others', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await addDraft('p1', makeItem({ id: 'b' }));
    await addDraft('p1', makeItem({ id: 'c' }));
    const api: FeedbackApi = {
      submit: vi.fn(async (_projectId: string, items: FeedbackItem[]) =>
        items.map((item) => ({ ...item, author: { id: 'u', name: 'U' }, status: 'open' as const })),
      ),
    };

    const result = await handleRequest(
      { type: 'submit', projectId: 'p1', ids: ['a', 'c', 'gone'] },
      makeDeps({ createApi: () => api }),
    );

    expect(result).toMatchObject({ ok: true, value: [{ id: 'a' }, { id: 'c' }] });
    expect(vi.mocked(api.submit).mock.calls[0]![1].map((item: { id: string }) => item.id)).toEqual(['a', 'c']);
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['b']);
    expect((await listFeedback('p1')).map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('does not call the API when nothing is chosen', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    const api = { submit: vi.fn() };
    const result = await handleRequest(
      { type: 'submit', projectId: 'p1', ids: [] },
      makeDeps({ createApi: () => api }),
    );
    expect(result).toEqual({ ok: true, value: [] });
    expect(api.submit).not.toHaveBeenCalled();
    expect(await listDrafts('p1')).toHaveLength(1);
  });

  it('does not call the API when there is nothing to send', async () => {
    const api = { submit: vi.fn() };
    const result = await handleRequest(
      { type: 'submit', projectId: 'p1', ids: ['a'] },
      makeDeps({ createApi: () => api }),
    );
    expect(result).toEqual({ ok: true, value: [] });
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('keeps the drafts when the submit fails', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    const result = await handleRequest(
      { type: 'submit', projectId: 'p1', ids: ['a'] },
      makeDeps({ createApi: () => failingApi(new ApiError('Request failed (500)', 500)) }),
    );
    expect(result).toEqual({ ok: false, code: 'failed', error: 'Request failed (500)' });
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['a']);
  });

  it('keeps a draft that was added while the submit was in flight', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    const api: FeedbackApi = {
      submit: async (_projectId, items) => {
        await addDraft('p1', makeItem({ id: 'late' }));
        return items.map((item) => ({ ...item, author: { id: 'u', name: 'U' }, status: 'open' }));
      },
    };
    await handleRequest({ type: 'submit', projectId: 'p1', ids: ['a'] }, makeDeps({ createApi: () => api }));
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['late']);
  });

  it('keeps what was sent in the local feedback store as open', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await handleRequest({ type: 'submit', projectId: 'p1', ids: ['a'] }, makeDeps());
    expect(await listFeedback('p1')).toMatchObject([{ id: 'a', status: 'open' }]);
  });

  it('stores nothing when the submit fails', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await handleRequest(
      { type: 'submit', projectId: 'p1', ids: ['a'] },
      makeDeps({ createApi: () => failingApi(new ApiError('Request failed (500)', 500)) }),
    );
    expect(await listFeedback('p1')).toEqual([]);
  });

  it('reports unauthorized distinctly', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    const result = await handleRequest(
      { type: 'submit', projectId: 'p1', ids: ['a'] },
      makeDeps({ createApi: () => failingApi(new UnauthorizedError()) }),
    );
    expect(result).toEqual({ ok: false, code: 'unauthorized', error: 'Sign in to continue' });
  });

  it('refuses API calls when the real API is not configured', async () => {
    const createApi = vi.fn();
    const result = await handleRequest(
      { type: 'submit', projectId: 'p1', ids: ['a'] },
      makeDeps({ getSettings: async () => ({ ...DEFAULT_SETTINGS, useMock: false }), createApi }),
    );
    expect(result).toMatchObject({ ok: false, code: 'not-configured' });
    expect(createApi).not.toHaveBeenCalled();
  });

  it('reports the auth state in mock mode as signed in', async () => {
    const result = await handleRequest({ type: 'auth-state' }, makeDeps());
    expect(result).toEqual({
      ok: true,
      value: { useMock: true, configured: true, signedIn: true },
    });
  });

  it('reports the auth state for the real API', async () => {
    const result = await handleRequest(
      { type: 'auth-state' },
      makeDeps({ getSettings: async () => real, isSignedIn: async () => false }),
    );
    expect(result).toEqual({
      ok: true,
      value: { useMock: false, configured: true, signedIn: false },
    });
  });

  it('signs in with the saved settings and returns the new state', async () => {
    let signedIn = false;
    const deps = makeDeps({
      getSettings: async () => real,
      signIn: vi.fn(async () => {
        signedIn = true;
      }),
      isSignedIn: async () => signedIn,
    });
    const result = await handleRequest({ type: 'sign-in' }, deps);
    expect(deps.signIn).toHaveBeenCalledWith(real);
    expect(result).toMatchObject({ ok: true, value: { signedIn: true } });
  });

  it('reports a cancelled sign-in as a failure', async () => {
    const deps = makeDeps({
      getSettings: async () => real,
      signIn: async () => {
        throw new Error('Sign-in was cancelled');
      },
    });
    expect(await handleRequest({ type: 'sign-in' }, deps)).toEqual({
      ok: false,
      code: 'failed',
      error: 'Sign-in was cancelled',
    });
  });

  it('signs out', async () => {
    const deps = makeDeps({ getSettings: async () => real });
    const result = await handleRequest({ type: 'sign-out' }, deps);
    expect(deps.signOut).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, value: { signedIn: false } });
  });
});

describe('isBackgroundRequest', () => {
  it('accepts known request types only', () => {
    expect(isBackgroundRequest({ type: 'submit', projectId: 'p', ids: [] })).toBe(true);
    expect(isBackgroundRequest({ type: 'content-ready' })).toBe(false);
    expect(isBackgroundRequest(null)).toBe(false);
    expect(isBackgroundRequest('submit')).toBe(false);
  });
});
