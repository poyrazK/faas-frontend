import { expect, test } from './fixtures';

/*
 * Fleet wake latency (apid ADR-20261121200409).
 */

test('the wake latency page shows the target, the slowest wakes and the apps that cold boot', async ({ page }) => {
  await page.goto('/wakes');
  await expect(page.getByRole('heading', { level: 1, name: 'Wake latency' })).toBeVisible();
  await expect(page.getByText('p50 140 ms · p99 512 ms · target 350 ms')).toBeVisible();
  await expect(page.getByText('1 of 2 over 350 ms')).toBeVisible();

  const slowest = page.getByRole('row').filter({ hasText: 'Cold boot · wait ready' }).filter({ hasText: 'blog' });
  await expect(slowest).toContainText('blog');
  await expect(slowest).toContainText('2.41 s');
  await expect(slowest).toContainText('no_snapshot');
  await expect(page.getByRole('link', { name: 'Wake wake-0009-blog-cold timeline' })).toHaveAttribute('href', /\/lookup\?wake=wake-0009-blog-cold/);

  await expect(page.getByText('vmm_start_failed')).toBeVisible();
  await page.getByRole('button', { name: 'Only this app' }).click();
  await expect(page).toHaveURL(/app_id=app-9/);
  await expect(page.getByRole('row').filter({ hasText: 'checkout-api' })).toHaveCount(0);
});

test('the wake latency page filters by node and window', async ({ page }) => {
  await page.goto('/wakes?node=node-a&window=6h');
  await expect(page.getByRole('row').filter({ hasText: 'blog' })).toHaveCount(0);
  await expect(page.getByText('No cold boots in the window.')).toBeVisible();
  await expect(page.getByText('No failed wakes in the window.')).toBeVisible();
});
