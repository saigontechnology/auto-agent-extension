import { describe, expect, it, vi } from 'vitest';
import { makeItem, makeSent } from '../test-helpers';
import { ApiError, UnauthorizedError } from './feedback-api';
import { type HttpFeedbackApiDeps, createHttpFeedbackApi } from './http-feedback-api';

const client = { extensionVersion: '0.1.0', userAgent: 'test-agent' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function setup(responses: Array<Response | Error>, overrides: Partial<HttpFeedbackApiDeps> = {}) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  const deps: HttpFeedbackApiDeps = {
    apiBase: 'https://api.example.com/v1',
    client,
    fetch: fetchMock as unknown as typeof fetch,
    getAccessToken: vi.fn(async (options?: { forceRefresh?: boolean }) =>
      options?.forceRefresh ? 'token-2' : 'token-1',
    ),
    onUnauthorized: vi.fn(async () => undefined),
    ...overrides,
  };
  return { api: createHttpFeedbackApi(deps), fetchMock, deps };
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return init?.headers as Record<string, string>;
}

describe('HttpFeedbackApi', () => {
  it('posts items and client info with a bearer token', async () => {
    const { api, fetchMock } = setup([json([makeSent({ id: 'a' })])]);
    const sent = await api.submit('proj 1', [makeItem({ id: 'a' })]);

    expect(sent).toEqual([makeSent({ id: 'a' })]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/projects/proj%201/feedback');
    expect(init?.method).toBe('POST');
    expect(headersOf(init)).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-1',
    });
    expect(JSON.parse(init?.body as string)).toEqual({ items: [makeItem({ id: 'a' })], client });
  });

  it('lists by encoded path', async () => {
    const { api, fetchMock } = setup([json([])]);
    expect(await api.list('p1', '/#/settings?x=1')).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/projects/p1/feedback?path=%2F%23%2Fsettings%3Fx%3D1');
    expect(init?.method).toBe('GET');
    expect(headersOf(init).Authorization).toBe('Bearer token-1');
  });

  it('fails without calling the server when signed out', async () => {
    const { api, fetchMock } = setup([], { getAccessToken: vi.fn(async () => null) });
    await expect(api.list('p1', '/')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes the token once after a 401 and retries', async () => {
    const { api, fetchMock, deps } = setup([json({}, 401), json([makeSent()])]);
    expect(await api.list('p1', '/')).toEqual([makeSent()]);
    expect(deps.getAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(headersOf(fetchMock.mock.calls[1]![1]).Authorization).toBe('Bearer token-2');
    expect(deps.onUnauthorized).not.toHaveBeenCalled();
  });

  it('gives up and reports unauthorized after a second 401', async () => {
    const { api, fetchMock, deps } = setup([json({}, 401), json({}, 401)]);
    await expect(api.list('p1', '/')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('reports unauthorized when the refresh yields no token', async () => {
    const { api, fetchMock } = setup([json({}, 401)], {
      getAccessToken: vi.fn(async (options?: { forceRefresh?: boolean }) =>
        options?.forceRefresh ? null : 'token-1',
      ),
    });
    await expect(api.list('p1', '/')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports server errors with their status', async () => {
    const { api } = setup([json({ message: 'boom' }, 500)]);
    const error = await api.submit('p1', [makeItem()]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toBe('Request failed (500)');
  });

  it('reports network failures as an ApiError', async () => {
    const { api } = setup([new TypeError('Failed to fetch')]);
    await expect(api.list('p1', '/')).rejects.toThrow('Could not reach the server');
  });

  it('rejects a body that is not an array', async () => {
    const { api } = setup([json({ items: [] })]);
    await expect(api.list('p1', '/')).rejects.toThrow('unexpected response');
  });

  it('rejects a body that is not JSON', async () => {
    const { api } = setup([new Response('<html>gateway</html>', { status: 200 })]);
    await expect(api.list('p1', '/')).rejects.toThrow('unexpected response');
  });
});
