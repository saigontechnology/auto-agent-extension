import { storage } from '#imports';
import type { AutoAgentClient, ListPage, Project } from './auto-agent-client';
import { type JobMatch, isDemoJob, newestFirst, normalizeOrigin, pickMatch } from './job-matcher';

/** How many requests a scan sends at once. */
const CONCURRENCY = 4;

/** The demo the reviewer chose for each site, by normalised origin. */
const matchesItem = storage.defineItem<Record<string, JobMatch>>('local:job-matches', { fallback: {} });

/**
 * Deployment URLs already read, by job id. A successful job's URL does not change, so a later
 * scan only asks about jobs it has not seen.
 */
const urlsItem = storage.defineItem<Record<string, string | null>>('local:job-urls', { fallback: {} });

type DemoSummary = Omit<JobMatch, 'deploymentUrl'>;

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

async function demoSummaries(client: AutoAgentClient, project: Project): Promise<DemoSummary[]> {
  const jobs = await client.listProjectJobs(project.id);
  return jobs.filter(isDemoJob).map((job) => ({
    projectId: project.id,
    projectName: project.name,
    jobId: job.id,
    jobName: job.jobName,
    serviceType: job.serviceType,
    completedAt: job.completedAt,
  }));
}

/**
 * The job list has no deployment URL, so each new job's detail is read once. A job whose detail
 * cannot be read counts as having no URL for now and is asked about again next time, so one bad
 * job does not hide the others.
 */
async function withUrls(client: AutoAgentClient, demos: DemoSummary[]): Promise<JobMatch[]> {
  const known = await urlsItem.getValue();
  const missing = demos.filter((demo) => !(demo.jobId in known));
  const fetched = await mapLimit(missing, CONCURRENCY, async (demo) => {
    try {
      return (await client.getJob(demo.jobId)).deploymentUrl;
    } catch {
      return undefined;
    }
  });
  const update = Object.fromEntries(
    missing.flatMap((demo, index) => (fetched[index] === undefined ? [] : [[demo.jobId, fetched[index]]])),
  );
  if (Object.keys(update).length > 0) await urlsItem.setValue({ ...(await urlsItem.getValue()), ...update });
  const urls: Record<string, string | null> = { ...known, ...update };
  return demos.map((demo) => ({ ...demo, deploymentUrl: urls[demo.jobId] ?? null }));
}

/** A project's demos that can take feedback, newest first, with where each is deployed. */
export async function listDemoJobs(client: AutoAgentClient, project: Project): Promise<JobMatch[]> {
  return (await withUrls(client, await demoSummaries(client, project))).sort(newestFirst);
}

/** The demo the reviewer chose for the page's site, or null. */
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
 * The newest of the reviewer's demos deployed at the page's site, or null. Only a suggestion:
 * nothing is sent to it until the reviewer chooses it.
 */
export async function suggestJob(client: AutoAgentClient, url: string): Promise<JobMatch | null> {
  if (!normalizeOrigin(url)) return null;
  const projects = await listProjects(client);
  // Every project's jobs are listed first, so all detail requests share one limit.
  const summaries = (await mapLimit(projects, CONCURRENCY, (project) => demoSummaries(client, project))).flat();
  return pickMatch(url, await withUrls(client, summaries));
}
