import { TOTP, expect, openWorkload, test } from './fixtures';

test('an expired session returns to sign-in, keeping the page to come back to', async ({ page, mock }) => {
  await page.goto('/overview');
  // Let the overview's own first reads finish before the session ends.
  await expect(page.getByText('3 things need attention')).toBeVisible();
  await mock.set({ expired: true });
  await page.getByRole('link', { name: 'Emergency controls' }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fcontrols$/);
});

test('an operator without an authenticator enrolls one in place, and the action resumes', async ({ page, mock }) => {
  await mock.set({ enrolled: false });
  await openWorkload(page);
  await page.getByRole('row').filter({ hasText: 'node-a' }).filter({ hasText: 'running' }).getByRole('button', { name: 'Park…' }).click();
  const action = page.getByRole('dialog', { name: 'Force park: checkout-api' });
  await action.getByRole('button', { name: 'stuck_instance' }).click();
  await action.getByRole('button', { name: 'Force park', exact: true }).click();

  const enroll = page.getByRole('dialog', { name: 'Set up your authenticator' });
  await expect(enroll.getByText('JBSWY3DPEHPK3PXP')).toBeVisible();
  await enroll.getByLabel('First code from the app').fill(TOTP);
  await enroll.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(enroll.getByRole('alert')).toHaveText('Save your recovery codes first; they are shown only once.');

  await enroll.getByLabel('I have stored these somewhere safe').check();
  await enroll.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(enroll).toBeHidden();
  await expect(page.getByText(/Force park queued for c0ffee00/)).toBeVisible();
});

test('other sessions can be signed out from the account menu', async ({ page, mock }) => {
  await page.goto('/overview');
  await page.getByRole('button', { name: /operator@ops\.test/ }).click();
  await page.getByRole('menuitem', { name: 'Your sessions…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your sessions' });
  await expect(dialog.getByRole('row').filter({ hasText: 'This browser' })).toContainText('Chrome on macOS');

  const edge = dialog.getByRole('row').filter({ hasText: 'Edge on Windows' });
  await edge.getByRole('button', { name: 'Sign out…' }).click();
  await edge.getByRole('button', { name: 'Sign it out' }).click();
  await expect(page.getByText('Signed out Edge on Windows.')).toBeVisible();
  await expect(dialog.getByRole('row').filter({ hasText: 'Edge on Windows' })).toHaveCount(0);
  expect((await mock.requests()).some((r) => r.method === 'DELETE' && r.path === '/v1/auth/sessions/s0000000-0000-4000-8000-000000000003' && r.status === 204)).toBe(true);
});
