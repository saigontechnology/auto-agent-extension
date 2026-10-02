import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { OTHER_HOST, expectConnected, expectTextChange, openReview, pinComment, runUpdate } from './helpers';

test('pin a comment, send it, and see it as sent', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await expectConnected(panel);

  await panel.getByRole('button', { name: 'Select', exact: true }).click();
  await page.bringToFront();
  await page.locator('#buy').click();
  // Picking must swallow the click: the fixture's own handler would change the title.
  await expect(page).toHaveTitle('Demo Shop');

  await page.getByPlaceholder('Add a comment').fill('Make this button bigger');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveText('1');

  await panel.bringToFront();
  const drafts = panel.getByRole('region', { name: 'Drafts' });
  await expect(drafts.getByText('Make this button bigger')).toBeVisible();
  await expect(drafts.getByRole('link', { name: 'localhost:4317/' })).toBeVisible();
  await expect(drafts.getByText('src/pages/Home.tsx:10')).toHaveCount(0);

  await runUpdate(panel);
  await expect(panel.getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Sent' }).getByText('Make this button bigger')).toBeVisible();
  await expect(page.locator('[data-vf-pin="sent"]')).toHaveText('1');
});

test('edit text inline and keep the draft across a reload', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId);

  await panel.getByRole('button', { name: 'Text', exact: true }).click();
  await page.bringToFront();
  await page.locator('#tagline').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Fruit at your door.');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Text change')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  const drafts = panel.getByRole('region', { name: 'Drafts' });
  await expectTextChange(drafts, 'Fresh fruit delivered to your door.', 'Fruit at your door.');

  await page.reload();
  await expect(page.locator('#tagline')).toHaveText('Fresh fruit delivered to your door.');
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveCount(1);
  await expectTextChange(drafts, 'Fresh fruit delivered to your door.', 'Fruit at your door.');
});

test('any page can be reviewed, without preview markers and on any host', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'plain.html', OTHER_HOST);
  await expectConnected(panel);

  await panel.getByRole('button', { name: 'Select', exact: true }).click();
  await pinComment(page, 'h1', 'Works without markers');
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveText('1');

  // The export holds the body Send would POST; its name shows the host was used as the project.
  const [download] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: 'Export JSON' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^auto-agent-feedback-127\.0\.0\.1-4317-.+\.json$/);
  const payload = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(payload.client.extensionVersion).toBeTruthy();
  expect(payload.items).toHaveLength(1);
  expect(payload.items[0]).toMatchObject({
    buildId: 'local',
    kind: 'element',
    comment: 'Works without markers',
    page: { path: '/plain.html' },
  });
});
