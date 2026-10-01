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

function query(params: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
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
