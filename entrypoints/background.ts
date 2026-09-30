import { browser, defineBackground } from '#imports';
import { createHttpFeedbackApi } from '@/lib/api/http-feedback-api';
import { createMockFeedbackApi } from '@/lib/api/mock-feedback-api';
import { type OAuthDeps, getAccessToken, isSignedIn, signIn, signOut } from '@/lib/auth/oauth';
import { type HandlerDeps, handleRequest } from '@/lib/background-handlers';
import { isBackgroundRequest } from '@/lib/messages';
import { getSettings } from '@/lib/settings-store';
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
    getSettings,
    createApi: (settings) =>
      settings.useMock
        ? createMockFeedbackApi()
        : createHttpFeedbackApi({
            apiBase: settings.apiBase,
            client: {
              extensionVersion: browser.runtime.getManifest().version,
              userAgent: navigator.userAgent,
            },
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
