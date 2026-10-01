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
  const match = pickMatch(
    url,
    jobs.map((job) => ({ match: job, deploymentUrl: urls[job.jobId] ?? null })),
  );
  return match ? chooseJob(url, match) : null;
}
