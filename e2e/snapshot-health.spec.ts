import { expect, test } from './fixtures';

/*
 * Fleet snapshot health (apid ADR-20261122135018).
 */

test('the snapshot health page shows the footprint, the largest and stale snapshots and deployments without one', async ({ page }) => {
  await page.goto('/snapshots');
  await expect(page.getByRole('heading', { level: 1, name: 'Snapshot health' })).toBeVisible();

  const alert = page.getByRole('alert').filter({ hasText: 'usable snapshot' });
  await expect(alert).toContainText('1 live deployment has neither a usable snapshot nor a rootfs');
  await expect(alert.getByRole('link', { name: 'broken-app' })).toHaveAttribute('href', /deployment=dep-broken/);

  await expect(page.getByText('target 130 MB · warn 160 · page 200')).toBeVisible();
  await expect(page.getByText('140 MB', { exact: true }).first()).toBeVisible();

  const largest = page.getByRole('row').filter({ hasText: 'checkout-api' });
  await expect(largest).toContainText('230 MB');
  await expect(largest).toContainText('T2CL · icelake');

  await expect(page.getByRole('row').filter({ hasText: '1.11.0' }).first()).toBeVisible();
  const missing = page.getByRole('row').filter({ hasText: 'broken-app' });
  await expect(missing).toContainText('no rootfs');
  await expect(missing).toContainText('never snapshotted');
});
