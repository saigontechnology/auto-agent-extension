import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { expect } from './fixtures';

// `worker.evaluate` callbacks run inside the extension's service worker, where `chrome` exists.
declare const chrome: typeof browser;

export const FIXTURE = 'http://localhost:4173/';

/** Opens a fixture page plus the side panel UI bound to that page's tab. */
export async function openReview(
  context: BrowserContext,
  worker: Worker,
  extensionId: string,
  path = '',
): Promise<{ page: Page; panel: Page }> {
  const page = await context.newPage();
  await page.goto(FIXTURE + path);
  const tabId = await worker.evaluate(async (origin) => {
    const [tab] = await chrome.tabs.query({ url: `${origin}*` });
    return tab?.id;
  }, FIXTURE);
  expect(tabId).toBeDefined();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
  return { page, panel };
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
