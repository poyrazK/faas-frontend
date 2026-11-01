import { ACCOUNT, DEPLOYMENT, expect, test } from './fixtures';

test('a deployment row opens its panel by click or keyboard, and its menu filters the list', async ({ page }) => {
  await page.goto('/deployments');
  const row = page.getByRole('row', { name: /Open deployment 7a1b2c3d…/ }).first();
  await row.getByRole('cell').nth(2).click();
  await expect(page).toHaveURL(`/deployments?deployment=${DEPLOYMENT}`);
  await page.getByRole('dialog', { name: 'Deployment · checkout-api' }).getByRole('button', { name: 'Close' }).click();

  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Deployment · checkout-api' })).toBeVisible();
  await page.keyboard.press('Escape');

  await row.getByRole('button', { name: /Actions for deployment/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Open deployment', 'Show only this app', 'Show only this account', 'Open tenant', 'Copy deployment ID']);
  await menu.getByRole('menuitem', { name: 'Show only this account' }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]account=${ACCOUNT}`));
  await expect(menu).toBeHidden();
});

test('an incident row’s menu carries its console links', async ({ page }) => {
  await page.goto('/incidents');
  const row = page.getByRole('row', { name: /Open incident: checkout-api deployment failed/ });
  await row.getByRole('button', { name: /Actions for incident/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Go to deployment' })).toHaveAttribute('href', `/deployments?deployment=${DEPLOYMENT}`);
  await expect(menu.getByRole('menuitem', { name: 'Go to tenant' })).toHaveAttribute('href', `/tenants/${ACCOUNT}`);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await row.click();
  await expect(page.getByRole('dialog', { name: 'Incident · Deployment' })).toBeVisible();
});

test('a tenant opens from its row, is named, and keeps suspension behind More', async ({ page }) => {
  await page.goto('/tenants');
  await page.getByRole('row', { name: 'Open tenant 11111111…' }).click();
  await expect(page).toHaveURL(`/tenants/${ACCOUNT}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('org ada-labs');

  await expect(page.getByRole('button', { name: /Suspend account/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Suspend account…' }).click();
  await expect(page.getByRole('dialog', { name: /Suspend/ })).toBeVisible();
});

test('a node row’s menu opens its heartbeats', async ({ page }) => {
  await page.goto('/nodes');
  const row = page.getByRole('row', { name: 'Open node node-b' });
  await row.getByRole('button', { name: 'Actions for node-b' }).click();
  await page.getByRole('menuitem', { name: 'Heartbeats (30 min)' }).click();
  await expect(page).toHaveURL(/[?&]heartbeats=node-b/);
  await expect(page.getByRole('dialog', { name: /Heartbeats · node-b/ })).toBeVisible();
});
