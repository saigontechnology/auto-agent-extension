import { type FeedbackApi, UnauthorizedError } from './api/feedback-api';
import { listDrafts, removeDrafts } from './draft-store';
import { saveFeedback } from './feedback-store';
import type { FlowHandlers } from './flow/flow-handlers';
import { isSendable } from './flow/flow-item';
import type { AuthState, BackgroundRequest, Result } from './messages';
import { isConfigured } from './settings-store';
import type { Settings } from './types';

export type HandlerDeps = {
  getSettings: () => Promise<Settings>;
  createApi: (settings: Settings) => FeedbackApi;
  signIn: (settings: Settings) => Promise<void>;
  signOut: () => Promise<void>;
  isSignedIn: () => Promise<boolean>;
  flow: FlowHandlers;
};

class NotConfiguredError extends Error {
  constructor() {
    super('Finish the API settings in Options first.');
  }
}

async function authState(deps: HandlerDeps): Promise<AuthState> {
  const settings = await deps.getSettings();
  return {
    useMock: settings.useMock,
    configured: isConfigured(settings),
    signedIn: settings.useMock ? true : await deps.isSignedIn(),
  };
}

async function configuredApi(deps: HandlerDeps): Promise<FeedbackApi> {
  const settings = await deps.getSettings();
  if (!isConfigured(settings)) throw new NotConfiguredError();
  return deps.createApi(settings);
}

async function dispatch(request: BackgroundRequest, deps: HandlerDeps): Promise<unknown> {
  switch (request.type) {
    case 'auth-state':
      return authState(deps);

    case 'sign-in': {
      const settings = await deps.getSettings();
      if (!isConfigured(settings)) throw new NotConfiguredError();
      if (!settings.useMock) await deps.signIn(settings);
      return authState(deps);
    }

    case 'sign-out':
      await deps.signOut();
      return authState(deps);

    case 'flow-pause':
    case 'flow-resume':
    case 'flow-stop':
    case 'flow-discard':
    case 'flow-note':
    case 'flow-save':
      return deps.flow.request(request);

    case 'submit': {
      const api = await configuredApi(deps);
      // Only the drafts the reviewer chose; an id that no longer has a draft is skipped.
      const chosen = new Set(request.ids);
      const drafts = (await listDrafts(request.projectId)).filter(
        (draft) => chosen.has(draft.id) && isSendable(draft),
      );
      if (drafts.length === 0) return [];
      const sent = await api.submit(request.projectId, drafts);
      // There is no API to read feedback back yet, so what was sent is kept in this browser.
      await saveFeedback(request.projectId, sent);
      // Remove only what was sent: a draft added while the request was in flight must survive.
      await removeDrafts(
        request.projectId,
        drafts.map((draft) => draft.id),
      );
      return sent;
    }
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
    if (error instanceof NotConfiguredError) {
      return { ok: false, code: 'not-configured', error: message };
    }
    return { ok: false, code: 'failed', error: message };
  }
}
