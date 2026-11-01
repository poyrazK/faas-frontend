import { expect, test } from './fixtures';

test('failed deployments are grouped by cause, and a cause lists only its deployments', async ({ page, mock }) => {
  await page.goto('/deployments');
  const causes = page.locator('.card', { has: page.getByRole('heading', { name: 'Failure causes' }) });
  await expect(causes).toContainText('10 failed deployments');
  const items = causes.getByRole('listitem');
  await expect(items).toHaveCount(5);

  // The builder disk error repeats with different sizes: one cause, most frequent first.
  const disk = items.first();
  await expect(disk).toContainText('insufficient host free space for build drive: available=N bytes, required=N bytes');
  await expect(disk).toContainText('3 apps · 2 accounts');
  await expect(items.nth(1)).toContainText('capacity_unavailable');
  // Exit statuses name the failure, so they are kept.
  await expect(items.nth(2)).toContainText('build exited 1');
  await causes.getByRole('button', { name: 'Show all 6 causes' }).click();
  await expect(items).toHaveCount(6);
  // A crash log is cut to three lines; the tooltip has the whole error.
  const crash = items.last().locator('[title^="app_startup_crash: snapshot prime failed"]');
  await expect(crash).toContainText('workload stopped during startup (guest <id> exited before becoming ready)');
  expect((await crash.boundingBox())!.height).toBeLessThan(60);

  await disk.getByRole('button', { name: 'Show all 3' }).click();
  await expect(page).toHaveURL(/[?&]cause=[0-9a-f]{8}/);
  await expect(page.getByText('Failed deployments with one cause:')).toBeVisible();
  const rows = page.getByRole('row', { name: /Open deployment/ });
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'my-first-api' })).toHaveCount(1);
  await expect(disk.getByRole('button', { name: 'Shown below' })).toHaveAttribute('aria-pressed', 'true');

  // The cause is in the URL, so the filtered view survives a reload and can be shared.
  await page.reload();
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: 'Show all deployments' }).click();
  await expect(page).not.toHaveURL(/cause=/);
  await expect(rows).toHaveCount(12);

  const lists = (await mock.requests()).filter((r) => r.path === '/v1/admin/ops/deployments');
  expect(lists.some((r) => /status=failed/.test(r.search) && /limit=200/.test(r.search))).toBe(true);
});

test('failure causes stay out of views without failed deployments', async ({ page }) => {
  await page.goto('/deployments?status=in_flight');
  await expect(page.getByRole('row', { name: /Open deployment/ })).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Failure causes' })).toHaveCount(0);
});
