import { expect, test } from './fixtures';
import { FAKE_API, OTHER_HOST, expectConnected, fakeApiState, openReview, pinComment, setMode } from './helpers';

test.describe('signed out', () => {
  test.use({ signedIn: false });

  test('signing in opens the demo list first, even on a site with a chosen demo', async ({
    context,
    worker,
    extensionId,
  }) => {
    const { panel } = await openReview(context, worker, extensionId);
    await expect(panel.getByRole('group', { name: 'Mode' })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Sign in with Microsoft' }).click();
    await expect(panel.getByText('Test Reviewer')).toBeVisible();
    const chooser = panel.getByRole('region', { name: 'Choose demo' });
    await expect(chooser.getByRole('heading', { name: "Choose the demo you're reviewing" })).toBeVisible();
    await chooser.getByRole('button', { name: 'Keep Frontend Demo #shop' }).click();
    await expectConnected(panel);

    await panel.getByRole('button', { name: 'Sign out' }).click();
    await expect(panel.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
    await expect(panel.getByText('Your session ended')).toHaveCount(0);
  });
});

test.describe('no demo chosen yet', () => {
  test.use({ demoChosen: false });

  test('the demo at the page’s site is offered first, and Send starts one feedback run', async ({
    context,
    worker,
    extensionId,
  }) => {
    const { page, panel } = await openReview(context, worker, extensionId);
    const chooser = panel.getByRole('region', { name: 'Choose demo' });
    await expect(chooser.getByText('Matches this page')).toBeVisible();
    await expect(chooser.getByText('localhost:4317')).toBeVisible();
    await chooser.getByRole('button', { name: 'Use this demo' }).click();
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
      'http://localhost:4317/jobs/run-1',
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

  test('a demo is chosen from the project list and remembered for the site', async ({
    context,
    worker,
    extensionId,
  }) => {
    const { page, panel } = await openReview(context, worker, extensionId, 'plain.html', OTHER_HOST);
    const chooser = panel.getByRole('region', { name: 'Choose demo' });
    const projects = chooser.getByRole('list', { name: 'Projects' });
    await expect(projects.getByRole('button')).toHaveCount(2);
    await expect(chooser.getByRole('button', { name: 'Use this demo' })).toHaveCount(0);

    await chooser.getByRole('searchbox', { name: 'Search projects' }).fill('other');
    await expect(projects.getByRole('button')).toHaveCount(1);
    await projects.getByRole('button', { name: 'Other Project' }).click();

    const demos = chooser.getByRole('list', { name: 'Demos' });
    await expect(demos.getByText('other-demo.web.app')).toBeVisible();
    await demos.getByRole('button', { name: /Mobile Demo #other/ }).click();
    await expect(panel.getByText('Other Project · Mobile Demo #other')).toBeVisible();

    await panel.reload();
    await expect(panel.getByText('Other Project · Mobile Demo #other')).toBeVisible();
    await setMode(panel, 'Select');
    await pinComment(page, 'h1', 'Works on any host');
    await panel.getByRole('button', { name: 'Send 1 draft' }).click();
    await expect(panel.getByRole('region', { name: 'Sent' }).getByText('Works on any host')).toBeVisible();
    expect((await fakeApiState()).runs[0]!.demoJobId).toBe('job-other');
  });
});

test('Change opens the list on the demo in use, and Keep goes back to it', async ({ context, worker, extensionId }) => {
  const { panel } = await openReview(context, worker, extensionId);
  await panel.getByRole('button', { name: 'Change' }).click();
  const chooser = panel.getByRole('region', { name: 'Choose demo' });
  await chooser.getByRole('list', { name: 'Projects' }).getByRole('button', { name: 'Demo Shop' }).click();
  await expect(chooser.getByRole('list', { name: 'Demos' }).getByText('In use')).toBeVisible();
  await chooser.getByRole('button', { name: 'Projects' }).click();
  await chooser.getByRole('button', { name: 'Keep Frontend Demo #shop' }).click();
  await expect(panel.getByText('Demo Shop · Frontend Demo #shop')).toBeVisible();
});

test('losing access to the demo says so and asks for another one', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await expect(panel.getByText('Demo Shop · Frontend Demo #shop')).toBeVisible();
  await setMode(panel, 'Select');
  await page.bringToFront();
  await pinComment(page, '#buy', 'Make this button bigger');
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Send 1 draft' }).click();
  await expect(panel.getByRole('region', { name: 'Sent' }).getByText('Running', { exact: true })).toBeVisible();

  // The next status poll finds the project gone.
  await fetch(`${FAKE_API}/_forbid/p-shop`, { method: 'POST' });
  const chooser = panel.getByRole('region', { name: 'Choose demo' });
  await expect(chooser.getByText('You no longer have access to this demo.')).toBeVisible({ timeout: 15_000 });
});
