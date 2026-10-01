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
  // An upload is not a call on the demo job: its refusal is shown as is and keeps the match.
  const fileId = await deps.client.uploadFeedbackFile(file);
  const run = await onDemoJob(request.url, () =>
    deps.client.createFeedbackRun(match.jobId, {
      description: feedbackMarkdown(drafts, fileName),
      fileIds: [fileId],
    }),
  );

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
