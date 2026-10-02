import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { AutoAgentClient, JobDetail, JobSummary } from './auto-agent-client';
import { cachedJob, chooseJob, forgetJob, listDemoJobs, mapLimit, suggestJob } from './job-resolver';

type FakeJob = JobSummary & { deploymentUrl: string | null };

const JOBS: Record<string, FakeJob[]> = {
  p1: [
    {
      id: 'shop',
      serviceType: 'FRONTEND_DEMO',
      status: 'SUCCESS',
      jobName: 'Shop demo',
      completedAt: '2026-09-02T00:00:00Z',
      deploymentUrl: 'https://shop.web.app',
    },
    {
      id: 'fb',
      serviceType: 'DEMO_FEEDBACK',
      status: 'SUCCESS',
      jobName: 'Shop feedback',
      completedAt: '2026-09-03T00:00:00Z',
      deploymentUrl: 'https://shop.web.app',
    },
  ],
  p2: [
    {
      id: 'app',
      serviceType: 'MOBILE_DEMO',
      status: 'SUCCESS',
      jobName: 'App demo',
      completedAt: '2026-09-01T00:00:00Z',
      deploymentUrl: 'https://app.web.app',
    },
    { id: 'nourl', serviceType: 'MOBILE_DEMO', status: 'SUCCESS', jobName: 'No URL', completedAt: null, deploymentUrl: null },
  ],
};

function makeClient(): AutoAgentClient {
  return {
    listProjects: vi.fn(async (page: number) =>
      page === 1 ? { items: [{ id: 'p1', name: 'Shop' }], total: 2 } : { items: [{ id: 'p2', name: 'App' }], total: 2 },
    ),
    listJobs: vi.fn(async (projectId: string) => {
      const items = (JOBS[projectId] ?? []).map(({ deploymentUrl: _url, ...summary }) => summary);
      return { items, total: items.length };
    }),
    getJob: vi.fn(async (id: string): Promise<JobDetail> => {
      const job = Object.values(JOBS)
        .flat()
        .find((candidate) => candidate.id === id)!;
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

  it('lists a project’s finished demos with their sites, newest first, without feedback runs', async () => {
    const jobs = await listDemoJobs(makeClient(), { id: 'p2', name: 'App' });
    expect(jobs.map((job) => [job.jobId, job.deploymentUrl])).toEqual([
      ['app', 'https://app.web.app'],
      ['nourl', null],
    ]);
    expect(jobs[0]).toMatchObject({ projectId: 'p2', projectName: 'App', jobName: 'App demo', serviceType: 'MOBILE_DEMO' });
  });

  it('suggests the demo deployed at the page’s site, scanning every page of projects', async () => {
    const client = makeClient();
    const suggestion = await suggestJob(client, 'https://app.firebaseapp.com/home');
    expect(suggestion).toMatchObject({ jobId: 'app', projectName: 'App', deploymentUrl: 'https://app.web.app' });
    expect(client.listProjects).toHaveBeenCalledTimes(2);
    // Feedback runs share the demo's URL but are never asked for.
    expect(
      vi
        .mocked(client.getJob)
        .mock.calls.map(([id]) => id)
        .sort(),
    ).toEqual(['app', 'nourl', 'shop']);
  });

  it('only suggests: the reviewer still has to choose the demo', async () => {
    await suggestJob(makeClient(), 'https://app.web.app');
    expect(await cachedJob('https://app.web.app')).toBeNull();
  });

  it('does not fetch the same job twice across scans', async () => {
    const client = makeClient();
    expect(await suggestJob(client, 'https://unknown.web.app')).toBeNull();
    vi.mocked(client.getJob).mockClear();
    expect(await suggestJob(client, 'https://still-unknown.web.app')).toBeNull();
    expect(client.getJob).not.toHaveBeenCalled();
  });

  it('still suggests when one job’s detail cannot be read', async () => {
    const client = makeClient();
    const getJob = client.getJob;
    client.getJob = vi.fn(async (id: string) => {
      if (id === 'shop') throw new Error('Auto Agent sent an unexpected response.');
      return getJob(id);
    });
    expect(await suggestJob(client, 'https://app.web.app')).toMatchObject({ jobId: 'app' });
  });

  it('keeps a chosen demo for the origin until it is forgotten', async () => {
    const chosen = {
      projectId: 'p1',
      projectName: 'Shop',
      jobId: 'shop',
      jobName: 'Shop demo',
      serviceType: 'FRONTEND_DEMO',
      completedAt: null,
      deploymentUrl: 'https://shop.web.app',
    };
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
