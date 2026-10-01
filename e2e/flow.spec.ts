import type { Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { expect, test } from './fixtures';
import { FIXTURE, openReview } from './helpers';

// `worker.evaluate` callbacks run inside the extension's service worker, where `chrome` exists.
declare const chrome: typeof browser;

type StoredStep = Record<string, unknown> & { type: string };

/** The one recording in session storage, as the background keeps it. */
async function storedRecording(worker: Worker) {
  return worker.evaluate(async () => {
    const { recordings } = await chrome.storage.session.get('recordings');
    const all = (recordings ?? {}) as Record<string, { status: string; steps: StoredStep[] }>;
    return Object.values(all)[0] ?? null;
  });
}

async function storedTypes(worker: Worker): Promise<string[]> {
  return (await storedRecording(worker))?.steps.map((step) => step.type) ?? [];
}

test('a recording captures entries, clicks, errors and page changes', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await expect(page.getByRole('status')).toContainText('REC');

  await page.locator('#email').fill('ada@example.com');
  await page.locator('#password').fill('hunter2');
  await page.locator('#plan').selectOption('pro');
  await page.locator('#remember').check();
  await page.locator('#submit').click();
  await expect(page).toHaveTitle('status 500');
  await page.locator('#crash').click();
  await page.locator('#about-link').click();
  await expect(page).toHaveTitle('About · Demo Shop');

  await expect
    .poll(() => storedTypes(worker))
    .toEqual(['input', 'input', 'select', 'check', 'click', 'network', 'click', 'console', 'console', 'click', 'navigate']);
  const steps = (await storedRecording(worker))!.steps;
  expect(steps[0]).toMatchObject({ value: 'ada@example.com', anchor: { source: 'src/pages/Login.tsx:31' } });
  // Values are recorded verbatim, passwords included.
  expect(steps[1]).toMatchObject({ value: 'hunter2' });
  expect(steps[5]).toMatchObject({ method: 'POST', status: 500, url: 'http://localhost:4173/api/login' });
  expect(steps[7]).toMatchObject({ source: 'error', message: 'About to crash' });
  expect(steps[8]).toMatchObject({ source: 'exception', message: 'Error: Boom' });
  expect(steps[10]).toMatchObject({ cause: 'load', path: '/about.html' });

  // The new page keeps recording and still shows the badge.
  await expect(page.getByRole('status')).toContainText('REC');
});

test('errors a page raises while it loads are recorded after its navigate step', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await expect(page.getByRole('status')).toContainText('REC');

  await page.goto(FIXTURE + 'crash-on-load.html');
  await expect.poll(async () => (await storedTypes(worker)).slice(-3)).toEqual(['navigate', 'console', 'console']);
  const steps = (await storedRecording(worker))!.steps.slice(-3);
  expect(steps[0]).toMatchObject({ path: '/crash-on-load.html' });
  expect(steps[1]).toMatchObject({ message: 'Load error' });
  expect(steps[2]).toMatchObject({ message: 'Error: Load boom' });
});

test('picking stays off while recording', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await expect(page.getByRole('status')).toContainText('REC');

  await expect(panel.getByRole('group', { name: 'Mode' })).toHaveCount(0);
  await page.locator('#email').fill('x');
  await expect.poll(() => storedTypes(worker)).toContain('input');
});

test('the panel lists steps live, takes notes, pauses and stops', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  const bar = panel.getByRole('region', { name: 'Recording' });
  await expect(bar).toBeVisible();

  await page.locator('#email').fill('ada@example.com');
  await expect(bar.getByText('Type "ada@example.com" into input "Email"')).toBeVisible();
  await expect(bar.getByText('src/pages/Login.tsx:31')).toBeVisible();

  await bar.getByRole('button', { name: 'Note' }).click();
  await bar.getByRole('textbox', { name: 'Note' }).fill('Looks slow');
  await bar.getByRole('button', { name: 'Add note' }).click();
  await expect(bar.getByText('Note: Looks slow')).toBeVisible();

  await bar.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('status')).toContainText('Paused');
  await page.locator('#password').fill('hunter2');
  // Notes come from the reviewer, so they are kept while paused; reopening the form keeps the text.
  await bar.getByRole('button', { name: 'Note', exact: true }).click();
  await bar.getByRole('textbox', { name: 'Note' }).fill('Paused here');
  await bar.getByRole('button', { name: 'Note', exact: true }).click();
  await expect(bar.getByRole('textbox', { name: 'Note' })).toHaveValue('Paused here');
  await bar.getByRole('button', { name: 'Add note' }).click();
  await expect(bar.getByText('Note: Paused here')).toBeVisible();
  await bar.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('status')).toContainText('REC');
  await expect(bar.getByText(/hunter2/)).toHaveCount(0);
  await expect(bar).toContainText('3 steps');

  await bar.getByRole('button', { name: 'Stop' }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect.poll(async () => (await storedRecording(worker))?.status).toBe('stopped');
});

test('a stopped recording is reviewed, saved as a draft and sent', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await page.locator('#email').fill('ada@example.com');
  await page.locator('#submit').click();
  await expect(page).toHaveTitle('status 500');
  const bar = panel.getByRole('region', { name: 'Recording' });
  await expect(bar.getByText('POST /api/login → 500')).toBeVisible();
  await bar.getByRole('button', { name: 'Stop' }).click();

  const review = panel.getByRole('form', { name: 'Review workflow' });
  await expect(review.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  await review.getByLabel('Title').fill('Sign-in fails');
  await review.getByLabel('Expected').fill('I land on the dashboard');
  await review.getByLabel('Actual').fill('Nothing happens');
  const failing = review.getByRole('listitem').filter({ hasText: 'POST /api/login → 500' });
  await failing.getByRole('button', { name: 'Mark as failing step' }).click();
  await expect(failing.getByText('Fails here')).toBeVisible();
  await review.getByRole('listitem').filter({ hasText: 'Click button "Sign in"' }).getByRole('button', { name: 'Delete step' }).click();
  await review.getByRole('button', { name: 'Save draft' }).click();

  const drafts = panel.getByRole('region', { name: 'Drafts' });
  await expect(drafts.getByText('Sign-in fails')).toBeVisible();
  await expect(drafts.getByText('2 steps · 1 error')).toBeVisible();
  expect(await storedRecording(worker)).toBeNull();

  await panel.getByRole('button', { name: 'Send 1 draft' }).click();
  await expect(panel.getByRole('region', { name: 'Sent' }).getByText('Sign-in fails')).toBeVisible();
  const sent = await worker.evaluate(async () => {
    const { feedback } = await chrome.storage.local.get('feedback');
    return (feedback as Record<string, Array<Record<string, any>>>)['demo-project']?.[0];
  });
  expect(sent).toMatchObject({ kind: 'flow', comment: 'Sign-in fails', flow: { expected: 'I land on the dashboard' } });
  expect(sent?.flow.steps.map((step: { type: string }) => step.type)).toEqual(['input', 'network']);
  expect(sent?.flow.failedStepId).toBe(sent?.flow.steps[1].id);
});

test('discarding asks first; closing the tab keeps an untitled draft that cannot be sent', async ({
  context,
  worker,
  extensionId,
}) => {
  const first = await openReview(context, worker, extensionId, 'flow.html');
  await first.panel.getByRole('button', { name: 'Record workflow' }).click();
  await first.page.locator('#email').fill('first');
  await first.panel.getByRole('button', { name: 'Stop' }).click();
  const review = first.panel.getByRole('form', { name: 'Review workflow' });
  await review.getByRole('button', { name: 'Discard' }).click();
  await review.getByRole('button', { name: 'Keep' }).click();
  await review.getByRole('button', { name: 'Discard' }).click();
  await review.getByRole('button', { name: 'Discard' }).click();
  await expect(review).toHaveCount(0);
  await expect(first.panel.getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();

  await first.panel.getByRole('button', { name: 'Record workflow' }).click();
  await first.page.locator('#email').fill('ada@example.com');
  await expect.poll(async () => (await storedRecording(worker))?.steps.length).toBe(1);
  await first.page.close();

  const second = await openReview(context, worker, extensionId, 'flow.html');
  const drafts = second.panel.getByRole('region', { name: 'Drafts' });
  await expect(drafts.getByText('Untitled workflow')).toBeVisible();
  await expect(drafts.getByText('Add a title to send')).toBeVisible();
  await expect(drafts.getByRole('checkbox', { name: 'Include in send' })).toBeDisabled();
  await expect(second.panel.getByRole('button', { name: 'Send drafts' })).toBeDisabled();

  await drafts.getByRole('button', { name: 'Edit' }).click();
  const edit = second.panel.getByRole('form', { name: 'Review workflow' });
  await edit.getByLabel('Title').fill('Email field loses focus');
  await edit.getByRole('button', { name: 'Save draft' }).click();
  await expect(drafts.getByText('Email field loses focus')).toBeVisible();
  await expect(second.panel.getByRole('button', { name: 'Send 1 draft' })).toBeEnabled();
});

test('steps highlight their element; a sent workflow lists its steps with Go to', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await page.locator('#email').fill('ada@example.com');
  await page.locator('#about-link').click();
  await expect(page).toHaveTitle('About · Demo Shop');
  // A back/forward cache restore fires no load event, so wait only for the commit.
  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveTitle('Sign in · Demo Shop');
  await panel.getByRole('button', { name: 'Stop' }).click();

  const review = panel.getByRole('form', { name: 'Review workflow' });
  await review.getByText('Type "ada@example.com" into input "Email"').hover();
  await expect(page.locator('.vf-highlight')).toHaveCount(1);
  await review.getByLabel('Title').hover();
  await expect(page.locator('.vf-highlight')).toHaveCount(0);

  await review.getByLabel('Title').fill('Round trip');
  await review.getByRole('button', { name: 'Save draft' }).click();
  await panel.getByRole('button', { name: 'Send 1 draft' }).click();

  const sent = panel.getByRole('region', { name: 'Sent' });
  await sent.getByRole('button', { name: 'Show steps' }).click();
  await expect(sent.getByText('Go to /about.html')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sent
    .getByRole('listitem')
    .filter({ hasText: 'Type "ada@example.com" into input "Email"' })
    // The sent row is a listitem too and contains the step, so take the innermost match.
    .last()
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(page.locator('.vf-highlight')).toHaveCount(1);
  await expect(page.locator('#email')).toBeInViewport();
});

test('route changes in a hash-routed app are recorded as steps', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'spa.html#/home');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await page.locator('#to-settings').click();
  await expect(page.locator('#heading')).toHaveText('Settings');
  await page.locator('#push').click();
  await expect(page.locator('#heading')).toHaveText('Pushed');
  // Rewriting the query of the same route is not a new step.
  await page.evaluate(() => history.replaceState(null, '', location.pathname + '?q=1'));
  // A later step is listed only after anything recorded before it, so the check below is not early.
  await page.locator('#heading').click();
  const bar = panel.getByRole('region', { name: 'Recording' });
  await expect(bar.getByText('Click h1 "Pushed"')).toBeVisible();
  await bar.getByRole('button', { name: 'Stop' }).click();

  const review = panel.getByRole('form', { name: 'Review workflow' });
  await expect(review.getByText('Go to /spa.html#/settings')).toBeVisible();
  await expect(review.getByText('Go to /pushed/a')).toHaveCount(1);
});

test('Go to opens the page of a step on another page and highlights its element', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await page.locator('#email').fill('ada@example.com');
  await page.locator('#about-link').click();
  await expect(page).toHaveTitle('About · Demo Shop');
  await page.locator('h1').click();
  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveTitle('Sign in · Demo Shop');
  await panel.getByRole('button', { name: 'Stop' }).click();

  const review = panel.getByRole('form', { name: 'Review workflow' });
  await review.getByLabel('Title').fill('Cross page');
  await review.getByRole('button', { name: 'Save draft' }).click();
  await panel.getByRole('button', { name: 'Send 1 draft' }).click();

  const sent = panel.getByRole('region', { name: 'Sent' });
  await sent.getByRole('button', { name: 'Show steps' }).click();
  await sent
    .getByRole('listitem')
    .filter({ hasText: 'Click h1 "About us"' })
    // The sent row is a listitem too and contains the step, so take the innermost match.
    .last()
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(page).toHaveTitle('About · Demo Shop');
  await expect(page.locator('.vf-highlight')).toHaveCount(1);
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const { 'go-to': pending } = await chrome.storage.session.get('go-to');
        return Object.keys((pending ?? {}) as object);
      }),
    )
    .toEqual([]);
});

test('a step whose element is gone from the page is marked as not found', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await page.locator('#email').fill('ada@example.com');
  await panel.getByRole('button', { name: 'Stop' }).click();

  const review = panel.getByRole('form', { name: 'Review workflow' });
  await review.getByLabel('Title').fill('Vanishing field');
  await review.getByRole('button', { name: 'Save draft' }).click();
  await panel.getByRole('button', { name: 'Send 1 draft' }).click();

  const sent = panel.getByRole('region', { name: 'Sent' });
  await sent.getByRole('button', { name: 'Show steps' }).click();
  await page.evaluate(() => document.getElementById('email')?.remove());
  const step = sent
    .getByRole('listitem')
    .filter({ hasText: 'Type "ada@example.com" into input "Email"' })
    .last();
  await step.getByRole('button', { name: 'Go to' }).click();
  await expect(step.getByText('element not found')).toBeVisible();
});
