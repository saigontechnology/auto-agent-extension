import { expect, test } from './fixtures';
import { FAKE_API, OTHER_HOST, expectConnected, fakeApiState, openReview, pinComment, setMode } from './helpers';

test.describe('signed out', () => {
  test.use({ signedIn: false });

  test('the panel asks for sign-in first, and signing out returns to it', async ({ context, worker, extensionId }) => {
    const { panel } = await openReview(context, worker, extensionId);
    await expect(panel.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
    await expect(panel.getByRole('group', { name: 'Mode' })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Sign in with Microsoft' }).click();
    await expect(panel.getByText('Test Reviewer')).toBeVisible();
    await expectConnected(panel);

    await panel.getByRole('button', { name: 'Sign out' }).click();
    await expect(panel.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
    await expect(panel.getByText('Your session ended')).toHaveCount(0);
  });
});

test('a page on a demo’s site finds the demo, and Send starts one feedback run', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await expect(panel.getByText('Demo Shop · Frontend Demo #shop')).toBeVisible();

  await setMode(panel, 'Select');
  await page.bringToFront();
  await pinComment(page, '#buy', 'Make this button bigger');
  await panel.bringToFront();
  // A double click must not start two runs.
  await panel.getByRole('button', { name: 'Send 1 draft' }).dblclick();

  const sent = panel.getByRole('region', { name: 'Sent' });
  await expect(sent.getByText('Make this button bigger')).toBeVisible();
  await expect(sent.getByText('Running', { exact: true })).toBeVisible();
  await expect(sent.getByRole('link', { name: 'Open in Auto Agent' })).toHaveAttribute(
    'href',
    'http://localhost:4173/jobs/run-1',
  );
  await expect(page.locator('[data-vf-pin="sent"]')).toHaveText('1');

  const state = await fakeApiState();
  expect(state.runs).toHaveLength(1);
  expect(state.runs[0]!.demoJobId).toBe('job-shop');
  expect(state.runs[0]!.feedbackDescription).toContain('Make this button bigger');
  expect(state.runs[0]!.feedbackFiles[0]).toMatch(/^auto-agent-feedback-demo-project-.+\.json$/);
  expect(state.uploads[0]!.body).toContain('"comment": "Make this button bigger"');

  // The finished run shows up without reopening the panel.
  await fetch(`${FAKE_API}/_finish/run-1`, { method: 'POST' });
  await expect(sent.getByText('Done', { exact: true })).toBeVisible({ timeout: 15_000 });
});

test('a page that matches no demo asks which one it belongs to and remembers the answer', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'plain.html', OTHER_HOST);
  const picker = panel.getByRole('form', { name: 'Choose demo' });
  await expect(picker.getByText('This page did not match any of your demos. Choose one:')).toBeVisible();

  await setMode(panel, 'Select');
  await pinComment(page, 'h1', 'Works on any host');
  await expect(panel.getByRole('button', { name: 'Send 1 draft' })).toBeDisabled();

  await picker.getByLabel('Project', { exact: true }).selectOption({ label: 'Other Project' });
  await expect(picker.getByLabel('Demo', { exact: true })).toContainText('Mobile Demo #other');
  await picker.getByRole('button', { name: 'Use this demo' }).click();
  await expect(panel.getByText('Other Project · Mobile Demo #other')).toBeVisible();

  await panel.reload();
  await expect(panel.getByText('Other Project · Mobile Demo #other')).toBeVisible();
  await panel.getByRole('button', { name: 'Send 1 draft' }).click();
  await expect(panel.getByRole('region', { name: 'Sent' }).getByText('Works on any host')).toBeVisible();
  expect((await fakeApiState()).runs[0]!.demoJobId).toBe('job-other');
});
