import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Browser, browser } from 'wxt/browser';
import type { FeedbackRun } from '@/lib/api/auto-agent-client';
import type { JobMatch } from '@/lib/api/job-matcher';
import { watchSession } from '@/lib/auth/session';
import { sendToBackground } from '@/lib/background-client';
import { listDrafts, watchDrafts } from '@/lib/draft-store';
import { listFeedback, watchFeedback } from '@/lib/feedback-store';
import {
  type AuthState,
  type ContentToPanel,
  PANEL_PORT,
  type PanelToContent,
  isContentReady,
} from '@/lib/messages';
import { hasUnfinishedRuns } from '@/lib/sent-groups';
import type { FeedbackItem, Mode, PageContext, SentFeedback } from '@/lib/types';

/**
 * The tab this panel reviews: the tab whose page embeds it. A `?tabId=` query parameter pins
 * it to one tab, which lets the panel run as a normal page in end-to-end tests; opened on its
 * own, it follows the active tab of its window.
 */
export function useTargetTab(): number | null {
  const fixed = useMemo(() => {
    const value = new URLSearchParams(location.search).get('tabId');
    return value ? Number(value) : null;
  }, []);
  const [tabId, setTabId] = useState<number | null>(fixed);

  useEffect(() => {
    if (fixed !== null) return;
    // Embedded in a page, the panel belongs to the tab that hosts it.
    if (window.top !== window) {
      void browser.tabs.getCurrent().then((tab) => setTabId(tab?.id ?? null));
      return;
    }
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
  missingAnchors: string[];
  send: (message: PanelToContent) => void;
  setMode: (mode: Mode) => void;
};

/** Keeps a port open to the tab's content script and reconnects when the page reloads. */
export function usePanelConnection(tabId: number | null): PanelConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [context, setContext] = useState<PageContext | null>(null);
  const [mode, setModeState] = useState<Mode>('off');
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [missingAnchors, setMissingAnchors] = useState<string[]>([]);
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
      } else if (message.type === 'anchor-missing') {
        setMissingAnchors((current) => (current.includes(message.key) ? current : [...current, message.key]));
      }
    });

    const reset = () => {
      if (portRef.current === port) portRef.current = null;
      setContext(null);
      setUnresolved([]);
      setMissingAnchors([]);
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

  return { status, context, mode, unresolved, missingAnchors, send, setMode };
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
  busy: boolean;
  signIn: () => void;
  signOut: () => void;
};

export function useAuth(): Auth {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedIn = useRef(false);
  // Set while the reviewer signs out, so that is not reported as an ended session.
  const leaving = useRef(false);

  const apply = useCallback((next: AuthState) => {
    if (signedIn.current && !next.signedIn && !leaving.current) {
      setError('Your session ended. Sign in again.');
    } else if (next.signedIn) {
      setError(null);
    }
    signedIn.current = next.signedIn;
    leaving.current = false;
    setState(next);
  }, []);

  const refresh = useCallback(() => {
    void sendToBackground({ type: 'auth-state' }).then((result) => {
      if (result.ok) apply(result.value);
      else setError(result.error);
    });
  }, [apply]);

  // The session also changes outside this panel: a failed refresh, or Options.
  useEffect(() => {
    refresh();
    return watchSession(refresh);
  }, [refresh]);

  const signIn = () => {
    setBusy(true);
    setError(null);
    void sendToBackground({ type: 'sign-in' }).then((result) => {
      setBusy(false);
      if (result.ok) apply(result.value);
      else setError(result.error);
    });
  };

  const signOut = () => {
    leaving.current = true;
    setBusy(true);
    void sendToBackground({ type: 'sign-out' }).then((result) => {
      setBusy(false);
      if (result.ok) apply(result.value);
      else setError(result.error);
    });
  };

  return { state, error, busy, signIn, signOut };
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

export type JobState =
  | { status: 'idle' }
  | { status: 'resolving' }
  | { status: 'matched'; match: JobMatch }
  /** The picker is open; `previous` is the demo to go back to on Cancel. */
  | { status: 'choosing'; previous: JobMatch | null; error: string | null };

export type JobMatching = {
  state: JobState;
  choose: (match: JobMatch) => void;
  change: () => void;
  cancel: () => void;
  retry: () => void;
};

/** Which demo job the page belongs to: found by its site, or chosen by the reviewer. */
export function useJobMatch(url: string | undefined, enabled: boolean): JobMatching {
  const [state, setState] = useState<JobState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef(url);
  urlRef.current = url;
  // Every page of a demo belongs to the same job, so a route change must not look it up again.
  const origin = useMemo(() => {
    try {
      return url ? new URL(url).origin : null;
    } catch {
      return null;
    }
  }, [url]);

  useEffect(() => {
    const pageUrl = urlRef.current;
    if (!enabled || !origin || !pageUrl) {
      setState({ status: 'idle' });
      return;
    }
    let active = true;
    setState({ status: 'resolving' });
    void sendToBackground({ type: 'resolve-job', url: pageUrl }).then((result) => {
      if (!active) return;
      if (result.ok && result.value) setState({ status: 'matched', match: result.value });
      else setState({ status: 'choosing', previous: null, error: result.ok ? null : result.error });
    });
    return () => {
      active = false;
    };
  }, [origin, enabled, attempt]);

  const choose = (match: JobMatch) => {
    const pageUrl = urlRef.current;
    if (!pageUrl) return;
    void sendToBackground({ type: 'choose-job', url: pageUrl, match }).then((result) => {
      if (result.ok) setState({ status: 'matched', match: result.value });
      else setState({ status: 'choosing', previous: null, error: result.error });
    });
  };

  return {
    state,
    choose,
    change: () =>
      setState((current) => ({
        status: 'choosing',
        previous: current.status === 'matched' ? current.match : null,
        error: null,
      })),
    cancel: () =>
      setState((current) =>
        current.status === 'choosing' && current.previous ? { status: 'matched', match: current.previous } : current,
      ),
    retry: () => setAttempt((n) => n + 1),
  };
}

const RUN_POLL_MS = 10_000;

/**
 * The feedback runs on the page's demo, asked for again every 10 seconds while one is
 * unfinished and the panel is visible.
 */
export function useRuns(
  url: string | undefined,
  demoJobId: string | null,
  sent: SentFeedback[],
  onForbidden: () => void,
): { runs: FeedbackRun[]; error: string | null; reload: () => void } {
  const [runs, setRuns] = useState<FeedbackRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const urlRef = useRef(url);
  urlRef.current = url;
  const forbiddenRef = useRef(onForbidden);
  forbiddenRef.current = onForbidden;

  useEffect(() => {
    setRuns([]);
    setError(null);
  }, [demoJobId]);

  useEffect(() => {
    const pageUrl = urlRef.current;
    if (!demoJobId || !pageUrl) return;
    let active = true;
    void sendToBackground({ type: 'job-runs', url: pageUrl }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setRuns(result.value);
        setError(null);
      } else {
        setError(result.error);
        if (result.code === 'forbidden') forbiddenRef.current();
      }
    });
    return () => {
      active = false;
    };
  }, [demoJobId, tick]);

  const waiting = useMemo(
    () => demoJobId !== null && hasUnfinishedRuns(sent, runs, demoJobId),
    [sent, runs, demoJobId],
  );

  useEffect(() => {
    if (!waiting) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = setTimeout(() => setTick((n) => n + 1), RUN_POLL_MS);
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [waiting, tick]);

  return { runs, error, reload: () => setTick((n) => n + 1) };
}
