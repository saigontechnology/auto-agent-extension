import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { BrandMark } from '@/components/BrandMark';
import { feedbackPayload } from '@/lib/api/feedback-payload';
import { sendToBackground } from '@/lib/background-client';
import { clientInfo } from '@/lib/client-info';
import { LOCAL_ONLY } from '@/lib/config';
import { removeDraft, updateDraft } from '@/lib/draft-store';
import { setFeedbackStatus } from '@/lib/feedback-store';
import { groupDrafts, pagePins } from '@/lib/pins';
import type { Mode } from '@/lib/types';
import { Checkbox } from './Checkbox';
import { DraftRow } from './DraftRow';
import { SentRow } from './SentRow';
import {
  type ConnectionStatus,
  useAuth,
  useDrafts,
  usePanelConnection,
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
  const { status, context, mode, unresolved, send, setMode } = usePanelConnection(tabId);
  const drafts = useDrafts(context?.projectId);
  const auth = useAuth();
  const sent = useSent(context, send);

  // Every draft goes into the next Send unless the reviewer unticks it, so only the drafts
  // left out are remembered and a new draft starts ticked.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const projectKey = context?.projectId;
  useEffect(() => setExcluded(new Set()), [projectKey]);
  const chosen = useMemo(() => drafts.filter((draft) => !excluded.has(draft.id)), [drafts, excluded]);

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

  const openOptions = () => void browser.runtime.openOptionsPage();

  const accountActions = !LOCAL_ONLY && (
    <div className="header__actions">
      {auth.state && !auth.state.useMock && auth.state.configured && (
        <button type="button" onClick={auth.state.signedIn ? auth.signOut : auth.signIn}>
          {auth.state.signedIn ? 'Sign out' : 'Sign in'}
        </button>
      )}
      {auth.state?.useMock && <span className="tag">Mock</span>}
      <button type="button" onClick={openOptions}>
        Options
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

  const { projectId } = context;
  const groups = groupDrafts(drafts, context.path);
  const canSend = auth.state !== null && auth.state.configured && auth.state.signedIn;

  const submit = async () => {
    setSending(true);
    setSendError(null);
    const result = await sendToBackground({
      type: 'submit',
      projectId,
      ids: chosen.map((draft) => draft.id),
    });
    setSending(false);
    if (!result.ok) setSendError(result.error);
  };

  // Lets the tool be tried before the API exists: the file holds the exact body Send will POST.
  const exportDrafts = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = projectId.replace(/[^\w.-]+/g, '-');
    downloadJson(`auto-agent-feedback-${name}-${stamp}.json`, feedbackPayload(chosen, clientInfo()));
  };

  const addPageComment = () => {
    const comment = pageComment?.trim();
    if (!comment) return;
    send({ type: 'create-page-comment', comment });
    setPageComment(null);
  };

  const sendLabel =
    chosen.length === 0
      ? 'Send drafts'
      : `Send ${chosen.length} ${chosen.length === 1 ? 'draft' : 'drafts'}`;

  return (
    <div className="panel">
      {header}
      <div className="panel__body">
        {auth.error && <p className="error">{auth.error}</p>}
        {auth.state && !auth.state.configured && (
          <p className="notice">
            The API is not set up yet.{' '}
            <button type="button" className="link" onClick={openOptions}>
              Open Options
            </button>
          </p>
        )}

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
          <button type="button" onClick={() => setPageComment('')}>
            Add page comment
          </button>
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

        <main className="lists">
          <section aria-label="Drafts">
            <div className="list-heading">
              {drafts.length > 0 && (
                <Checkbox
                  checked={chosen.length === drafts.length}
                  mixed={chosen.length > 0 && chosen.length < drafts.length}
                  label="Include all drafts in send"
                  onChange={includeAll}
                />
              )}
              <h2>Drafts ({drafts.length})</h2>
            </div>
            {drafts.length === 0 && (
              <p className="empty">
                No drafts yet. Choose Select or Text above, then click something on the page.
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
                    onSave={(comment) => void updateDraft(projectId, item.id, { comment })}
                    onDelete={() => void removeDraft(projectId, item.id)}
                  />
                )),
              )}
            </ul>
          </section>

          <section aria-label="Sent">
            <h2>Sent on this page ({sent.length})</h2>
            {sent.length === 0 && (
              <p className="empty">Nothing has been sent from this page yet.</p>
            )}
            <ul>
              {sent.map((item) => (
                <SentRow
                  key={item.id}
                  item={item}
                  number={numbers.get(item.id)}
                  missing={missing.has(item.id)}
                  onFocus={
                    numbers.has(item.id)
                      ? () => send({ type: 'focus-item', id: item.id })
                      : undefined
                  }
                  onResolve={() => void setFeedbackStatus(projectId, item.id, 'resolved')}
                  onReopen={() => void setFeedbackStatus(projectId, item.id, 'open')}
                />
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
        {auth.state && auth.state.configured && !auth.state.signedIn && (
          <p className="muted">Sign in to send your drafts.</p>
        )}
        <div className="footer__buttons">
          <button type="button" disabled={chosen.length === 0} onClick={exportDrafts}>
            Export JSON
          </button>
          <button
            type="button"
            className="primary footer__send"
            disabled={!canSend || sending || chosen.length === 0}
            onClick={() => void submit()}
          >
            {sending ? 'Sending…' : sendLabel}
          </button>
        </div>
      </footer>
    </div>
  );
}
