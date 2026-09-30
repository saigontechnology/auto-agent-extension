import { expect, test } from './fixtures';
import { editText, openReview, pinComment, setMode } from './helpers';

test('hovering labels the element; panel keys steer and leave the picker', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await setMode(panel, 'Select');
  await page.locator('#title').hover();
  const label = page.locator('.vf-highlight__label');
  await expect(label).toHaveText('h1 · src/pages/Home.tsx:12');

  // Focus is still on the panel's Select button, as it is for a real reviewer.
  await panel.keyboard.press('ArrowUp');
  await expect(label).toHaveText('section · src/pages/Home.tsx:10');
  await panel.keyboard.press('ArrowDown');
  await expect(label).toHaveText('h1 · src/pages/Home.tsx:12');

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
  await expect(panel.getByText('demo-project · build-001')).toBeVisible();
  const drafts = panel.getByRole('region', { name: 'Drafts' });
  await expect(drafts.getByRole('heading', { name: '/', exact: true })).toBeVisible();
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
  await expect(drafts.getByText('Page · Whole page')).toBeVisible();
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
  await expect(
    drafts.getByText('“Fresh fruit delivered to your door.” → “Fruit, delivered.”'),
  ).toBeVisible();

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
