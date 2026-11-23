import { expect, test } from './fixtures';

/*
 * Build queue and builder slots (apid ADR-20261123163340).
 */

test('the build queue page shows waiting and running builds, slots per node and failures by cause', async ({ page }) => {
  await page.goto('/builds');
  await expect(page.getByRole('heading', { level: 1, name: 'Build queue' })).toBeVisible();

  const alert = page.getByRole('alert').filter({ hasText: 'build timeout' });
  await expect(alert).toContainText('1 build has run past the 15m 0s build timeout');

  await expect(page.getByText('oldest 21m 0s · 1 over 5m 0s · 1 held · 1 deferred')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'twin-api' })).toContainText('held: identical build');
  await expect(page.getByRole('row').filter({ hasText: 'fsn-4' })).toContainText('conflicting builderd reports');

  const node = page.getByRole('row').filter({ hasText: 'fsn-2' }).filter({ hasText: 'reserved' });
  await expect(node).toContainText('full');
  await expect(node).toContainText('1/1 reserved · 1 opportunistic · 1 borrowed');

  await expect(page.getByRole('row').filter({ hasText: 'Out of memory' }).first()).toContainText('3');
  await expect(page.getByRole('row').filter({ hasText: 'stuck-api' })).toContainText('21m 0s');

  const running = page.getByRole('row').filter({ hasText: 'monorepo' });
  await expect(running).toContainText('preempted ×1');
  await expect(running).toContainText('16m 40s');

  await page.getByRole('combobox').first().selectOption('1h');
  await expect(page).toHaveURL(/window=1h/);
});
