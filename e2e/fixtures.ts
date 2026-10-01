import { fileURLToPath } from 'node:url';
import { type BrowserContext, type Worker, test as base, chromium } from '@playwright/test';
import type { browser } from 'wxt/browser';

// `worker.evaluate` callbacks run inside the extension's service worker, where `chrome` exists.
declare const chrome: typeof browser;

const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3-e2e', import.meta.url));
const FAKE_API = 'http://localhost:4173/fake-auto-agent/api/v1';

type Fixtures = { context: BrowserContext; worker: Worker; extensionId: string; signedIn: boolean };

function fakeJwt(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u-test', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
}

/** Launches Chromium with the e2e build loaded, signed in to the fake Auto Agent unless a test opts out. */
export const test = base.extend<Fixtures>({
  signedIn: [true, { option: true }],
  // Playwright requires the first argument to be a destructuring pattern, even an empty one.
  context: async ({}, use) => {
    await fetch(`${FAKE_API}/_reset`, { method: 'POST' });
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // Playwright turns the back/forward cache off; real Chrome has it on.
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context, signedIn }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    if (signedIn) {
      await worker.evaluate(
        async (session) => {
          await chrome.storage.local.set({ session });
        },
        {
          accessToken: fakeJwt(),
          refreshToken: 'refresh-test',
          expiresAt: Date.now() + 3_600_000,
          user: {
            id: 'u-test',
            username: 'tester',
            displayName: 'Test Reviewer',
            role: 'DEVELOPER',
            allowedServices: ['DEMO_FEEDBACK'],
          },
        },
      );
    }
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
