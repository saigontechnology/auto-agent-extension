import { browser, defineBackground } from '#imports';
import { createHttpFeedbackApi } from '@/lib/api/http-feedback-api';
import { createMockFeedbackApi } from '@/lib/api/mock-feedback-api';
import { type OAuthDeps, getAccessToken, isSignedIn, signIn, signOut } from '@/lib/auth/oauth';
import { type HandlerDeps, handleRequest } from '@/lib/background-handlers';
import { clientInfo } from '@/lib/client-info';
import { isBackgroundRequest } from '@/lib/messages';
import { LOCAL_ONLY } from '@/lib/config';
import { DEFAULT_SETTINGS, getSettings } from '@/lib/settings-store';
import type { Settings } from '@/lib/types';

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

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
  };

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isBackgroundRequest(message)) return;
    handleRequest(message, deps).then(sendResponse);
    return true;
  });
});
