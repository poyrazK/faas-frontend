import { ACCOUNT, expect, INSTANCE_RUNNING, test } from './fixtures';

/*
 * Running instances across the fleet and one instance's page
 * (apid ADR-20261121161842).
 */

test('the fleet list shows running instances and filters by state, node and account', async ({ page }) => {
  await page.goto('/instances');
  await expect(page.getByRole('heading', { level: 1, name: 'Running instances' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'checkout-api' })).toContainText('node-a');
  await expect(page.getByRole('row').filter({ hasText: 'blog' })).toHaveCount(1);
  await expect(page.getByText('2 instances on 2 accounts')).toBeVisible();

  await page.goto('/instances?state=resident');
  await expect(page.getByText('frozen')).toBeVisible();

  await page.goto(`/instances?account_id=${ACCOUNT}`);
  await expect(page.getByRole('row').filter({ hasText: 'blog' })).toHaveCount(0);
  await expect(page.getByText('1 instance on 1 account')).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'blog' })).toHaveCount(1);
});

test('an instance page shows where it runs, its wake and the invocations it ran', async ({ page }) => {
  await page.goto('/instances');
  await page.getByRole('link', { name: 'checkout-api' }).click();
  await expect(page).toHaveURL(new RegExp(`/instances/${INSTANCE_RUNNING}`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('checkout-api');
  await expect(page.getByText('wake.snapshot_restore_started')).toBeVisible();
  await expect(page.getByText('+212 ms')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Full timeline →' })).toHaveAttribute('href', /\/lookup\?wake=wake-0001-checkout/);
  await expect(page.getByText('POST /jobs/resize')).toBeVisible();
  await expect(page.getByText('POST /jobs/other')).toHaveCount(0);
  await expect(page.getByText('running of 10')).toBeVisible();
});

test('an unknown instance says so', async ({ page }) => {
  await page.goto('/instances/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('No instance has this ID.')).toBeVisible();
});

test('instance ids elsewhere open the instance page', async ({ page }) => {
  await page.goto('/nodes?node=node-a');
  const dialog = page.getByRole('dialog', { name: 'Node node-a' });
  await expect(dialog.locator(`a[href="/instances/${INSTANCE_RUNNING}"]`).first()).toBeVisible();
});
