import { expect, test } from './fixtures';

/*
 * Control-plane health (apid ADR-20261126120000).
 */

test('the control-plane page grades Postgres, backups and daemon pools', async ({ page }) => {
  await page.goto('/control-plane');
  await expect(page.getByRole('heading', { level: 1, name: 'Control plane' })).toBeVisible();

  const alert = page.getByRole('alert').filter({ hasText: 'need attention' });
  await expect(alert).toContainText('Postgres connections (150 of 185)');
  await expect(alert).toContainText('Daemon database pools (acquires canceled: schedd@fsn-2)');

  await expect(page.getByText('1 critical · 2 warning · 0 not reported of 8')).toBeVisible();
  await expect(page.getByText('150 / 185')).toBeVisible();

  const conn = page.getByRole('row').filter({ hasText: 'Postgres connections' });
  await expect(conn).toContainText('Warning');
  await expect(conn).toContainText('warn > 75% · critical > 90%');
  await expect(page.getByRole('row').filter({ hasText: 'Postgres WAL archived' })).toContainText('20 min ago');

  const stmt = page.getByRole('row').filter({ hasText: 'usage_month_totals_tracking' });
  await expect(stmt).toContainText('9.9 s');
  await expect(stmt).toContainText('7.25 ms');

  const pool = page.getByRole('row').filter({ hasText: 'fsn-2' }).filter({ hasText: '16 of 16' });
  await expect(pool).toContainText('Critical');
  await expect(pool).toContainText('12.5 ms');

  await expect(page.getByRole('row').filter({ hasText: 'fsn-3' }).filter({ hasText: '6 subs' })).toContainText('Disconnected');
});
