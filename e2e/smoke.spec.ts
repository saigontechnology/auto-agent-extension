import { expect, test } from './fixtures';
import { openReview } from './helpers';

test('pin a comment, send it, and see it as sent', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await expect(panel.getByText('demo-project · build-001')).toBeVisible();

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
  await expect(drafts.getByText('src/pages/Home.tsx:10')).toBeVisible();

  await panel.getByRole('button', { name: 'Send 1' }).click();
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
  await expect(drafts.getByText('“Fresh fruit delivered to your door.” → “Fruit at your door.”')).toBeVisible();

  await page.reload();
  await expect(page.locator('#tagline')).toHaveText('Fresh fruit delivered to your door.');
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveCount(1);
  await expect(drafts.getByText('→ “Fruit at your door.”')).toBeVisible();
});

test('a page without the meta tags is reported as not a preview', async ({ context, worker, extensionId }) => {
  const { panel } = await openReview(context, worker, extensionId, 'plain.html');
  await expect(panel.getByText('This page is not a preview build')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0);
});
