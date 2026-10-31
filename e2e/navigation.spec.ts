import { ACCOUNT, DEPLOYMENT, expect, test } from './fixtures';

test('every page names its browser tab', async ({ page }) => {
  await page.goto('/incidents');
  await expect(page).toHaveTitle('Incidents | Gregale Operations');
  await page.goto(`/tenants/${ACCOUNT}`);
  await expect(page).toHaveTitle('Tenant 11111111… | Gregale Operations');
});

test('an incident link opens that incident with its filters, and links onward', async ({ page }) => {
  await page.goto(`/incidents?type=deployment&incident=deployment%2F${DEPLOYMENT}`);
  const dialog = page.getByRole('dialog', { name: 'Incident · Deployment' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('combobox').first()).toHaveValue('deployment');
  await expect(dialog.getByRole('link', { name: 'Deployment', exact: true })).toHaveAttribute('href', `/deployments?deployment=${DEPLOYMENT}`);
  await expect(dialog.locator('a[href="/lookup?trace=4bf92f3577b34da6a3ce929d0e0e4736"]')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Audit trail' })).toHaveAttribute('href', `/audit-log?kind=deployment.&account=${ACCOUNT}`);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/incidents\?type=deployment$/);
});

test('filters are written to the URL once typing pauses', async ({ page }) => {
  await page.goto('/deployments');
  await page.getByPlaceholder('Account ID (UUID)').fill(ACCOUNT);
  await expect(page).toHaveURL(new RegExp(`[?&]account=${ACCOUNT}`));
  await expect(page.getByText('Scoped to account')).toBeVisible();

  await page.getByRole('combobox').first().selectOption('failed');
  await expect(page).toHaveURL(/[?&]status=failed/);
});

test('a deployment link opens its panel', async ({ page }) => {
  await page.goto(`/deployments?deployment=${DEPLOYMENT}`);
  const dialog = page.getByRole('dialog', { name: 'Deployment · checkout-api' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/deployments$/);
});

test('the jump box opens whatever ID is pasted', async ({ page }) => {
  await page.goto('/overview');
  // The shortcut is live once the signed-in shell has rendered.
  await expect(page.getByRole('heading', { name: 'Fleet Overview' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Jump to' });
  await expect(dialog).toBeVisible();

  // Enter on an empty box opens nothing.
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/overview$/);

  await dialog.getByRole('combobox').fill(DEPLOYMENT.toUpperCase());
  await expect(dialog.getByRole('option')).toHaveText([
    /Tenant with this account ID/,
    /Deployment with this ID/,
    /Job run with this ID/,
    /Deployments of the app with this ID/,
    /Wake with this ID/,
  ]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/deployments?deployment=${DEPLOYMENT}`);
  await expect(page.getByRole('dialog', { name: 'Deployment · checkout-api' })).toBeVisible();
});

test('a tall dialog fits a short window and scrolls inside', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 460 });
  await page.goto('/nodes?node=node-a');
  const dialog = page.getByRole('dialog', { name: 'Node node-a' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(460);
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeInViewport();
  const body = dialog.locator('[data-modal-body]');
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});
