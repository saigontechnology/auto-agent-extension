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
    getAccessToken: vi.fn(async (options?: { forceRefresh?: boolean }) =>
      options?.forceRefresh ? 'token-2' : 'token-1',
    ),
    onUnauthorized: vi.fn(async () => undefined),
    ...overrides,
  };
}

function authorization(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
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
    const deps = makeDeps([
      envelope([{ id: 'p1', name: 'Shop', stage: 'INQUIRY' }], { total: 3, page: 1, itemPerPage: 100 }),
    ]);
    const page = await createAutoAgentClient(deps).listProjects(1);
    expect(page).toEqual({ items: [{ id: 'p1', name: 'Shop' }], total: 3 });
    const [url, init] = vi.mocked(deps.fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/projects?page=1&itemPerPage=100`);
    expect(authorization(init)).toBe('Bearer token-1');
  });

  it('lists a project’s jobs from the project itself', async () => {
    const deps = makeDeps([
      envelope({
        id: 'p 1',
        name: 'Shop',
        jobs: [
          { id: 'j1', serviceType: 'MOBILE_DEMO', status: 'SUCCESS', jobName: 'Mobile Demo #j1', completedAt: null },
          { id: 'j2', serviceType: 'FRONTEND_DEMO', status: 'FAILED', jobName: null, parentJobId: null },
        ],
      }),
    ]);
    const jobs = await createAutoAgentClient(deps).listProjectJobs('p 1');
    expect(jobs).toEqual([
      { id: 'j1', serviceType: 'MOBILE_DEMO', status: 'SUCCESS', jobName: 'Mobile Demo #j1', completedAt: null },
      { id: 'j2', serviceType: 'FRONTEND_DEMO', status: 'FAILED', jobName: 'j2', completedAt: null },
    ]);
    expect(vi.mocked(deps.fetch).mock.calls[0]![0]).toBe(`${BASE}/projects/p%201`);
  });

  it('treats a project without jobs as having none', async () => {
    const jobs = await createAutoAgentClient(makeDeps([envelope({ id: 'p1', name: 'Shop' })])).listProjectJobs('p1');
    expect(jobs).toEqual([]);
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
    const id = await createAutoAgentClient(deps).uploadFeedbackFile(
      new File(['{}'], 'a.json', { type: 'application/json' }),
    );
    expect(id).toBe('file-1');
    const [url, init] = vi.mocked(deps.fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/files/upload?serviceType=DEMO_FEEDBACK`);
    expect(init!.method).toBe('POST');
    expect((init!.body as FormData).get('files')).toBeInstanceOf(File);
  });

  it('creates a feedback run and reads requiresApproval', async () => {
    const deps = makeDeps([envelope({ id: 'run-2', status: 'PENDING', requiresApproval: true })]);
    const run = await createAutoAgentClient(deps).createFeedbackRun('job-1', { fileIds: ['file-1'] });
    expect(run).toEqual({ id: 'run-2', status: 'PENDING', requiresApproval: true });
    const [url, init] = vi.mocked(deps.fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/jobs/job-1/feedback`);
    expect(JSON.parse(init!.body as string)).toEqual({ fileIds: ['file-1'] });
  });

  it('retries once with a refreshed token after a 401', async () => {
    const deps = makeDeps([envelope(null, null, 401, 'Authentication required'), envelope(DETAIL)]);
    await createAutoAgentClient(deps).getJob('job-1');
    const tokens = vi.mocked(deps.fetch).mock.calls.map(([, init]) => authorization(init));
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
    await expect(
      createAutoAgentClient(deps).createFeedbackRun('job-1', { fileIds: [] }),
    ).rejects.toMatchObject({ message: 'Feedback updates require a successfully completed job', status: 400 });
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
    await expect(
      createAutoAgentClient(makeDeps([envelope([{ name: 'no id' }])])).listProjects(1),
    ).rejects.toThrow(UNEXPECTED_RESPONSE);
    await expect(createAutoAgentClient(makeDeps([envelope({ id: 'job-1' })])).getJob('job-1')).rejects.toThrow(
      UNEXPECTED_RESPONSE,
    );
  });
});
