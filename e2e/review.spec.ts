import { expect, test } from './fixtures';
import type { browser } from 'wxt/browser';
import {
  editText,
  expectConnected,
  expectTextChange,
  openPanelOnBlankTab,
  openReview,
  pinComment,
  setMode,
} from './helpers';

// `worker.evaluate` callbacks run inside the extension's service worker, where `chrome` exists.
declare const chrome: typeof browser;

test('hovering labels the element; panel keys steer and leave the picker', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await setMode(panel, 'Select');
  await page.locator('#title').hover();
  const label = page.locator('.vf-highlight__label');
  await expect(label).toHaveText('h1 src/pages/Home.tsx:12');

  // Focus is still on the panel's Select button, as it is for a real reviewer.
  await panel.keyboard.press('ArrowUp');
  await expect(label).toHaveText('section src/pages/Home.tsx:10');
  await panel.keyboard.press('ArrowDown');
  await expect(label).toHaveText('h1 src/pages/Home.tsx:12');

  await panel.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.vf-highlight')).toHaveCount(0);
});

test('Escape on the page leaves the mode and the panel follows', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await setMode(panel, 'Select');
  await page.bringToFront();
  await page.locator('#title').hover();
  await expect(page.locator('.vf-highlight')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.vf-highlight')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // With the mode off the page works normally again.
  await page.locator('#buy').click();
  await expect(page).toHaveTitle('clicked');
});

test('clicking a draft in the panel scrolls its pin into view', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await setMode(panel, 'Select');
  await page.bringToFront();
  await pinComment(page, '#far', 'Too far down');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('#far')).not.toBeInViewport();

  await panel.getByRole('region', { name: 'Drafts' }).getByText('Too far down').click();
  await expect(page.locator('#far')).toBeInViewport();
  await expect(page.locator('[data-vf-pin="draft"]')).toBeInViewport();
});

test('drafts from another page are listed but not pinned', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await setMode(panel, 'Select');
  await pinComment(page, '#title', 'Shorter headline');
  await setMode(panel, 'Off');

  await page.locator('#about-link').click();
  await expect(page).toHaveTitle('About · Demo Shop');
  await expectConnected(panel);
  const drafts = panel.getByRole('region', { name: 'Drafts' });
  await expect(drafts.getByRole('link', { name: 'localhost:4173/', exact: true })).toBeVisible();
  await expect(drafts.getByText('Shorter headline')).toBeVisible();
  await expect(page.locator('[data-vf-pin]')).toHaveCount(0);

  await page.locator('#home-link').click();
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveCount(1);
});

test('closing the panel hides the pins', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await setMode(panel, 'Select');
  await pinComment(page, '#title', 'Shorter headline');
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveCount(1);
  await panel.close();
  await expect(page.locator('[data-vf-pin]')).toHaveCount(0);
});

test('a page comment has no pin; drafts can be edited and deleted in the panel', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await panel.getByRole('button', { name: 'Add page comment' }).click();
  await panel.getByPlaceholder('Comment about this page as a whole').fill('Needs a back button');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();

  const drafts = panel.getByRole('region', { name: 'Drafts' });
  await expect(drafts.getByRole('link', { name: 'localhost:4173/' })).toBeVisible();
  await expect(drafts.getByText('Needs a back button')).toBeVisible();
  await expect(page.locator('[data-vf-pin]')).toHaveCount(0);

  await drafts.getByRole('button', { name: 'Edit' }).click();
  await drafts.getByRole('textbox').fill('Needs a home button');
  await drafts.getByRole('button', { name: 'Save' }).click();
  await expect(drafts.getByText('Needs a home button')).toBeVisible();

  await drafts.getByRole('button', { name: 'Delete' }).click();
  await expect(panel.getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();
});

test('re-editing text amends one draft; editing it back removes the draft', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await setMode(panel, 'Text');
  await page.bringToFront();

  await editText(page, '#tagline', 'Fruit at your door.');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await editText(page, '#tagline', 'Fruit, delivered.');
  await page.getByRole('button', { name: 'Cancel' }).click();

  const drafts = panel.getByRole('region', { name: 'Drafts' });
  await expect(panel.getByRole('heading', { name: 'Drafts (1)' })).toBeVisible();
  await expectTextChange(drafts, 'Fresh fruit delivered to your door.', 'Fruit, delivered.');

  await editText(page, '#tagline', 'Fresh fruit delivered to your door.');
  await expect(panel.getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();
});

test('Escape while editing text restores the original and creates no draft', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await setMode(panel, 'Text');
  await page.bringToFront();
  await page.locator('#tagline').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Oops');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tagline')).toHaveText('Fresh fruit delivered to your door.');
  await expect(panel.getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();
});

test('comments made after a route change are filed under the new route', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'spa.html#/home');
  await setMode(panel, 'Select');
  await pinComment(page, '#heading', 'Home note');
  await setMode(panel, 'Off');

  await page.locator('#to-settings').click();
  await expect(page.locator('#heading')).toHaveText('Settings');
  await expect(page.locator('[data-vf-pin]')).toHaveCount(0);
  await setMode(panel, 'Select');
  await pinComment(page, '#heading', 'Settings note');
  await setMode(panel, 'Off');

  await page.locator('#push').click();
  await expect(page.locator('#heading')).toHaveText('Pushed');
  await setMode(panel, 'Select');
  await pinComment(page, '#heading', 'Pushed note');

  const drafts = panel.getByRole('region', { name: 'Drafts' });
  for (const path of ['/spa.html#/home', '/spa.html#/settings', '/pushed/a']) {
    await expect(drafts.getByRole('link', { name: `localhost:4173${path}`, exact: true })).toBeVisible();
  }
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveCount(1);

  const stored = await worker.evaluate(async () => {
    const { drafts } = await chrome.storage.local.get('drafts');
    return (drafts as Record<string, Array<{ page: { title: string } }>>)['demo-project'];
  });
  expect(stored?.map((draft) => draft.page.title)).toEqual(['Home', 'Settings', 'Pushed']);
});

test('a page restored from the back/forward cache reconnects to the panel', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await page.evaluate(() => {
    addEventListener('pageshow', (event) => {
      document.documentElement.dataset.restored = String(event.persisted);
    });
  });
  await page.locator('#about-link').click();
  await expect(page).toHaveTitle('About · Demo Shop');
  // A cache restore fires no load event, so wait only for the navigation to commit.
  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveTitle('Demo Shop');
  // Guards the test itself: the page really came out of the cache rather than reloading.
  await expect(page.locator('html')).toHaveAttribute('data-restored', 'true');

  await expectConnected(panel);
  await setMode(panel, 'Select');
  await pinComment(page, '#title', 'Still works');
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveCount(1);
});

test('a page the extension is not running in asks for a reload', async ({
  context,
  worker,
  extensionId,
}) => {
  const panel = await openPanelOnBlankTab(context, worker, extensionId);
  await expect(panel.getByText('If this is a preview build, reload the page.')).toBeVisible();
  await expect(panel.getByText('This page is not a preview build')).toHaveCount(0);
});

test('a click picks the highlighted element after the keyboard moved the selection', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await setMode(panel, 'Select');
  await page.locator('#tagline').hover();
  await panel.keyboard.press('ArrowUp');
  await panel.keyboard.press('ArrowDown');
  await expect(page.locator('.vf-highlight__label')).toHaveText('h1 src/pages/Home.tsx:12');

  await pinComment(page, '#tagline', 'About the headline');
  await expect(panel.getByRole('region', { name: 'Drafts' }).getByText('About the headline')).toBeVisible();
  const stored = await worker.evaluate(async () => {
    const { drafts } = await chrome.storage.local.get('drafts');
    return (drafts as Record<string, Array<{ anchor?: { source?: string } }>>)['demo-project'];
  });
  expect(stored?.map((draft) => draft.anchor?.source)).toEqual(['src/pages/Home.tsx:12']);
});

test('sent feedback can be resolved and reopened, and stays after a reload', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await setMode(panel, 'Select');
  await pinComment(page, '#title', 'Shorter headline');
  await panel.getByRole('button', { name: 'Send 1' }).click();

  const sent = panel.getByRole('region', { name: 'Sent' });
  await expect(page.locator('[data-vf-pin="sent"]')).toHaveCount(1);
  await sent.getByRole('button', { name: 'Resolve' }).click();
  await expect(sent.getByLabel('Resolved')).toBeVisible();
  await expect(page.locator('[data-vf-pin]')).toHaveCount(0);

  await page.reload();
  await expect(sent.getByText('Shorter headline')).toBeVisible();
  await expect(sent.getByLabel('Resolved')).toBeVisible();

  await sent.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.locator('[data-vf-pin="sent"]')).toHaveText('1');
});
