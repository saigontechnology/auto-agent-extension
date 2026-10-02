import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { expect } from './fixtures';

// `worker.evaluate` callbacks run inside the extension's service worker, where `chrome` exists.
declare const chrome: typeof browser;

export const FIXTURE = 'http://localhost:4317/';
/** The same fixture server under a host that is not in any allow-list. */
export const OTHER_HOST = 'http://127.0.0.1:4317/';

/** The fake Auto Agent API served by e2e/serve.mjs. */
export const FAKE_API = 'http://localhost:4317/fake-auto-agent/api/v1';

/** What the fake Auto Agent has received so far. */
export async function fakeApiState(): Promise<{
  runs: Array<{ id: string; demoJobId: string; status: string; feedbackDescription: string; feedbackFiles: string[] }>;
  uploads: Array<{ id: string; name: string; body: string }>;
}> {
  return (await (await fetch(`${FAKE_API}/_state`)).json()).data;
}

/** Opens a test page plus the review panel, as its own page, bound to that page's tab. */
export async function openReview(
  context: BrowserContext,
  worker: Worker,
  extensionId: string,
  path = '',
  origin = FIXTURE,
): Promise<{ page: Page; panel: Page }> {
  const page = await context.newPage();
  await page.goto(origin + path);
  const tabId = await worker.evaluate(async (prefix) => {
    const [tab] = await chrome.tabs.query({ url: `${prefix}*` });
    return tab?.id;
  }, origin);
  expect(tabId).toBeDefined();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
  return { page, panel };
}

/** Opens the review panel bound to a blank tab, which no content script runs in. */
export async function openPanelOnBlankTab(
  context: BrowserContext,
  worker: Worker,
  extensionId: string,
): Promise<Page> {
  const known = await worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
  await context.newPage();
  const tabId = await worker.evaluate(
    async (ids) => (await chrome.tabs.query({})).map((t) => t.id).find((id) => !ids.includes(id)),
    known,
  );
  expect(tabId).toBeDefined();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
  return panel;
}

/** Waits until the panel is connected to a page that can be reviewed. */
export async function expectConnected(panel: Page): Promise<void> {
  await expect(panel.getByRole('group', { name: 'Mode' })).toBeVisible();
}

/** Checks a text change shown as struck-through old text followed by the new text. */
export async function expectTextChange(scope: Locator, before: string, after: string): Promise<void> {
  await expect(scope.locator('del')).toHaveText(before);
  await expect(scope.locator('ins')).toHaveText(after);
}

export async function setMode(panel: Page, mode: 'Off' | 'Select' | 'Text'): Promise<void> {
  await panel.getByRole('button', { name: mode, exact: true }).click();
}

/** Picks an element in Select mode and saves a comment on it. */
export async function pinComment(page: Page, selector: string, comment: string): Promise<void> {
  await page.locator(selector).click();
  await page.getByPlaceholder('Add a comment').fill(comment);
  await page.getByRole('button', { name: 'Save' }).click();
}

/** Rewrites an element's text in Text mode and confirms with Enter. */
export async function editText(page: Page, selector: string, text: string): Promise<void> {
  await page.locator(selector).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}
