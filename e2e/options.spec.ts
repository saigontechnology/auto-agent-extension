import { expect, test } from './fixtures';
import { openReview } from './helpers';

test('options show the account and sign out of the panel too', async ({ context, worker, extensionId }) => {
  const { panel } = await openReview(context, worker, extensionId);
  await expect(panel.getByText('Test Reviewer')).toBeVisible();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByText('Signed in as Test Reviewer (tester)')).toBeVisible();

  await options.getByRole('button', { name: 'Sign out' }).click();
  await expect(options.getByText('Not signed in. Open the Auto Agent panel on a page to sign in.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
});
