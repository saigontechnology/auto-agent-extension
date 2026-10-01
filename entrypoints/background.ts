import { browser, defineBackground, storage } from '#imports';
import { createHttpFeedbackApi } from '@/lib/api/http-feedback-api';
import { createMockFeedbackApi } from '@/lib/api/mock-feedback-api';
import { type OAuthDeps, getAccessToken, isSignedIn, signIn, signOut } from '@/lib/auth/oauth';
import { type HandlerDeps, handleRequest } from '@/lib/background-handlers';
import { clientInfo } from '@/lib/client-info';
import { createFlowHandlers } from '@/lib/flow/flow-handlers';
import {
  type FlowStatus,
  type SetPanel,
  isBackgroundRequest,
  isFlowContentMessage,
  isPanelState,
} from '@/lib/messages';
import { LOCAL_ONLY } from '@/lib/config';
import { DEFAULT_SETTINGS, getSettings } from '@/lib/settings-store';
import type { Settings } from '@/lib/types';

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

  const oauthDeps = (settings: Settings): OAuthDeps => ({
    settings: settings.oauth,
    redirectUri: browser.identity.getRedirectURL(),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    launchWebAuthFlow: (url) => browser.identity.launchWebAuthFlow({ url, interactive: true }),
  });

  const deps: HandlerDeps = {
    // While feedback is local only, saved API settings are ignored and the mock API is used.
    getSettings: LOCAL_ONLY ? async () => DEFAULT_SETTINGS : getSettings,
    createApi: (settings) =>
      settings.useMock
        ? createMockFeedbackApi()
        : createHttpFeedbackApi({
            apiBase: settings.apiBase,
            client: clientInfo(),
            fetch: (input, init) => fetch(input, init),
            getAccessToken: (options) => getAccessToken(oauthDeps(settings), options),
            onUnauthorized: signOut,
          }),
    signIn: (settings) => signIn(oauthDeps(settings)),
    signOut,
    isSignedIn,
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
});
