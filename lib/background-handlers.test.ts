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
  deploymentUrl: 'https://shop.web.app',
};

function makeClient(overrides: Partial<AutoAgentClient> = {}): AutoAgentClient {
  return {
    listProjects: vi.fn(async () => ({ items: [], total: 0 })),
    listProjectJobs: vi.fn(async () => []),
    getJob: vi.fn(async (id: string) => ({
      id,
      serviceType: 'FRONTEND_DEMO',
      status: 'SUCCESS',
      jobName: 'Demo',
      completedAt: null,
      deploymentUrl: 'https://shop.web.app',
      feedbackHistory: [
        {
          id: 'run-0',
          status: 'SUCCESS',
          createdAt: '2026-09-30T00:00:00Z',
          completedAt: null,
          feedbackDescription: null,
          feedbackFiles: [],
          createdBy: 'bob',
        },
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

function submit(ids: string[]) {
  return { type: 'submit' as const, projectId: 'p1', url: PAGE, ids };
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
    expect(isBackgroundRequest({ type: 'suggest-job', url: PAGE })).toBe(true);
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
    expect(await handleRequest({ type: 'auth-state' }, signedOut)).toEqual({
      ok: true,
      value: { signedIn: false, user: null },
    });
  });

  it('passes a sign-in error through as its message', async () => {
    const deps = makeDeps({
      signIn: vi.fn(async () => {
        throw new Error('Sign-in was cancelled.');
      }),
    });
    expect(await handleRequest({ type: 'sign-in' }, deps)).toEqual({
      ok: false,
      code: 'failed',
      error: 'Sign-in was cancelled.',
    });
  });

  it('refuses to send before a demo is chosen for the page', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    const deps = makeDeps();
    const result = await handleRequest(submit(['a']), deps);
    expect(result).toMatchObject({ ok: false, code: 'not-configured' });
    expect(deps.client.uploadFeedbackFile).not.toHaveBeenCalled();
    expect(await listDrafts('p1')).toHaveLength(1);
  });

  it('uploads the chosen drafts as JSON, starts a run from that file alone, and keeps the rest', async () => {
    await chooseJob(PAGE, MATCH);
    await addDraft('p1', makeItem({ id: 'a', comment: 'First' }));
    await addDraft('p1', makeItem({ id: 'b' }));
    await addDraft('p1', makeFlowItem({ id: 'c' }));
    const deps = makeDeps();

    const result = await handleRequest(submit(['a', 'c', 'gone']), deps);

    expect(result).toMatchObject({ ok: true, value: [{ id: 'a' }, { id: 'c' }] });
    const upload = vi.mocked(deps.client.uploadFeedbackFile);
    const create = vi.mocked(deps.client.createFeedbackRun);
    const file = upload.mock.calls[0]![0];
    expect(file.name).toBe('auto-agent-feedback-p1-2026-10-01T04-27-46-111Z.json');
    expect(file.type).toBe('application/json');
    expect(JSON.parse(await file.text()).items.map((item: { id: string }) => item.id)).toEqual(['a', 'c']);
    expect(create).toHaveBeenCalledWith('job-1', { fileIds: ['file-1'] });
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
    const result = await handleRequest(submit(['a']), makeDeps({ client }));
    expect(result).toEqual({
      ok: false,
      code: 'failed',
      error: 'Feedback updates require a successfully completed job',
    });
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
    const result = await handleRequest(submit(['a']), makeDeps({ client }));
    expect(result).toEqual({ ok: false, code: 'forbidden', error: 'You no longer have access to this demo.' });
    expect(await cachedJob(PAGE)).toBeNull();
    expect(await listDrafts('p1')).toHaveLength(1);
  });

  it('shows an upload refusal as it is, and keeps the demo', async () => {
    await chooseJob(PAGE, MATCH);
    await addDraft('p1', makeItem({ id: 'a' }));
    const client = makeClient({
      uploadFeedbackFile: vi.fn(async () => {
        throw new ApiError('You are not allowed to upload feedback files', 403);
      }),
    });
    const result = await handleRequest(submit(['a']), makeDeps({ client }));
    expect(result).toEqual({ ok: false, code: 'failed', error: 'You are not allowed to upload feedback files' });
    expect(await cachedJob(PAGE)).toEqual(MATCH);
  });

  it('reports an ended session as unauthorized', async () => {
    await chooseJob(PAGE, MATCH);
    await addDraft('p1', makeItem({ id: 'a' }));
    const client = makeClient({
      uploadFeedbackFile: vi.fn(async () => {
        throw new UnauthorizedError();
      }),
    });
    const result = await handleRequest(submit(['a']), makeDeps({ client }));
    expect(result).toEqual({ ok: false, code: 'unauthorized', error: 'Your session ended. Sign in again.' });
  });

  it('sends nothing when no chosen draft is left', async () => {
    await chooseJob(PAGE, MATCH);
    await addDraft('p1', makeItem({ id: 'a' }));
    const deps = makeDeps();
    expect(await handleRequest(submit([]), deps)).toEqual({ ok: true, value: [] });
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
    expect(await handleRequest({ type: 'current-job', url: PAGE }, makeDeps())).toEqual({ ok: true, value: null });
    expect(await handleRequest({ type: 'choose-job', url: PAGE, match: MATCH }, makeDeps())).toEqual({
      ok: true,
      value: MATCH,
    });
    expect(await handleRequest({ type: 'current-job', url: 'https://shop.web.app/other' }, makeDeps())).toEqual({
      ok: true,
      value: MATCH,
    });
  });

  it('suggests the demo at the page’s site without choosing it', async () => {
    const client = makeClient({
      listProjects: vi.fn(async () => ({ items: [{ id: 'p1', name: 'Shop' }], total: 1 })),
      listProjectJobs: vi.fn(async () => [
        { id: 'job-1', serviceType: 'FRONTEND_DEMO', status: 'SUCCESS', jobName: 'Frontend Demo #job-1', completedAt: null },
      ]),
    });
    const result = await handleRequest({ type: 'suggest-job', url: PAGE }, makeDeps({ client }));
    expect(result).toMatchObject({ ok: true, value: { jobId: 'job-1', deploymentUrl: 'https://shop.web.app' } });
    expect(await cachedJob(PAGE)).toBeNull();
  });
});
