import type { Page, Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { expect, test } from './fixtures';
import { FIXTURE, pinComment } from './helpers';

// `worker.evaluate` callbacks run inside the extension's service worker, where `chrome` exists.
declare const chrome: typeof browser;

async function tabIdOf(worker: Worker, url: string): Promise<number> {
  const id = await worker.evaluate(async (prefix) => {
    const [tab] = await chrome.tabs.query({ url: `${prefix}*` });
    return tab?.id;
  }, url);
  expect(id).toBeDefined();
  return id!;
}

/** What the toolbar icon does: Playwright cannot click the browser's own toolbar. */
async function setPanel(worker: Worker, tabId: number, open: boolean): Promise<void> {
  await worker.evaluate(
    async ([id, value]) => {
      await chrome.storage.session.set({ 'open-panels': value ? [id] : [] });
      await chrome.tabs.sendMessage(id as number, { type: 'set-panel', open: value });
    },
    [tabId, open] as const,
  );
}

function panelOf(page: Page) {
  return page.frameLocator('iframe[title="Auto Agent panel"]');
}

test('the panel floats over the page and drives the review from there', async ({
  context,
  worker,
}) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const widthBefore = await page.evaluate(() => document.documentElement.clientWidth);
  const tabId = await tabIdOf(worker, FIXTURE);

  await setPanel(worker, tabId, true);
  const panel = panelOf(page);
  await expect(panel.getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();
  // Floating, not docked: the page keeps its full width.
  expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(widthBefore);

  await panel.getByRole('button', { name: 'Select', exact: true }).click();
  await pinComment(page, '#buy', 'Make this button bigger');
  await expect(panel.getByText('Make this button bigger')).toBeVisible();
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveText('1');

  // Folded, the window keeps the review going and shows how many drafts wait.
  await page.getByRole('button', { name: 'Minimize' }).click();
  await expect(page.locator('iframe[title="Auto Agent panel"]')).toBeHidden();
  await expect(page.getByLabel('1 draft')).toBeVisible();
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveText('1');
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect(panel.getByText('Make this button bigger')).toBeVisible();

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('region', { name: 'Auto Agent' })).toHaveCount(0);
  await expect(page.locator('[data-vf-pin]')).toHaveCount(0);
  const open = await worker.evaluate(async () => (await chrome.storage.session.get('open-panels'))['open-panels']);
  expect(open).toEqual([]);
});

test('an open panel comes back after a reload', async ({ context, worker }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const tabId = await tabIdOf(worker, FIXTURE);
  await setPanel(worker, tabId, true);
  await expect(panelOf(page).getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();

  await page.reload();
  await expect(panelOf(page).getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();
});

test('the title bar moves the window and keeps it on screen', async ({ context, worker }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  await setPanel(worker, await tabIdOf(worker, FIXTURE), true);
  const window = page.getByRole('region', { name: 'Auto Agent' });
  await expect(panelOf(page).getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();

  const title = page.locator('.vf-panel__title');
  const start = (await title.boundingBox())!;
  await page.mouse.move(start.x + 10, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(start.x - 200, start.y + 10, { steps: 5 });
  await page.mouse.up();
  const moved = (await window.boundingBox())!;
  expect(Math.round(start.x - 10 - moved.x)).toBeGreaterThan(150);

  // Dragged far past the top-left corner, it stops at the edge.
  const again = (await title.boundingBox())!;
  await page.mouse.move(again.x + 10, again.y + 10);
  await page.mouse.down();
  await page.mouse.move(-2000, -2000, { steps: 5 });
  await page.mouse.up();
  const stopped = (await window.boundingBox())!;
  expect(stopped.x).toBeGreaterThanOrEqual(0);
  expect(stopped.y).toBeGreaterThanOrEqual(0);
});
