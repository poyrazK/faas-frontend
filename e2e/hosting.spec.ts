import { expect, HOSTING_RUN_EXPIRED, HOSTING_RUN_OK, HOSTING_SITE, stepUp, test } from './fixtures';

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

test('site views are tabs with their own URL, starting with what is live', async ({ page }) => {
  await page.goto(`/hosting/${HOSTING_SITE}`);
  const tabs = page.getByRole('tablist', { name: 'Hosting site views' });
  await expect(tabs.getByRole('tab', { name: 'Access' })).toHaveAttribute('aria-selected', 'true');

  await tabs.getByRole('tab', { name: 'Releases' }).click();
  await expect(page).toHaveURL(/[?&]tab=releases/);
  await expect(page.getByText('Generation 8 is waiting to publish (7 is live). 2 retries so far, last error provider_timeout.')).toBeVisible();
  await expect(page.getByText('Nothing needs retrying.')).toBeVisible();
  await expect(page.getByRole('row', { name: /f1a00000/ }).first()).toContainText('Live');
  await expect(page.getByRole('row', { name: /f2b00000/ }).first()).toContainText('Uploading');
  await expect(page.getByRole('row', { name: /6 → 7/ })).toContainText('Session');

  await page.reload();
  await expect(tabs.getByRole('tab', { name: 'Releases' })).toHaveAttribute('aria-selected', 'true');
});

test('a CI run opens its diagnostics, and the run is in the URL', async ({ page }) => {
  await page.goto(`/hosting/${HOSTING_SITE}?tab=activity`);
  await page.getByRole('row', { name: 'Open run b2b00000…' }).click();
  await expect(page).toHaveURL(new RegExp(`run=${HOSTING_RUN_EXPIRED}`));
  const dialog = page.getByRole('dialog', { name: 'CI run b2b00000…' });
  await expect(dialog).toContainText('The original CI preview window has expired.');
  await expect(dialog).toContainText('Inspect the blocked or unknown checks before retrying anything.');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page).not.toHaveURL(/run=/);

  await page.goto(`/hosting/${HOSTING_SITE}?tab=activity&run=${HOSTING_RUN_OK}`);
  await expect(page.getByRole('dialog', { name: 'CI run b1a00000…' })).toContainText('Nothing needs retrying.');
});

test('domains show the DNS records still to set, and previews their state', async ({ page }) => {
  await page.goto(`/hosting/${HOSTING_SITE}?tab=domains`);
  const pending = page.getByRole('row', { name: /docs\.gregale\.dev/ }).first();
  await expect(pending).toContainText('Pending DNS');
  await expect(pending).toContainText('dns_not_found');
  await expect(page.getByText('Still to set in DNS:')).toBeVisible();
  await expect(page.getByText('_gregale-challenge.docs.gregale.dev')).toBeVisible();
  await expect(page.getByRole('row', { name: /www\.gregale\.dev/ })).toContainText('Active');
  await expect(page.getByRole('row', { name: /redesign-b1a00000/ })).toContainText('Live');
  await expect(page.getByRole('row', { name: /main-b2b00000/ })).toContainText('Expired');
});

test('putting an older release live is a rollback, sent with an idempotency key', async ({ page, mock }) => {
  await page.goto(`/hosting/${HOSTING_SITE}?tab=releases`);
  await page.getByRole('button', { name: 'Actions for release f3c00000…' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Put live…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Put release live' });
  await expect(dialog).toContainText('replacing f1a00000…');
  await expect(dialog).toContainText('To undo, put f1a00000… live again');
  await dialog.getByRole('button', { name: 'Put live' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('row', { name: /f3c00000/ }).first()).toContainText('Live');
  await expect(page.getByRole('row', { name: /7 → 8/ })).toBeVisible();
  const posts = (await mock.requests()).filter((r) => r.method === 'POST' && r.path.endsWith('/promotions'));
  expect(posts.map((r) => r.status)).toEqual([202]);
  expect(posts[0].idempotencyKey).toBeTruthy();
});

test('a stale site revision refreshes the page instead of acting on old data', async ({ page, mock }) => {
  await page.goto(`/hosting/${HOSTING_SITE}?tab=releases`);
  await expect(page.getByRole('row', { name: /f3c00000/ }).first()).toBeVisible();
  await mock.set({ siteRevision: 9 });

  await page.getByRole('button', { name: 'Actions for release f3c00000…' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Put live…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Put release live' });
  const refreshed = page.waitForResponse((r) => r.url().endsWith(`/v1/internal/hosting/sites/${HOSTING_SITE}`) && r.request().method() === 'GET');
  await dialog.getByRole('button', { name: 'Put live' }).click();
  await expect(dialog.getByRole('alert')).toContainText('The page has been refreshed');
  await refreshed;

  // The refreshed revision goes out with the next attempt.
  await dialog.getByRole('button', { name: 'Put live' }).click();
  await expect(dialog).toBeHidden();
  const posts = (await mock.requests()).filter((r) => r.method === 'POST' && r.path.endsWith('/promotions'));
  expect(posts.map((r) => r.status)).toEqual([409, 202]);
});

test('suspending a site needs its name typed, and resuming serves it again', async ({ page }) => {
  await page.goto(`/hosting/${HOSTING_SITE}`);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Suspend site…' }).click();
  const suspend = page.getByRole('dialog', { name: 'Suspend site' });
  await expect(suspend.getByRole('button', { name: 'Suspend site' })).toBeDisabled();
  await suspend.getByLabel('Type website to confirm').fill('website');
  await suspend.getByRole('button', { name: 'Suspend site' }).click();
  await expect(suspend).toBeHidden();
  await expect(page.getByText('Suspended', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Resume site…' }).click();
  const resume = page.getByRole('dialog', { name: 'Resume site' });
  await resume.getByRole('button', { name: 'Resume site' }).click();
  await expect(resume).toBeHidden();
  await expect(page.getByText('Suspended', { exact: true })).toHaveCount(0);
});

test('canceling a run is offered only where apid allows it, and revokes its preview', async ({ page }) => {
  await page.goto(`/hosting/${HOSTING_SITE}?tab=activity`);
  // That run's release was live once, so apid protects it.
  await page.getByRole('button', { name: 'Actions for run b2b00000…' }).click();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Cancel run…' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Actions for run b1a00000…' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Cancel run…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel CI run' });
  await expect(dialog).toContainText('Production is not affected');
  await dialog.getByRole('button', { name: 'Cancel run' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: 'Open run b1a00000…' })).toContainText('Canceled');

  await page.getByRole('tab', { name: 'Domains & previews' }).click();
  await expect(page.getByRole('row', { name: /redesign-b1a00000/ })).toContainText('Revoked');
});

test('an unbound domain create is recovered with a reviewed provider ID, then removed; a preview is revoked', async ({ page }) => {
  await page.goto(`/hosting/${HOSTING_SITE}?tab=domains`);
  await page.getByRole('button', { name: 'Actions for domain shop.gregale.dev' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Bind reviewed provider ID…' }).click();
  const recover = page.getByRole('dialog', { name: 'Bind reviewed provider ID' });
  await expect(recover.getByRole('link', { name: 'Recovery procedure' })).toHaveAttribute('href', /internal-frontend-hosting-domains/);
  await recover.getByLabel('Cloudflare custom hostname ID').fill('0f8fad5b-d9cb-469f-a165-70867728950e');
  await recover.getByLabel('Type shop.gregale.dev to confirm').fill('shop.gregale.dev');
  await recover.getByRole('button', { name: 'Bind provider ID' }).click();
  await expect(recover).toBeHidden();

  await page.reload();
  await page.getByRole('button', { name: 'Actions for domain shop.gregale.dev' }).click();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Bind reviewed provider ID…' })).toHaveCount(0);
  await page.getByRole('menu').getByRole('menuitem', { name: 'Remove domain…' }).click();
  const remove = page.getByRole('dialog', { name: 'Remove custom domain' });
  await remove.getByLabel('Type shop.gregale.dev to confirm').fill('shop.gregale.dev');
  await remove.getByRole('button', { name: 'Remove domain' }).click();
  await expect(remove).toBeHidden();
  await expect(page.getByRole('row', { name: /shop\.gregale\.dev/ }).first()).toContainText('Deleting');

  await page.getByRole('button', { name: 'Actions for preview main-b2b00000.preview.gregale.site' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Revoke preview…' }).click();
  const revoke = page.getByRole('dialog', { name: 'Revoke preview' });
  await revoke.getByRole('button', { name: 'Revoke preview' }).click();
  await expect(revoke).toBeHidden();
  await expect(page.getByRole('row', { name: /main-b2b00000/ })).toContainText('Revoked');
});
