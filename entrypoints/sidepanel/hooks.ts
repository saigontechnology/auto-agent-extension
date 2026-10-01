import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Browser, browser } from 'wxt/browser';
import { watchTokens } from '@/lib/auth/oauth';
import { sendToBackground } from '@/lib/background-client';
import { listDrafts, watchDrafts } from '@/lib/draft-store';
import { listFeedback, watchFeedback } from '@/lib/feedback-store';
import {
  type AuthState,
  type ContentToPanel,
  PANEL_PORT,
  type PanelToContent,
  type Result,
  isContentReady,
} from '@/lib/messages';
import { watchSettings } from '@/lib/settings-store';
import type { FeedbackItem, Mode, PageContext, SentFeedback } from '@/lib/types';

/**
 * The tab this panel reviews: the active tab of its window. A `?tabId=` query parameter
 * pins it to one tab, which lets the panel run as a normal page in end-to-end tests.
 */
export function useTargetTab(): number | null {
  const fixed = useMemo(() => {
    const value = new URLSearchParams(location.search).get('tabId');
    return value ? Number(value) : null;
  }, []);
  const [tabId, setTabId] = useState<number | null>(fixed);

  useEffect(() => {
    if (fixed !== null) return;
    const refresh = async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      setTabId(tab?.id ?? null);
    };
    void refresh();
    browser.tabs.onActivated.addListener(refresh);
    return () => browser.tabs.onActivated.removeListener(refresh);
  }, [fixed]);

  return tabId;
}

/**
 * `unreachable` means no content script answered: the page is outside the extension's hosts,
 * or it was opened before the extension was installed or updated and needs a reload.
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'unreachable';

/** How long a reloading page may take to reconnect before it is reported as unreachable. */
const RECONNECT_GRACE_MS = 1500;

export type PanelConnection = {
  status: ConnectionStatus;
  context: PageContext | null;
  mode: Mode;
  unresolved: string[];
  send: (message: PanelToContent) => void;
  setMode: (mode: Mode) => void;
};

/** Keeps a port open to the tab's content script and reconnects when the page reloads. */
export function usePanelConnection(tabId: number | null): PanelConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [context, setContext] = useState<PageContext | null>(null);
  const [mode, setModeState] = useState<Mode>('off');
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const portRef = useRef<Browser.runtime.Port | null>(null);
  const modeRef = useRef<Mode>('off');

  const send = useCallback((message: PanelToContent) => {
    try {
      portRef.current?.postMessage(message);
    } catch {
      // The page went away; onDisconnect resets the state.
    }
  }, []);

  const setMode = useCallback(
    (next: Mode) => {
      modeRef.current = next;
      setModeState(next);
      send({ type: 'set-mode', mode: next });
    },
    [send],
  );

  // A different tab starts with picking off.
  useEffect(() => {
    modeRef.current = 'off';
    setModeState('off');
  }, [tabId]);

  useEffect(() => {
    if (tabId === null) return;
    const port = browser.tabs.connect(tabId, { name: PANEL_PORT });
    portRef.current = port;
    let answered = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    port.onMessage.addListener((raw) => {
      const message = raw as ContentToPanel;
      if (message.type === 'context') {
        answered = true;
        setStatus('connected');
        setContext(message.context);
        // The panel owns the mode: re-apply it after a reload or route change.
        if (message.context && modeRef.current !== 'off') {
          port.postMessage({ type: 'set-mode', mode: modeRef.current } satisfies PanelToContent);
        }
      } else if (message.type === 'mode') {
        modeRef.current = message.mode;
        setModeState(message.mode);
      } else if (message.type === 'unresolved') {
        setUnresolved(message.ids);
      }
    });

    const reset = () => {
      if (portRef.current === port) portRef.current = null;
      setContext(null);
      setUnresolved([]);
    };
    port.onDisconnect.addListener(() => {
      // Reading lastError marks "no content script on this page" as handled.
      void browser.runtime.lastError;
      reset();
      if (answered) {
        // The page is reloading or navigating; give its new content script time to announce itself.
        setStatus('connecting');
        graceTimer = setTimeout(() => setStatus('unreachable'), RECONNECT_GRACE_MS);
      } else {
        setStatus('unreachable');
      }
    });

    const onReady = (message: unknown, sender: Browser.runtime.MessageSender) => {
      if (isContentReady(message) && sender.tab?.id === tabId) setAttempt((n) => n + 1);
    };
    browser.runtime.onMessage.addListener(onReady);

    return () => {
      browser.runtime.onMessage.removeListener(onReady);
      clearTimeout(graceTimer);
      port.disconnect();
      reset();
    };
  }, [tabId, attempt]);

  return { status, context, mode, unresolved, send, setMode };
}

export function useDrafts(projectId: string | undefined): FeedbackItem[] {
  const [drafts, setDrafts] = useState<FeedbackItem[]>([]);

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

  return drafts;
}

export type Auth = {
  state: AuthState | null;
  error: string | null;
  signIn: () => void;
  signOut: () => void;
};

export function useAuth(): Auth {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((result: Result<AuthState>) => {
    if (result.ok) {
      setState(result.value);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  const refresh = useCallback(() => {
    void sendToBackground({ type: 'auth-state' }).then(apply);
  }, [apply]);

  // Tokens also change outside this panel, for example when the API rejects them.
  useEffect(() => {
    refresh();
    const unwatchSettings = watchSettings(refresh);
    const unwatchTokens = watchTokens(refresh);
    return () => {
      unwatchSettings();
      unwatchTokens();
    };
  }, [refresh]);

  return {
    state,
    error,
    signIn: () => void sendToBackground({ type: 'sign-in' }).then(apply),
    signOut: () => void sendToBackground({ type: 'sign-out' }).then(apply),
  };
}

/** Watches the feedback sent from the open page and mirrors it to the page for pins. */
export function useSent(
  context: PageContext | null,
  send: (message: PanelToContent) => void,
): SentFeedback[] {
  const [all, setAll] = useState<SentFeedback[]>([]);
  const projectId = context?.projectId;
  const path = context?.path;

  useEffect(() => {
    if (!projectId) {
      setAll([]);
      return;
    }
    let active = true;
    void listFeedback(projectId).then((items) => {
      if (active) setAll(items);
    });
    const unwatch = watchFeedback(projectId, setAll);
    return () => {
      active = false;
      unwatch();
    };
  }, [projectId]);

  const sent = useMemo(() => all.filter((item) => item.page.path === path), [all, path]);

  // `context` is a new object after every reconnect, so a reloaded page gets the list again.
  useEffect(() => {
    if (context) send({ type: 'set-sent', items: sent });
  }, [context, sent, send]);

  return sent;
}
