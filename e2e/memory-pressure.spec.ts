import { expect, test } from './fixtures';

/*
 * Memory pressure (apid ADR-20261123190507).
 */

test('the memory pressure page shows nodes against the ceiling, affected apps and recent evictions', async ({ page }) => {
  await page.goto('/memory');
  await expect(page.getByRole('heading', { level: 1, name: 'Memory pressure' })).toBeVisible();

  const alert = page.getByRole('alert').filter({ hasText: 'admission ceiling' });
  await expect(alert).toContainText('1 node is over the admission ceiling: schedd is evicting until it is back under 90%.');
  await expect(alert.getByRole('link', { name: 'fsn-2' })).toBeVisible();

  const over = page.getByRole('row').filter({ hasText: 'fsn-2' }).filter({ hasText: 'over' });
  await expect(over).toContainText('47.0 GB · 101%');
  await expect(page.getByRole('row').filter({ hasText: 'fsn-4' }).first()).toContainText('stale');

  const app = page.getByRole('row').filter({ hasText: 'big-node' }).first();
  await expect(app).toContainText('640 / 512 MB');

  const oom = page.getByRole('row').filter({ hasText: 'peak 640 / 512 MB' });
  await expect(oom).toContainText('OOM kill');
  await expect(oom).toContainText('deploy failed');
  await expect(page.getByRole('row').filter({ hasText: 'Evicted: measured memory' }).last()).toContainText('blog');

  await page.getByRole('combobox').first().selectOption('6h');
  await expect(page).toHaveURL(/window=6h/);
});
