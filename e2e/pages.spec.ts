import { OPS_ROUTES } from '../src/lib/routes';
import { expect, test } from './fixtures';

/*
 * Every sidebar page renders its heading against the mock, even where the
 * mock has no data for it (those sections show their own error state). A
 * page that crashes shows the error screen instead, and fails here.
 */
for (const route of OPS_ROUTES) {
  test(`${route.label} loads`, async ({ page }) => {
    const crashes: string[] = [];
    page.on('pageerror', (error) => crashes.push(error.message));
    await page.goto(`/${route.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: route.label, exact: true })).toBeVisible();
    await expect(page.getByText('This page failed to render')).toHaveCount(0);
    expect(crashes).toEqual([]);
  });
}

test('a malformed section is contained instead of taking the page down', async ({ page }) => {
  // Rule health without its totals or rule list.
  await page.route('**/v1/admin/obs/rule-health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ generated_at: new Date().toISOString(), state: 'unknown', reason: 'source_unreadable' }) }),
  );
  await page.goto('/telemetry');
  await expect(page.getByRole('heading', { level: 1, name: 'Telemetry health', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Loaded alert rules' })).toBeVisible();
  await expect(page.getByText('This page failed to render')).toHaveCount(0);
});

test('compute nodes are split into linkable views', async ({ page }) => {
  await page.goto('/nodes');
  const tabs = page.getByRole('tablist', { name: 'Compute node views' });
  await expect(tabs.getByRole('tab', { name: 'Hosts' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Hosts' })).toBeVisible();

  await tabs.getByRole('tab', { name: 'Wake latency' }).click();
  await expect(page).toHaveURL(/[?&]view=wake/);
  await expect(page.getByRole('heading', { name: 'Hosts' })).toHaveCount(0);

  await page.goto('/nodes?release=a3f9c2d1e8b74c6f9d0e1a2b3c4d5e6f7a8b9c0d');
  await expect(tabs.getByRole('tab', { name: 'Release' })).toHaveAttribute('aria-selected', 'true');
});
