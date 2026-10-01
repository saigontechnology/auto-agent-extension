import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentScriptContext } from '#imports';
import { resolveAnchor } from '@/lib/anchor-resolver';
import { REQUIRE_PREVIEW_MARKERS } from '@/lib/config';
import { addDraft, listDrafts, removeDraft, updateDraft, watchDrafts } from '@/lib/draft-store';
import { describeElement } from '@/lib/element-descriptor';
import { createItem, currentEnv } from '@/lib/feedback-factory';
import { type PanelState, isSetPanel } from '@/lib/messages';
import { readPageContext } from '@/lib/page-context';
import { type Pin, pagePins } from '@/lib/pins';
import { findTextEditDraft, planTextEdit } from '@/lib/text-edit';
import type { Anchor, FeedbackItem, Mode, PageContext, SentFeedback } from '@/lib/types';
import { browser } from 'wxt/browser';
import { CommentPopover } from './CommentPopover';
import { HighlightBox } from './HighlightBox';
import { PanelFrame } from './PanelFrame';
import { Picker, type RemoteKey } from './Picker';
import { type PinFocus, PinLayer } from './PinLayer';
import { type ShownAnchor, StepHighlight } from './StepHighlight';
import { TextEditor, type TextEditResult } from './TextEditor';
import { RecordingBadge } from './RecordingBadge';
import { useFlowRecorder } from './use-flow-recorder';
import { usePanelPort } from './use-panel-port';

type Composer =
  | { type: 'new'; element: Element; anchor: Anchor }
  | { type: 'edit'; element: Element; item: FeedbackItem };

type Props = { ctx: ContentScriptContext; host: HTMLElement };

/** Apps often set the title after the route changes, so read it when the item is created. */
function withLiveTitle(context: PageContext): PageContext {
  return { ...context, title: document.title };
}

export function App({ ctx, host }: Props) {
  const [context, setContext] = useState<PageContext | null>(() =>
    readPageContext(document, location, { requireMarkers: REQUIRE_PREVIEW_MARKERS }),
  );
  const [mode, setMode] = useState<Mode>('off');
  const [drafts, setDrafts] = useState<FeedbackItem[]>([]);
  const [sent, setSent] = useState<SentFeedback[]>([]);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [focus, setFocus] = useState<PinFocus | null>(null);
  const [shown, setShown] = useState<ShownAnchor | null>(null);
  const [remoteKey, setRemoteKey] = useState<RemoteKey | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const contextRef = useRef(context);
  contextRef.current = context;
  const recorder = useFlowRecorder(ctx, host);
  const recordingActive = recorder.state.status === 'recording' || recorder.state.status === 'paused';
  const recordingRef = useRef(recordingActive);
  recordingRef.current = recordingActive;

  const { connected, post } = usePanelPort((message) => {
    const current = contextRef.current;
    switch (message.type) {
      case 'set-mode':
        setComposer(null);
        // Picking swallows the page's clicks, so it stays off until the recording stops.
        if (recordingRef.current && message.mode !== 'off') {
          setMode('off');
          post({ type: 'mode', mode: 'off' });
        } else {
          setMode(current ? message.mode : 'off');
        }
        break;
      case 'key':
        setRemoteKey({ key: message.key, at: Date.now() });
        break;
      case 'set-sent':
        setSent(message.items);
        break;
      case 'focus-item':
        setFocus({ id: message.id, at: Date.now() });
        break;
      case 'start-recording':
        if (current) {
          // Picking swallows the page's clicks, so a recording always runs with picking off.
          setComposer(null);
          setMode('off');
          recorder.start(withLiveTitle(current));
        }
        break;
      case 'show-anchor':
        setShown(
          message.anchor
            ? { key: message.key, anchor: message.anchor, scroll: message.scroll, at: Date.now() }
            : null,
        );
        break;
      case 'create-page-comment':
        if (current) {
          const item = createItem(
            { kind: 'page', comment: message.comment, context: withLiveTitle(current) },
            currentEnv(window),
          );
          void addDraft(current.projectId, item);
        }
        break;
    }
  });

  // The background knows whether this tab had the panel open before a reload or navigation,
  // and tells the page when the toolbar icon opens or closes it.
  useEffect(() => {
    const ask: PanelState = { type: 'panel-state' };
    browser.runtime
      .sendMessage(ask)
      .then((open: unknown) => setPanelOpen(open === true))
      .catch(() => undefined);
    const onMessage = (message: unknown) => {
      if (isSetPanel(message)) setPanelOpen(message.open);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  const closePanel = () => {
    setPanelOpen(false);
    const close: PanelState = { type: 'panel-state', open: false };
    browser.runtime.sendMessage(close).catch(() => undefined);
  };

  // SPA route changes do not reload the content script, so re-read the context. The event
  // fires before the new URL is committed, so `location` is read on the next task, not now.
  useEffect(() => {
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      ctx.setTimeout(() => {
        setComposer(null);
        setContext(readPageContext(document, location, { requireMarkers: REQUIRE_PREVIEW_MARKERS }));
      }, 0);
    });
  }, [ctx]);

  const projectId = context?.projectId;
  useEffect(() => {
    if (!projectId) {
      setDrafts([]);
      return;
    }
    let active = true;
    void listDrafts(projectId).then((items) => {
      if (active) setDrafts(items);
    });
    const unwatch = watchDrafts(projectId, setDrafts);
    return () => {
      active = false;
      unwatch();
    };
  }, [projectId]);

  useEffect(() => {
    if (connected) post({ type: 'context', context });
  }, [connected, context, post]);

  useEffect(() => {
    if (connected) return;
    setMode('off');
    setComposer(null);
    setSent([]);
    setShown(null);
  }, [connected]);

  useEffect(() => {
    if (!focus) return;
    const timer = setTimeout(() => setFocus(null), 1500);
    return () => clearTimeout(timer);
  }, [focus]);

  const pins = useMemo(
    () => (context ? pagePins(drafts, sent, context.path) : []),
    [context, drafts, sent],
  );

  const panel = panelOpen && <PanelFrame drafts={drafts.length} recording={recordingActive} onClose={closePanel} />;

  // The badge must stay outside `panel`: in a fragment with PanelFrame the panel iframe reloaded repeatedly.
  if (!connected || !context) {
    return (
      <div className="vf-root">
        <RecordingBadge state={recorder.state} />
        {panel}
      </div>
    );
  }

  const exitMode = () => {
    setMode('off');
    post({ type: 'mode', mode: 'off' });
  };

  const openPin = (pin: Pin, element: Element) => {
    if (pin.state === 'draft') setComposer({ type: 'edit', element, item: pin.item });
  };

  const saveComposer = (comment: string) => {
    if (!composer) return;
    if (composer.type === 'new') {
      const item = createItem(
        { kind: 'element', comment, context: withLiveTitle(context), anchor: composer.anchor },
        currentEnv(window),
      );
      void addDraft(context.projectId, item);
    } else {
      void updateDraft(context.projectId, composer.item.id, { comment: comment.trim() });
    }
    setComposer(null);
  };

  const deleteComposer = () => {
    if (composer?.type === 'edit') void removeDraft(context.projectId, composer.item.id);
    setComposer(null);
  };

  const handleEdited = ({ element, anchor, before, after }: TextEditResult) => {
    const existing = findTextEditDraft(
      drafts,
      context.path,
      (draftAnchor) => resolveAnchor(draftAnchor, document) === element,
    );
    const change = planTextEdit(existing, before, after);
    if (!change) return;
    if (change.type === 'remove') {
      void removeDraft(context.projectId, change.id);
    } else if (change.type === 'update' && existing) {
      void updateDraft(context.projectId, change.id, { textEdit: change.textEdit });
      setComposer({ type: 'edit', element, item: { ...existing, textEdit: change.textEdit } });
    } else if (change.type === 'create') {
      const item = createItem(
        {
          kind: 'text-edit',
          comment: '',
          context: withLiveTitle(context),
          anchor,
          textEdit: change.textEdit,
        },
        currentEnv(window),
      );
      void addDraft(context.projectId, item);
      setComposer({ type: 'edit', element, item });
    }
  };

  const editedItem = composer?.type === 'edit' ? composer.item : null;
  const textEdit = editedItem?.textEdit;

  return (
    <div className="vf-root">
      <RecordingBadge state={recorder.state} />
      {panel}
      <PinLayer
        pins={pins}
        focus={focus}
        onUnresolved={(ids) => post({ type: 'unresolved', ids })}
        onOpen={openPin}
      />
      {shown && (
        <StepHighlight
          key={shown.at}
          shown={shown}
          onMissing={(key) => post({ type: 'anchor-missing', key })}
          onDone={() => setShown(null)}
        />
      )}
      {!composer && mode === 'select' && (
        <Picker
          host={host}
          remoteKey={remoteKey}
          onPick={(element) =>
            setComposer({ type: 'new', element, anchor: describeElement(element) })
          }
          onExit={exitMode}
        />
      )}
      {!composer && mode === 'text' && (
        <TextEditor host={host} onEdited={handleEdited} onExit={exitMode} />
      )}
      {composer && (
        <>
          <HighlightBox element={composer.element} tone="selected" />
          <CommentPopover
            key={editedItem?.id ?? 'new'}
            anchorRect={composer.element.getBoundingClientRect()}
            title={textEdit ? 'Text change' : editedItem ? 'Edit comment' : 'New comment'}
            textEdit={textEdit}
            initial={editedItem?.comment ?? ''}
            allowEmpty={editedItem?.kind === 'text-edit'}
            onSave={saveComposer}
            onCancel={() => setComposer(null)}
            onDelete={editedItem ? deleteComposer : undefined}
          />
        </>
      )}
    </div>
  );
}
