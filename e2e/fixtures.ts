import { fileURLToPath } from 'node:url';
import { type BrowserContext, type Worker, test as base, chromium } from '@playwright/test';

const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

type Fixtures = { context: BrowserContext; worker: Worker; extensionId: string };

/** Launches Chromium with the built extension loaded and exposes its service worker. */
export const test = base.extend<Fixtures>({
  // Playwright requires the first argument to be a destructuring pattern, even an empty one.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // Playwright turns the back/forward cache off; real Chrome has it on.
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
