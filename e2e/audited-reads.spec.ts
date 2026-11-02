import { ACCOUNT, expect, test } from './fixtures';

// apid records every read of the deployment, job-run and incident lists as an
// operator.action.view audit row, kept for good. The console reads them only
// when it needs to and keeps those views out of lists of operator actions.

test('a deployment list with nothing in flight is not re-read on a timer', async ({ page, mock }) => {
  await page.clock.install();
  const listReads = async (status: string) =>
    (await mock.requests()).filter((r) => r.path === '/v1/admin/ops/deployments' && new URLSearchParams(r.search).get('status') === status && !/limit=200/.test(r.search))
      .length;

  // Failed deployments only: nothing in flight, so no timer.
  await page.goto('/deployments?status=failed');
  await expect(page.getByText(/refreshes on its own only while a deployment is in flight/)).toBeVisible();
  await expect.poll(() => listReads('failed')).toBe(1);
  await page.clock.fastForward('02:30');
  expect(await listReads('failed')).toBe(1);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => listReads('failed')).toBe(2);

  // In flight: the list refreshes every 30 s while a deployment is building.
  await page.goto('/deployments?status=in_flight');
  await expect.poll(() => listReads('pending,building,imaging,snapshotting')).toBe(1);
  await page.clock.fastForward('01:05');
  await expect.poll(() => listReads('pending,building,imaging,snapshotting')).toBeGreaterThan(1);
});

test('recent operator actions leave operators’ views out and count them', async ({ page }) => {
  await page.goto('/overview');
  const card = page.locator('.card', { has: page.getByRole('heading', { name: 'Recent operator actions' }) });
  await expect(card).toContainText('operator.action.app.force_cold_boot');
  await expect(card).toContainText('operator.action.account.credit');
  await expect(card).not.toContainText('operator.action.view');
  await expect(card.getByRole('link', { name: '3 operator views not shown' })).toHaveAttribute('href', '/audit-log?operator=1&views=1');
});

test('the audit trail hides operator views until asked, and says how many', async ({ page }) => {
  await page.goto('/audit-log?operator=1');
  await expect(page.getByText(/3 operator views hidden/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'operator.action.view' })).toHaveCount(0);
  await expect(page.getByText('operator.action.account.credit')).toBeVisible();

  await page.getByRole('button', { name: 'Show them' }).click();
  await expect(page).toHaveURL(/[?&]views=1/);
  await expect(page.getByText(/operator views hidden/)).toHaveCount(0);
  await expect(page.getByText('operator.action.view')).toHaveCount(3);
  await expect(page.getByLabel('Show operator views')).toBeChecked();
});

test('a tenant’s activity leaves operator views out until their filter is on', async ({ page }) => {
  await page.goto(`/tenants/${ACCOUNT}?tab=activity`);
  const views = page.getByRole('button', { name: 'Operator views' });
  await expect(views).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Account credit')).toBeVisible();
  await expect(page.getByText('Operator viewed')).toHaveCount(0);

  await views.click();
  await expect(page.getByText('Operator viewed')).toHaveCount(3);
  await expect(page.getByText('deployments.active')).toBeVisible();
});
