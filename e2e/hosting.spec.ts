import { expect, HOSTING_SITE, stepUp, test } from './fixtures';

const CREDENTIALS = `/v1/internal/hosting/sites/${HOSTING_SITE}/automation-credentials`;

test('the site list opens a site with its credentials and trusts', async ({ page }) => {
  await page.goto('/hosting');
  const row = page.getByRole('row', { name: /Open site website/ });
  await expect(row).toContainText('website.gregale.site');
  await row.click();

  await expect(page).toHaveURL(new RegExp(`/hosting/${HOSTING_SITE}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'website' })).toBeVisible();
  await expect(page.getByText(`gregale:hosting:${HOSTING_SITE}`).first()).toBeVisible();
  await expect(page.getByRole('row', { name: /github-actions main/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /old-ci/ })).toContainText('Expired');
  await expect(page.getByRole('row', { name: /gregale\/website/ })).toContainText('deploy.yml');
});

test('a new credential needs a step-up, is shown once, and is sent without an idempotency key', async ({ page, mock }) => {
  await page.goto(`/hosting/${HOSTING_SITE}`);
  await page.getByRole('button', { name: 'New credential' }).click();
  const dialog = page.getByRole('dialog', { name: 'New automation credential' });
  await dialog.getByLabel('Label').fill('deploy-bot');
  await dialog.getByLabel(/Publish previews/).uncheck();
  await dialog.getByLabel('Expires after').selectOption({ label: '7 days' });
  await expect(dialog).toContainText('stage releases on website.gregale.site for 7 days');
  await dialog.getByRole('button', { name: 'Issue credential' }).click();
  await stepUp(page);

  const reveal = page.getByRole('dialog', { name: 'Copy the new credential' });
  await expect(reveal.getByLabel('Token for deploy-bot')).toHaveValue(/^fp_host_mock1/);
  await expect(reveal.getByRole('button', { name: 'Done' })).toBeDisabled();
  // Escape cannot throw the token away before the operator confirms they stored it.
  await page.keyboard.press('Escape');
  await expect(reveal.getByRole('alert')).toContainText('cannot be shown again');
  await reveal.getByLabel('I have stored this token').check();
  await reveal.getByRole('button', { name: 'Done' }).click();
  await expect(reveal).toBeHidden();
  await expect(page.getByText(/fp_host_mock1/)).toHaveCount(0);
  await expect(page.getByRole('row', { name: /deploy-bot/ })).toContainText('stage');

  const posts = (await mock.requests()).filter((r) => r.method === 'POST' && r.path === CREDENTIALS);
  expect(posts.map((r) => r.status)).toEqual([403, 201]);
  expect(posts.every((r) => r.idempotencyKey === null)).toBe(true);
});

test('revoking a credential removes it', async ({ page }) => {
  await page.goto(`/hosting/${HOSTING_SITE}`);
  await page.getByRole('button', { name: 'Actions for credential old-ci' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Revoke credential' }).click();
  const dialog = page.getByRole('dialog', { name: 'Revoke automation credential' });
  await expect(dialog).toContainText('refused from its next request');
  await dialog.getByRole('button', { name: 'Revoke credential' }).click();
  await stepUp(page);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: /old-ci/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /github-actions main/ })).toBeVisible();
});

test('a GitHub trust is built from what an operator pastes', async ({ page }) => {
  await page.goto(`/hosting/${HOSTING_SITE}`);
  await page.getByRole('button', { name: 'New trust' }).click();
  const dialog = page.getByRole('dialog', { name: 'New GitHub OIDC trust' });
  await dialog.getByLabel('Repository', { exact: true }).fill('https://github.com/gregale/docs.git');
  await dialog.getByLabel('Owner ID').fill('1234567');
  await dialog.getByLabel('Repository ID').fill('555');
  await dialog.getByLabel('Workflow file').fill('.github/workflows/publish.yml');
  await expect(dialog).toContainText('gh api repos/gregale/docs');
  await expect(dialog).toContainText('Matches workflow gregale/docs/.github/workflows/publish.yml@refs/heads/main on push');
  await dialog.getByRole('button', { name: 'Add trust' }).click();
  await stepUp(page);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: /gregale\/docs/ })).toContainText('publish.yml');
});

test('switched-off OIDC is explained instead of shown as an error', async ({ page, mock }) => {
  await mock.set({ oidc: false });
  await page.goto(`/hosting/${HOSTING_SITE}`);
  await expect(page.getByRole('heading', { name: 'GitHub OIDC is not available' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New trust' })).toBeDisabled();
  await expect(page.getByRole('row', { name: /github-actions main/ })).toBeVisible();
});

test('a site the operator does not own says so', async ({ page }) => {
  await page.goto('/hosting/d0000000-0000-4000-8000-00000000ffff');
  await expect(page.getByRole('heading', { name: 'No such site' })).toBeVisible();
});
