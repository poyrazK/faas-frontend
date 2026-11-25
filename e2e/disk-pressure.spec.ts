import { expect, test } from './fixtures';

/*
 * Disk pressure (apid ADR-20261124150000).
 */

test('the disk pressure page grades host filesystems and lists the fullest guest disks', async ({ page }) => {
  await page.goto('/disk');
  await expect(page.getByRole('heading', { level: 1, name: 'Disk pressure' })).toBeVisible();

  const alert = page.getByRole('alert').filter({ hasText: 'needs attention now' });
  await expect(alert).toContainText('fsn-2:/srv/fc (full in 2.5 h)');

  await expect(page.getByText('0 critical · 1 filling · 1 low · 0 inodes low · 1 no disk data')).toBeVisible();

  const node = page.getByRole('row').filter({ hasText: 'control-plane' }).first();
  await expect(node).toContainText('Control plane');
  await expect(node).toContainText('/ · 10% free');

  const jail = page.getByRole('row').filter({ hasText: '/srv/fc/jail' });
  await expect(jail).toContainText('tmpfs');
  await expect(jail).toContainText('RAM');
  await expect(page.getByRole('row').filter({ hasText: 'db-1' })).toContainText('No disk data');
  await expect(page.getByRole('row').filter({ hasText: 'fsn-4' })).toContainText('No disk data');

  const filling = page.getByRole('row').filter({ hasText: '/srv/fc' }).filter({ hasText: 'Filling fast' }).filter({ hasText: '400' });
  await expect(filling).toContainText('2.5 h');
  await expect(page.getByRole('row').filter({ hasText: 'fsn-3' }).filter({ hasText: '4.2 d' })).toBeVisible();

  const guest = page.getByRole('row').filter({ hasText: 'blog' });
  await expect(guest).toContainText('97%');
  await expect(guest).toContainText('1.94 GB of 2.00 GB');
});
