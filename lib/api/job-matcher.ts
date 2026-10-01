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
