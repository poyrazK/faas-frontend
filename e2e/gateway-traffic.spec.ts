import { expect, test } from './fixtures';

/*
 * Gateway traffic (apid ADR-20261124093000).
 */

test('the gateway traffic page shows errors, wake queue outcomes and the most affected apps', async ({ page }) => {
  await page.goto('/traffic');
  await expect(page.getByRole('heading', { level: 1, name: 'Gateway traffic' })).toBeVisible();

  await expect(page.getByRole('status').filter({ hasText: 'Some reads failed' })).toContainText('overload_by_node');
  await expect(page.getByText('12.8k', { exact: true })).toBeVisible();
  await expect(page.getByText('turned away of 415 wakes · 7 held now')).toBeVisible();

  const node = page.getByRole('row').filter({ hasText: 'fsn-2' }).first();
  await expect(node).toContainText('170 · 1.89%');

  const blog = page.getByRole('row').filter({ hasText: 'blog' }).first();
  await expect(blog).toContainText('150 · 12.5%');
  await expect(blog).toContainText('0 / 150 / 0');
  await expect(page.getByRole('row').filter({ hasText: 'unknown host' })).toBeVisible();

  await expect(page.getByRole('row').filter({ hasText: "App's wake queue full" })).toContainText('12');
  await expect(page.getByText('1 app wakes waiting for a gateway-wide slot now.')).toBeVisible();

  await page.getByRole('combobox').first().selectOption('6h');
  await expect(page).toHaveURL(/window=6h/);
});
