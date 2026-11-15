import { ACCOUNT, expect, test } from './fixtures';

/*
 * Account visibility (apid ADR-20261112170000, ADR-20261113123000): find the
 * account behind what a customer quotes, see why it is not working, and list
 * customers who look stuck.
 */

test('support lookup finds the account behind an email', async ({ page }) => {
  await page.goto('/lookup');
  await page.getByLabel('Find the account').fill('ada@customer.test');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page).toHaveURL(/[?&]q=ada%40customer\.test/);
  const row = page.getByRole('row').filter({ hasText: 'email' });
  await expect(row).toContainText('Account');
  await expect(row.getByRole('link', { name: 'Open account' })).toHaveAttribute('href', new RegExp(ACCOUNT));

  await page.goto('/lookup?q=nothing-matches-this');
  await expect(page.getByText(/Nothing matched/).first()).toBeVisible();
});

test('the tenant overview shows the diagnosis', async ({ page }) => {
  await page.goto(`/tenants/${ACCOUNT}`);
  const panel = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Diagnosis', exact: true }) }).first();
  await expect(panel).toContainText('Payment past due');
  await expect(panel).toContainText('npm ci exited 1');
  await expect(panel).toContainText('Fix: Pin the Node version');
  await expect(panel).toContainText('CAA record forbids issuance');
  await expect(panel).toContainText('api_key_revoked ×3');
  await expect(panel).toContainText('Out of memory');
  await expect(panel).toContainText('customer sees this');
  await expect(panel.getByRole('link', { name: 'trace' })).toHaveAttribute('href', '/lookup?trace=4bf92f3577b34da6a3ce929d0e0e4736');
});

test('stuck customers lists open signals and filters by state', async ({ page }) => {
  await page.goto('/attention');
  await expect(page.getByRole('heading', { level: 1, name: 'Stuck customers' })).toBeVisible();
  await expect(page.getByText('2 signals on 2 accounts')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'checkout-api' })).toContainText('Out of memory');

  await page.getByRole('combobox').nth(1).selectOption('dismissed');
  await expect(page.getByRole('row').filter({ hasText: 'Burst of refused requests' })).toContainText('false positive');
});
