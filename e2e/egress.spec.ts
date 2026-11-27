import { expect, test } from './fixtures';

/*
 * Egress denials (apid ADR-20261127100000).
 */

test('the egress page shows denials by class and app, and the abuse signals', async ({ page }) => {
  await page.goto('/egress');
  await expect(page.getByRole('heading', { level: 1, name: 'Egress denials' })).toBeVisible();

  await expect(page.getByRole('status').filter({ hasText: 'Some reads failed' })).toContainText('dns_blocked');
  await expect(page.getByText('6,143', { exact: true })).toBeVisible();
  await expect(page.getByText('12 in the last hour · 13 apps')).toBeVisible();

  await expect(page.getByRole('row').filter({ hasText: 'Unresolved IP' }).first()).toContainText('3,877');
  await expect(page.getByRole('row').filter({ hasText: 'bhs-3.faas' })).toContainText('5,060');

  const miner = page.getByRole('row').filter({ hasText: 'miner-app' }).first();
  await expect(miner).toContainText('SMTP 40');
  await expect(miner.getByRole('link', { name: 'Flow log' })).toHaveAttribute('href', /\/metering\?account=/);

  await expect(page.getByRole('row').filter({ hasText: 'fanout' })).toContainText('2');
  await expect(page.getByRole('row').filter({ hasText: '203.0.113.0/24' })).toContainText('tenant traffic');

  await page.getByRole('combobox').first().selectOption('168h');
  await expect(page).toHaveURL(/window=168h/);
});
