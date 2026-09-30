import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendToBackground } from '@/lib/background-client';
import { removeDraft, updateDraft } from '@/lib/draft-store';
import { groupDrafts, locationLabel, pagePins } from '@/lib/pins';
import type { Mode } from '@/lib/types';
import { DraftRow } from './DraftRow';
import { useAuth, useDrafts, usePanelConnection, useSent, useTargetTab } from './hooks';

const MODES: Array<{ mode: Mode; label: string }> = [
  { mode: 'off', label: 'Off' },
  { mode: 'select', label: 'Select' },
  { mode: 'text', label: 'Text' },
];

export function App() {
  const tabId = useTargetTab();
  const { context, mode, unresolved, send, setMode } = usePanelConnection(tabId);
  const drafts = useDrafts(context?.projectId);
  const auth = useAuth();
  const authKey = auth.state
    ? `${auth.state.useMock}:${auth.state.configured}:${auth.state.signedIn}`
    : 'loading';
  const { sent, error: sentError, reload } = useSent(context, send, authKey);

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

  const header = (
    <header className="header">
      <div>
        <h1>Vibe Feedback</h1>
        {context && (
          <p className="muted">
            {context.projectId} · {context.buildId}
          </p>
        )}
      </div>
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
    </header>
  );

  if (!context) {
    return (
      <div className="panel">
        {header}
        <p className="notice">
          This page is not a preview build. Open a preview deployed by the tool to leave feedback.
        </p>
      </div>
    );
  }

  const { projectId } = context;
  const groups = groupDrafts(drafts, context.path);
  const canSend = auth.state !== null && auth.state.configured && auth.state.signedIn;

  const submit = async () => {
    setSending(true);
    setSendError(null);
    const result = await sendToBackground({ type: 'submit', projectId });
    setSending(false);
    if (result.ok) reload();
    else setSendError(result.error);
  };

  const addPageComment = () => {
    const comment = pageComment?.trim();
    if (!comment) return;
    send({ type: 'create-page-comment', comment });
    setPageComment(null);
  };

  return (
    <div className="panel">
      {header}
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
          <h2>Drafts ({drafts.length})</h2>
          {drafts.length === 0 && <p className="muted">Pick Select or Text, then click the page.</p>}
          {groups.map((group) => (
            <div key={group.path}>
              <h3>{group.path}</h3>
              <ul>
                {group.items.map((item) => (
                  <DraftRow
                    key={item.id}
                    item={item}
                    number={numbers.get(item.id)}
                    missing={missing.has(item.id)}
                    onFocus={
                      numbers.has(item.id)
                        ? () => send({ type: 'focus-item', id: item.id })
                        : undefined
                    }
                    onSave={(comment) => void updateDraft(projectId, item.id, { comment })}
                    onDelete={() => void removeDraft(projectId, item.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section aria-label="Sent">
          <h2>Sent on this page ({sent.length})</h2>
          {sentError && (
            <p className="error">
              {sentError}{' '}
              <button type="button" className="link" onClick={reload}>
                Retry
              </button>
            </p>
          )}
          <ul>
            {sent.map((item) => (
              <li key={item.id} className={`row row--${item.status}`}>
                <button
                  type="button"
                  className="row__main"
                  disabled={!numbers.has(item.id)}
                  onClick={() => send({ type: 'focus-item', id: item.id })}
                >
                  <span className="badge badge--sent">{numbers.get(item.id) ?? '•'}</span>
                  <span className="row__body">
                    <span className="row__meta">
                      {item.author.name} · {item.status} · {locationLabel(item)}
                    </span>
                    {item.textEdit && (
                      <span className="row__edit">
                        “{item.textEdit.before}” → “{item.textEdit.after}”
                      </span>
                    )}
                    {item.comment && <span className="row__comment">{item.comment}</span>}
                    {missing.has(item.id) && (
                      <span className="row__warning">element not found</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>

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
        <button
          type="button"
          className="primary footer__send"
          disabled={!canSend || sending || drafts.length === 0}
          onClick={() => void submit()}
        >
          {sending ? 'Sending…' : `Send ${drafts.length}`}
        </button>
      </footer>
    </div>
  );
}
