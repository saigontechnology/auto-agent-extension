// Opens a Chromium window with the built extension already loaded and the sample preview
// open, for trying the extension by hand. Uses the mock API, so no backend is needed.
// The browser profile lives in .demo-profile, so drafts and sent feedback survive restarts.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const extensionPath = `${root}.output/chrome-mv3`;
const fixtureUrl = 'http://localhost:4173/';

if (!existsSync(`${extensionPath}/manifest.json`)) {
  console.error('No build found. Run `pnpm build` first.');
  process.exit(1);
}

// Reuse a fixture server that is already running; otherwise start one for this session.
const fixtureUp = await fetch(fixtureUrl).then(
  (response) => response.ok,
  () => false,
);
const server = fixtureUp
  ? null
  : spawn(process.execPath, [`${root}fixtures/serve.mjs`], { stdio: 'inherit' });

const context = await chromium.launchPersistentContext(`${root}.demo-profile`, {
  channel: 'chromium',
  headless: false,
  viewport: null,
  ignoreDefaultArgs: ['--disable-back-forward-cache'],
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
console.log(`Extension loaded: ${new URL(worker.url()).host}`);

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(fixtureUrl);
console.log('Open the Extensions menu (puzzle icon) and click Auto Agent to open the side panel.');
console.log('Close the browser window to stop.');

context.on('close', () => {
  server?.kill();
  process.exit(0);
});
