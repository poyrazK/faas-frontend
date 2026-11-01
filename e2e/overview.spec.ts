import { DEPLOYMENT, expect, test } from './fixtures';

test('the overview leads with what needs attention, and each row opens it', async ({ page }) => {
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  // One failed deployment, one stale node incident, and alerts needing an owner.
  await expect(page.getByText('3 things need attention')).toBeVisible();
  const list = page.locator('ul').filter({ has: page.getByText('checkout-api deployment failed: build_failed') });
  await expect(list.getByRole('link')).toHaveText([
    /checkout-api deployment failed: build_failed/,
    /node-c heartbeat stale/,
    /2 platform alerts need an owner or acknowledgment/,
  ]);
  await expect(page.getByText('This list may be missing problems')).toHaveCount(0);

  await list.getByRole('link', { name: /checkout-api deployment failed/ }).click();
  await expect(page).toHaveURL(`/incidents?incident=deployment%2F${DEPLOYMENT}`);
  await expect(page.getByRole('dialog', { name: 'Incident · Deployment' })).toBeVisible();
});

test('deployments failing the same way share one row, which opens them on the Deployments page', async ({ page }) => {
  // apid's summary for a failure without an error code, on three deployments.
  const failed = (n: number, slug: string) => ({
    id: `deployment/fa11ed0${n}-0000-4000-8000-000000000000`, type: 'deployment', severity: 'error', status: 'failed', summary: 'deployment failed',
    account_id: `acc0000${n}-0000-4000-8000-000000000000`, resource_id: `fa11ed0${n}-0000-4000-8000-000000000000`, resource_name: slug,
    observed_at: new Date(Date.now() - n * 60_000).toISOString(), dedupe_key: `deployment/fa11ed0${n}`,
  });
  await page.route((url) => url.pathname === '/v1/admin/obs/incidents', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.items.push(failed(1, 'h14-fn'), failed(2, 'h14-py'), failed(3, 'h14-fn'));
    await route.fulfill({ response, json: body });
  });
  await page.goto('/overview');
  await expect(page.getByText('4 things need attention')).toBeVisible();
  const row = page.getByRole('link', { name: /3 deployments failed/ });
  await expect(row).toContainText('Deployments · h14-fn, h14-py');
  await expect(row).toHaveAttribute('href', '/deployments?status=failed');
  // The deployment with its own failure keeps its own row.
  await expect(page.getByRole('link', { name: /checkout-api deployment failed: build_failed/ })).toBeVisible();

  await row.click();
  await expect(page).toHaveURL('/deployments?status=failed');
  await expect(page.getByRole('heading', { name: 'Failure causes' })).toBeVisible();
});

test('a missing signal is reported instead of an all-clear', async ({ page }) => {
  await page.route('**/v1/admin/obs/incidents/platform_alert/summary', (route) =>
    route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unavailable', status: 503, code: 'capacity', detail: 'alert store is down' }) }),
  );
  await page.goto('/overview');
  await expect(page.getByText('This list may be missing problems')).toBeVisible();
  await expect(page.getByText('Alert summary: alert store is down')).toBeVisible();
});

test('platform admin pages are folded away until opened, and stay open', async ({ page }) => {
  await page.goto('/overview');
  const nav = page.getByRole('navigation', { name: 'Operations' });
  await expect(nav.getByRole('link', { name: 'Incidents' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Platform flags' })).toHaveCount(0);

  await nav.getByRole('button', { name: 'Platform admin' }).click();
  await expect(nav.getByRole('link', { name: 'Platform flags' })).toBeVisible();
  await page.reload();
  await expect(nav.getByRole('link', { name: 'Platform flags' })).toBeVisible();

  // A folded section opens by itself when one of its pages is open.
  await nav.getByRole('button', { name: 'Platform admin' }).click();
  await page.goto('/flags');
  await expect(nav.getByRole('link', { name: 'Platform flags' })).toHaveAttribute('aria-current', 'page');
});
