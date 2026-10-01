import type { Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { expect, test } from './fixtures';
import { openReview } from './helpers';

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

test('picking stays off while recording', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await expect(page.getByRole('status')).toContainText('REC');

  await panel.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#email').fill('x');
  await expect.poll(() => storedTypes(worker)).toContain('input');
});
