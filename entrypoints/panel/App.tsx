import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { flowEditsOf, flowPatch, isSendable } from '@/lib/flow/flow-item';
import { stepAnchor } from '@/lib/flow/step-label';
import { MAX_STEPS } from '@/lib/flow/steps';
import { feedbackFileName, feedbackPayload } from '@/lib/api/feedback-payload';
import { sendToBackground } from '@/lib/background-client';
import { clientInfo } from '@/lib/client-info';
import { WORKFLOW_RECORDING } from '@/lib/config';
import { removeDraft, updateDraft } from '@/lib/draft-store';
import { setFeedbackStatus } from '@/lib/feedback-store';
import type { FlowRequest } from '@/lib/messages';
import { groupDrafts, pagePins } from '@/lib/pins';
import { groupSent } from '@/lib/sent-groups';
import type { FeedbackItem, FlowStep, Mode } from '@/lib/types';
import { Checkbox } from './Checkbox';
import { DraftRow } from './DraftRow';
import { FlowReview } from './FlowReview';
import { DemoChooser } from './DemoChooser';
import { RecordingBar } from './RecordingBar';
import { RunGroup } from './RunGroup';
import { useGoTo, useRecording } from './flow-hooks';
import { SentRow } from './SentRow';
import { SignIn } from './SignIn';
import {
  type ConnectionStatus,
  useAuth,
  useDrafts,
  useJobMatch,
  usePanelConnection,
  useRuns,
  useSent,
  useTargetTab,
} from './hooks';

/** True when the panel runs inside the floating window the content script puts on the page. */
const EMBEDDED = window.top !== window;

const MODES: Array<{ mode: Mode; label: string }> = [
  { mode: 'off', label: 'Off' },
  { mode: 'select', label: 'Select' },
  { mode: 'text', label: 'Text' },
];

const NOTICES: Record<ConnectionStatus, string> = {
  connecting: 'Connecting to this page…',
  connected:
    'This page is not a preview build. Open a preview deployed by the tool to leave feedback.',
  unreachable:
    'Auto Agent is not running on this page. If this is a preview build, reload the page.',
};

/** Saves `data` as a pretty-printed JSON file through the browser's download flow. */
function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function App() {
  const tabId = useTargetTab();
  const { status, context, mode, unresolved, missingAnchors, send, setMode } = usePanelConnection(tabId);
  const drafts = useDrafts(context?.projectId);
  const auth = useAuth();
  const sent = useSent(context, send);
  const jobs = useJobMatch(context?.url, auth.state ? auth.state.signedIn : null);
  const match = jobs.state.status === 'matched' ? jobs.state.match : null;
  const runs = useRuns(context?.url, match?.jobId ?? null, sent, jobs.forbid);
  const sentGroups = useMemo(() => groupSent(sent, runs.runs), [sent, runs.runs]);
  const recording = useRecording(tabId);
  const recordingActive = recording?.status === 'recording' || recording?.status === 'paused';
  const [flowError, setFlowError] = useState<string | null>(null);
  // Set while a flow request is on its way, so a save or discard cannot be sent twice.
  const [flowPending, setFlowPending] = useState(false);
  const flowRequest = (request: FlowRequest) => {
    setFlowError(null);
    setFlowPending(true);
    void sendToBackground(request).then((result) => {
      setFlowPending(false);
      if (!result.ok) setFlowError(result.error);
    });
  };

  const [editingFlow, setEditingFlow] = useState<FeedbackItem | null>(null);
  const missingSteps = useMemo(() => new Set(missingAnchors), [missingAnchors]);
  const goTo = useGoTo(tabId, context, send);
  // Only steps on the open page can be pointed at; anything else clears the highlight.
  const hoverStep = (step: FlowStep | null) => {
    const anchor = step && step.path === context?.path ? stepAnchor(step) : undefined;
    send({ type: 'show-anchor', key: step?.id ?? '', anchor: anchor ?? null, scroll: false });
  };

  const review =
    recording?.status === 'stopped' ? (
      <FlowReview
        key={recording.startedAt}
        heading="Review workflow"
        initial={{ title: '', expected: '', actual: '', steps: recording.steps }}
        notice={recording.limitReached ? `Reached the ${MAX_STEPS}-step limit, so recording stopped.` : undefined}
        cancelLabel="Discard"
        confirmCancel
        busy={flowPending}
        missing={missingSteps}
        onHoverStep={hoverStep}
        onSave={(edits) => flowRequest({ type: 'flow-save', tabId: recording.tabId, edits })}
        onCancel={() => flowRequest({ type: 'flow-discard', tabId: recording.tabId })}
      />
    ) : null;

  // Notes are pinned to the open page, or, away from the project, to where the recording was last.
  const recordingBar =
    recordingActive && recording ? (
      <RecordingBar
        recording={recording}
        onPause={() => flowRequest({ type: 'flow-pause', tabId: recording.tabId })}
        onResume={() => flowRequest({ type: 'flow-resume', tabId: recording.tabId })}
        onStop={() => flowRequest({ type: 'flow-stop', tabId: recording.tabId })}
        onNote={(text) =>
          flowRequest({
            type: 'flow-note',
            tabId: recording.tabId,
            text,
            path: context?.path ?? recording.steps.at(-1)?.path ?? recording.startPage.path,
          })
        }
      />
    ) : null;

  // Every draft goes into the next Send unless the reviewer unticks it, so only the drafts
  // left out are remembered and a new draft starts ticked.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const projectKey = context?.projectId;
  useEffect(() => setExcluded(new Set()), [projectKey]);
  // A workflow without a title is never part of a Send, whatever its box says.
  const sendable = useMemo(() => drafts.filter(isSendable), [drafts]);
  const chosen = useMemo(() => sendable.filter((draft) => !excluded.has(draft.id)), [sendable, excluded]);

  const include = (id: string, included: boolean) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (included) next.delete(id);
      else next.add(id);
      return next;
    });
  const includeAll = (included: boolean) =>
    setExcluded(included ? new Set() : new Set(drafts.map((draft) => draft.id)));

  const [pageComment, setPageComment] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // A run starts on Auto Agent right away and redeploys the demo, so it is confirmed first.
  const [confirming, setConfirming] = useState(false);
  // Two clicks in one frame both see `sending` false; the ref stops the second from starting a run.
  const sendingRef = useRef(false);

  const numbers = useMemo(() => {
    const pins = context ? pagePins(drafts, sent, context.path) : [];
    return new Map(pins.map((pin) => [pin.id, pin.number]));
  }, [context, drafts, sent]);
  const missing = useMemo(() => new Set(unresolved), [unresolved]);

  // Right after choosing a mode the keyboard focus is still in this panel, not in the page,
  // so the picker's keys are handled here and forwarded.
  useEffect(() => {
    if (mode === 'off') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('textarea, input')) return;
      if (event.key === 'Escape') {
        setMode('off');
      } else if (mode === 'select' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        send({ type: 'key', key: event.key });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, send, setMode]);

  const user = auth.state?.user;
  const accountActions = user && (
    <div className="header__actions">
      <span className="header__user" title={user.username}>
        {user.displayName}
      </span>
      <button type="button" onClick={auth.signOut} disabled={auth.busy}>
        Sign out
      </button>
    </div>
  );

  // Inside the floating window the page draws the title bar, so only the account actions remain.
  const header = EMBEDDED ? (
    accountActions && <header className="header header--embedded">{accountActions}</header>
  ) : (
    <header className="header">
      <div className="header__brand">
        <BrandMark className="header__mark" />
        <h1>Auto Agent</h1>
        {accountActions}
      </div>
    </header>
  );

  if (!auth.state || !auth.state.signedIn) {
    return (
      <div className="panel">
        {header}
        <div className="panel__body">
          {auth.state ? (
            <SignIn busy={auth.busy} error={auth.error} onSignIn={auth.signIn} />
          ) : (
            auth.error && <p className="error">{auth.error}</p>
          )}
        </div>
      </div>
    );
  }

  if (review) {
    return (
      <div className="panel">
        {header}
        <div className="panel__body">
          {flowError && <p className="error">{flowError}</p>}
          {review}
        </div>
      </div>
    );
  }

  // A recording paused outside the project must still be reachable, or it could never be stopped.
  if (!context && recordingBar) {
    return (
      <div className="panel">
        {header}
        <div className="panel__body">
          {flowError && <p className="error">{flowError}</p>}
          {recordingBar}
        </div>
      </div>
    );
  }

  if (!context) {
    return (
      <div className="panel">
        {header}
        <div className="panel__body">
          <p className="notice">{NOTICES[status]}</p>
        </div>
      </div>
    );
  }

  // Right after signing in, and on a site with no chosen demo, the list comes first.
  if (jobs.state.status === 'choosing') {
    const { previous, error } = jobs.state;
    return (
      <div className="panel">
        {header}
        <div className="panel__body">
          <DemoChooser
            key={context.url}
            url={context.url}
            previous={previous}
            error={error}
            onChoose={jobs.choose}
            onCancel={previous ? jobs.cancel : undefined}
          />
        </div>
      </div>
    );
  }

  const { projectId } = context;

  if (editingFlow) {
    return (
      <div className="panel">
        {header}
        <div className="panel__body">
          <FlowReview
            key={editingFlow.id}
            heading="Edit workflow"
            initial={flowEditsOf(editingFlow)}
            cancelLabel="Cancel"
            confirmCancel={false}
            missing={missingSteps}
            onHoverStep={hoverStep}
            onSave={(edits) => {
              void updateDraft(projectId, editingFlow.id, flowPatch(editingFlow, edits));
              setEditingFlow(null);
            }}
            onCancel={() => setEditingFlow(null)}
          />
        </div>
      </div>
    );
  }
  const groups = groupDrafts(drafts, context.path);
  const canSend = match !== null;

  const submit = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    const result = await sendToBackground({
      type: 'submit',
      projectId,
      url: context.url,
      ids: chosen.map((draft) => draft.id),
    });
    sendingRef.current = false;
    setSending(false);
    if (result.ok) {
      runs.reload();
    } else {
      setSendError(result.error);
      if (result.code === 'forbidden') jobs.forbid(result.error);
    }
  };

  // The same file Send uploads, for a reviewer who wants to keep or inspect it.
  const exportDrafts = () => {
    downloadJson(feedbackFileName(projectId, new Date()), feedbackPayload(chosen, clientInfo()));
  };

  let demo: ReactNode = null;
  if (jobs.state.status === 'loading') {
    demo = <p className="demo muted">Loading your demo…</p>;
  } else if (jobs.state.status === 'matched') {
    demo = (
      <div className="demo">
        <span className="demo__label">Demo</span>
        <span className="demo__name">
          {jobs.state.match.projectName} · {jobs.state.match.jobName}
        </span>
        <button type="button" className="link" onClick={jobs.change}>
          Change
        </button>
      </div>
    );
  }

  const addPageComment = () => {
    const comment = pageComment?.trim();
    if (!comment) return;
    send({ type: 'create-page-comment', comment });
    setPageComment(null);
  };

  const startRecording = () => {
    setMode('off');
    send({ type: 'start-recording' });
  };

  const draftCount = `${chosen.length} ${chosen.length === 1 ? 'draft' : 'drafts'}`;
  const sendLabel = chosen.length === 0 ? 'Run update' : `Run update (${draftCount})`;
  const canSubmit = canSend && !sending && chosen.length > 0;

  return (
    <div className="panel">
      {header}
      <div className="panel__body">
        {auth.error && <p className="error">{auth.error}</p>}
        {demo}

        {flowError && <p className="error">{flowError}</p>}

        {recordingBar ?? (
          <>
            <div className="toolbar">
              <div className="segmented" role="group" aria-label="Mode">
                {MODES.map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    aria-pressed={mode === option.mode}
                    onClick={() => setMode(option.mode)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="toolbar__actions">
                <button type="button" onClick={() => setPageComment('')}>
                  Add page comment
                </button>
                {WORKFLOW_RECORDING && (
                  <button type="button" onClick={startRecording}>
                    Record workflow
                  </button>
                )}
              </div>
            </div>

            {pageComment !== null && (
              <form
                className="page-comment"
                onSubmit={(event) => {
                  event.preventDefault();
                  addPageComment();
                }}
              >
                <textarea
                  autoFocus
                  placeholder="Comment about this page as a whole"
                  value={pageComment}
                  onChange={(event) => setPageComment(event.target.value)}
                />
                <div className="row__actions">
                  <button type="button" onClick={() => setPageComment(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="primary" disabled={pageComment.trim() === ''}>
                    Add
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        <main className="lists">
          <section aria-label="Drafts">
            <div className="list-heading">
              {drafts.length > 0 && (
                <Checkbox
                  checked={sendable.length > 0 && chosen.length === sendable.length}
                  mixed={chosen.length > 0 && chosen.length < sendable.length}
                  disabled={sendable.length === 0}
                  label="Include all drafts in send"
                  onChange={includeAll}
                />
              )}
              <h2>Drafts ({drafts.length})</h2>
            </div>
            {drafts.length === 0 && (
              <p className="empty">
                No drafts yet. Choose Select or Text above, then click something on the page
                {WORKFLOW_RECORDING ? ', or record a workflow.' : '.'}
              </p>
            )}
            <ul>
              {groups.flatMap((group) =>
                group.items.map((item) => (
                  <DraftRow
                    key={item.id}
                    item={item}
                    number={numbers.get(item.id)}
                    missing={missing.has(item.id)}
                    included={!excluded.has(item.id)}
                    onInclude={(included) => include(item.id, included)}
                    onFocus={
                      numbers.has(item.id)
                        ? () => send({ type: 'focus-item', id: item.id })
                        : undefined
                    }
                    onEditFlow={item.kind === 'flow' ? () => setEditingFlow(item) : undefined}
                    onSave={(comment) => void updateDraft(projectId, item.id, { comment })}
                    onDelete={() => void removeDraft(projectId, item.id)}
                  />
                )),
              )}
            </ul>
          </section>

          <section aria-label="Sent">
            <h2>Sent</h2>
            {runs.error && <p className="error">{runs.error}</p>}
            {sentGroups.length === 0 && <p className="empty">Nothing has been sent to this demo yet.</p>}
            <ul className="runs">
              {sentGroups.map((group) => (
                <RunGroup key={group.key} group={group}>
                  {group.items.map((item) => (
                    <SentRow
                      key={item.id}
                      item={item}
                      number={numbers.get(item.id)}
                      missing={missing.has(item.id)}
                      missingSteps={missingSteps}
                      onGoTo={(step) => goTo(item, step)}
                      onFocus={numbers.has(item.id) ? () => send({ type: 'focus-item', id: item.id }) : undefined}
                      onResolve={() => void setFeedbackStatus(projectId, item.id, 'resolved')}
                      onReopen={() => void setFeedbackStatus(projectId, item.id, 'open')}
                    />
                  ))}
                </RunGroup>
              ))}
            </ul>
          </section>
        </main>
      </div>

      <footer className="footer">
        {sendError && (
          <p className="error">
            {sendError}{' '}
            <button type="button" className="link" onClick={() => void submit()}>
              Retry
            </button>
          </p>
        )}
        {!canSend && <p className="muted">Choose the demo this page belongs to before running an update.</p>}
        {confirming && match ? (
          <div className="footer__confirm" role="alertdialog" aria-label="Confirm update">
            <p>
              Run an update of <strong>{match.jobName}</strong> with {draftCount}? Auto Agent starts it right away
              and redeploys the demo.
            </p>
            <div className="footer__buttons">
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary footer__send"
                autoFocus
                disabled={!canSubmit}
                onClick={() => {
                  setConfirming(false);
                  void submit();
                }}
              >
                Run update
              </button>
            </div>
          </div>
        ) : (
          <div className="footer__buttons">
            <button type="button" disabled={chosen.length === 0} onClick={exportDrafts}>
              Export JSON
            </button>
            <button
              type="button"
              className="primary footer__send"
              disabled={!canSubmit}
              onClick={() => setConfirming(true)}
            >
              {sending ? 'Starting update…' : sendLabel}
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
