import { browser, defineBackground, storage } from '#imports';
import { createAutoAgentClient } from '@/lib/api/auto-agent-client';
import { type SessionDeps, getAccessToken, getSession, signIn, signOut } from '@/lib/auth/session';
import { type HandlerDeps, handleRequest } from '@/lib/background-handlers';
import { clientInfo } from '@/lib/client-info';
import { API_BASE } from '@/lib/config';
import { createFlowHandlers } from '@/lib/flow/flow-handlers';
import {
  type FlowStatus,
  type PingReply,
  type SetPanel,
  isBackgroundRequest,
  isFlowContentMessage,
  isPanelState,
  isPing,
} from '@/lib/messages';

export default defineBackground(() => {
  // The review panel floats over the page instead of docking beside it, so the page keeps its
  // full width. The toolbar icon opens and closes it; which tabs have it open is kept here so
  // it comes back after a reload or a navigation.
  const openPanels = storage.defineItem<number[]>('session:open-panels', { fallback: [] });

  // Serialised so a click and a message arriving together cannot overwrite each other.
  let panelQueue: Promise<unknown> = Promise.resolve();
  const setPanelOpen = (tabId: number, open: boolean): Promise<void> => {
    const run = panelQueue.then(async () => {
      const tabs = (await openPanels.getValue()).filter((id) => id !== tabId);
      await openPanels.setValue(open ? [...tabs, tabId] : tabs);
    });
    panelQueue = run.catch(() => undefined);
    return run;
  };

  const flow = createFlowHandlers({
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    notify: (tabId, state) => {
      const message: FlowStatus = { type: 'flow-status', state };
      // The tab may be between documents; its next content script asks for the state itself.
      browser.tabs.sendMessage(tabId, message).catch(() => undefined);
    },
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void setPanelOpen(tabId, false);
    void flow.tabRemoved(tabId);
  });
  browser.tabs.onCreated.addListener((tab) => void flow.tabCreated(tab));
  // Host permissions reveal http and https URLs, which is all a new tab's step needs.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) void flow.tabUpdated(tabId, changeInfo.url);
  });

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id === undefined) return;
    const open = !(await openPanels.getValue()).includes(tab.id);
    await setPanelOpen(tab.id, open);
    const message: SetPanel = { type: 'set-panel', open };
    try {
      await browser.tabs.sendMessage(tab.id, message);
      return;
    } catch {
      // No content script yet: the tab was open before the extension was installed or reloaded.
    }
    try {
      // The injected script reads the open state itself when it starts.
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['/content-scripts/content.js'],
      });
    } catch {
      // Pages such as chrome:// and the Web Store do not allow extensions to run.
      await setPanelOpen(tab.id, false);
      await browser.action.setBadgeText({ tabId: tab.id, text: '!' });
      await browser.action.setTitle({ tabId: tab.id, title: 'Auto Agent cannot run on this page' });
    }
  });

  // Sign-in runs here, not in the panel: the Microsoft window takes focus, which would close a
  // popup and lose the pending result.
  const sessionDeps: SessionDeps = {
    apiBase: API_BASE,
    redirectUri: browser.identity.getRedirectURL('auth'),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    newState: () => crypto.randomUUID(),
    launchWebAuthFlow: ({ url, interactive }) =>
      browser.identity.launchWebAuthFlow({
        url,
        interactive,
        // The silent attempt lets Microsoft redirect on its own when the browser is already
        // signed in to the company account.
        abortOnLoadForNonInteractive: false,
        timeoutMsForNonInteractive: 15_000,
      }),
  };

  const deps: HandlerDeps = {
    client: createAutoAgentClient({
      apiBase: API_BASE,
      fetch: (input, init) => fetch(input, init),
      getAccessToken: (options) => getAccessToken(sessionDeps, options),
      onUnauthorized: signOut,
    }),
    signIn: () => signIn(sessionDeps),
    signOut,
    getSession,
    clientInfo,
    now: () => new Date(),
    flow,
  };

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isPanelState(message)) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      const update = message.open === undefined ? Promise.resolve() : setPanelOpen(tabId, message.open);
      update
        .then(() => openPanels.getValue())
        .then((tabs) => sendResponse(tabs.includes(tabId)));
      return true;
    }
    if (isFlowContentMessage(message)) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      flow.content(message, tabId).then(sendResponse);
      return true;
    }
    if (!isBackgroundRequest(message)) return;
    handleRequest(message, deps).then(sendResponse);
    return true;
  });

  // Auto Agent's download page asks which version is installed, to offer an update.
  browser.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
    if (!isPing(message)) return;
    const reply: PingReply = { installed: true, version: browser.runtime.getManifest().version };
    sendResponse(reply);
  });
});
