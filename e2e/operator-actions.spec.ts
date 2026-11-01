import { readFile } from 'node:fs/promises';
import { DEPLOYMENT, RELEASE_NEW, expect, openWorkload, stepUp, test } from './fixtures';

test('an instance is force-parked from the tenant workspace, after a step-up', async ({ page, mock }) => {
  await openWorkload(page);
  const parked = page.getByRole('row').filter({ hasText: 'parked' });
  await expect(parked.getByRole('button', { name: 'Park…' })).toBeDisabled();
  await expect(parked.getByRole('button', { name: 'Restart…' })).toBeDisabled();
  await expect(page.getByRole('row').filter({ hasText: 'waking' }).getByRole('button', { name: 'Restart…' })).toBeDisabled();

  await page.getByRole('row').filter({ hasText: 'node-a' }).filter({ hasText: 'running' }).getByRole('button', { name: 'Park…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Force park: checkout-api' });
  await dialog.getByRole('button', { name: 'stuck_instance' }).click();
  await dialog.getByRole('button', { name: 'Force park', exact: true }).click();
  await stepUp(page);

  await expect(page.getByText(/Force park queued for c0ffee00/)).toBeVisible();
  await expect(page.getByRole('link', { name: /1 running/ })).toBeVisible();

  // The write was refused for step-up, then replayed with the same key.
  const parks = (await mock.requests()).filter((r) => r.path.endsWith('/force-park'));
  expect(parks.map((r) => r.status)).toEqual([403, 202]);
  expect(parks[0].idempotencyKey).toBeTruthy();
  expect(parks[1].idempotencyKey).toBe(parks[0].idempotencyKey);
  expect(parks[1].search).toContain('reason=stuck_instance');
});

test('stale deployments are found in a dry run, then cancelled as one batch', async ({ page, mock }) => {
  await page.goto('/deployments');
  await page.getByRole('button', { name: 'Repair stale…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Repair stale deployments' });
  await dialog.getByRole('button', { name: 'Find stale deployments' }).click();
  await expect(dialog.getByText(/Dry run: 2 deployments created before/)).toBeVisible();
  expect((await mock.requests()).some((r) => r.path.includes('/cancel'))).toBe(false);

  await dialog.getByRole('button', { name: 'Cancel 2 deployments…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Cancel 2 stale deployments' });
  await confirm.getByLabel(/to confirm/).fill('cancel 2');
  await confirm.getByRole('button', { name: 'Cancel deployments' }).click();
  await stepUp(page);

  await expect(dialog.getByRole('status')).toHaveText('Cancelled 1 · skipped 1 (active build)');
  await expect(dialog.getByRole('row').filter({ hasText: 'Skipped: build active' })).toHaveCount(1);

  const cancels = (await mock.requests()).filter((r) => r.path.endsWith('/cancel') && r.status === 200);
  expect(cancels.map((r) => r.path)).toEqual([`/v1/admin/ops/deployments/${DEPLOYMENT}/cancel`]);
  expect(cancels[0].search).toContain('reason=stale_deployment_reconciler');
});

test('the release check shows which active nodes lag behind', async ({ page }) => {
  await page.goto('/nodes?view=release');
  await page.getByTitle(`Check against ${RELEASE_NEW}`).click();
  await expect(page).toHaveURL(new RegExp(`[?&]release=${RELEASE_NEW}`));
  await expect(page.getByText('1 of 2 active nodes are not ready on a3f9c2d1e8…')).toBeVisible();
  const table = page.getByRole('table').filter({ hasText: 'Reported release' });
  await expect(table.getByRole('row').filter({ hasText: 'node-a' })).toContainText('Ready');
  await expect(table.getByRole('row').filter({ hasText: 'node-b' })).toContainText('Different release');
});

test('an incident downloads as the gregalectl bundle format', async ({ page }) => {
  await page.goto(`/incidents?incident=deployment%2F${DEPLOYMENT}`);
  const dialog = page.getByRole('dialog', { name: 'Incident · Deployment' });
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download bundle' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(new RegExp(`^incident-deployment-${DEPLOYMENT}-.+Z\\.json$`));

  const bundle = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(bundle.schema_version).toBe('gregale.operator.incident-bundle/v1');
  expect(bundle.incident_id).toBe(`deployment/${DEPLOYMENT}`);
  expect(Object.keys(bundle)).toEqual(expect.arrayContaining(['evidence', 'context', 'health', 'rule_health', 'coverage', 'redaction', 'limitations']));
  expect(bundle.coverage.unhealthy_signals).toEqual(['alerts_firing']);
  expect(bundle.redaction.profile).toBe('operator-metadata-only');
});
