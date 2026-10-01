import type { browser } from 'wxt/browser';
import { LOCAL_ONLY } from '../lib/config';
import { expect, test } from './fixtures';
import { openReview } from './helpers';

// Init scripts run inside the extension page, where `chrome` exists.
declare const chrome: typeof browser;

// These cover the API settings form, which is hidden while feedback is local only.
test.skip(LOCAL_ONLY, 'API settings are turned off while LOCAL_ONLY is on');

test('options refuse incomplete real-API settings and keep mock as the default', async ({
  context,
  extensionId,
}) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  const mock = options.getByLabel('Use mock API');
  await expect(mock).toBeChecked();

  await mock.uncheck();
  await options.getByRole('button', { name: 'Save' }).click();
  const status = options.getByRole('status');
  await expect(status).toContainText('API base URL must be an https URL.');
  await expect(status).toContainText('Client ID is required.');

  await options.reload();
  await expect(options.getByLabel('Use mock API')).toBeChecked();
});

test('switching to the real API asks for sign-in; switching back restores mock', async ({
  context,
  worker,
  extensionId,
}) => {
  const { panel } = await openReview(context, worker, extensionId);
  await expect(panel.getByText('Mock', { exact: true })).toBeVisible();

  // localhost is already a granted host, so saving does not raise Chrome's permission prompt.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel('Use mock API').uncheck();
  await options.getByLabel('API base URL').fill('http://localhost:4173/api/');
  await options.getByLabel('OAuth authorize URL').fill('http://localhost:4173/authorize');
  await options.getByLabel('OAuth token URL').fill('http://localhost:4173/token');
  await options.getByLabel('OAuth client ID').fill('vibe-extension');
  await options.getByRole('button', { name: 'Save' }).click();
  await expect(options.getByRole('status')).toHaveText('Saved.');
  await expect(options.getByLabel('API base URL')).toHaveValue('http://localhost:4173/api');

  await expect(panel.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(panel.getByText('Mock', { exact: true })).toHaveCount(0);
  await expect(
    panel.getByRole('region', { name: 'Sent' }).getByText('Sign in to continue'),
  ).toBeVisible();
  await expect(panel.getByText('Sign in to send your drafts.')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Send/ })).toBeDisabled();

  await options.getByLabel('Use mock API').check();
  await options.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByText('Mock', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
});

test('an edit made while saved settings are still loading is not overwritten', async ({
  context,
  extensionId,
}) => {
  const options = await context.newPage();
  // Make reading storage slow, as it can be on a busy machine.
  await options.addInitScript(() => {
    const local = chrome.storage.local;
    const get = local.get.bind(local) as (...args: unknown[]) => Promise<unknown>;
    local.get = ((...args: unknown[]) =>
      new Promise((resolve) => setTimeout(resolve, 600)).then(() => get(...args))) as typeof local.get;
  });
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  await options.getByLabel('Use mock API').uncheck();
  await options.waitForTimeout(900);
  await expect(options.getByLabel('Use mock API')).not.toBeChecked();
});
