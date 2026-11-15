import { ACCOUNT, expect, stepUp, test, TICKET_OPEN } from './fixtures';

/*
 * Support inbox and customer queues (apid pkg/apid/support, ADR-20261115120000):
 * tickets with their SLA clock, the conversation and staff actions, the
 * account behind a ticket, and the counts on the Overview and sidebar.
 */

test('the inbox lists tickets and filters by status and owner', async ({ page }) => {
  await page.goto('/support');
  await expect(page.getByRole('heading', { level: 1, name: 'Support inbox' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Deploys fail with npm ci' });
  await expect(row).toContainText('2 new');
  await expect(row).toContainText('First response');
  await expect(row).toContainText('Unassigned');
  await expect(page.getByRole('row').filter({ hasText: 'keeps running out of memory' })).toHaveCount(0);

  await page.getByRole('combobox').first().selectOption('all');
  await page.getByLabel('Assigned to me').check();
  const mine = page.getByRole('row').filter({ hasText: 'keeps running out of memory' });
  await expect(mine).toContainText('Waiting on customer');
  await expect(mine).toContainText('You');
  await expect(page.getByRole('row').filter({ hasText: 'Deploys fail with npm ci' })).toHaveCount(0);
});

test('a ticket shows the conversation, the account behind it and marks itself read', async ({ page, mock }) => {
  await page.goto(`/support/${TICKET_OPEN}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Deploys fail with npm ci' })).toBeVisible();
  await expect(page.getByText('Every deploy of checkout-api fails at npm ci')).toBeVisible();
  await expect(page.locator('ol').getByText('Internal note')).toBeVisible();
  await expect(page.getByText('When they wrote in')).toBeVisible();
  await expect(page.getByText('A payment failed')).toBeVisible();
  await expect(page.getByText('New since they wrote in:')).toBeVisible();
  await expect(page.getByText(/refused with/)).toContainText('deploy_failed');
  await expect(page.getByRole('link', { name: 'Open account →' })).toHaveAttribute('href', new RegExp(ACCOUNT));
  await expect(page.getByRole('heading', { name: 'Diagnosis', exact: true })).toBeVisible();
  await expect.poll(async () => (await mock.requests()).some((r) => r.method === 'POST' && r.path.endsWith(`/tickets/${TICKET_OPEN}/read`))).toBe(true);
});

test('operators reply and take a ticket', async ({ page }) => {
  await page.goto(`/support/${TICKET_OPEN}`);
  await page.getByRole('button', { name: 'Reply to customer' }).click();
  const reply = page.getByRole('dialog', { name: 'Reply to customer' });
  await reply.getByLabel('Message to the customer').fill('Your lockfile needs npm 10. Regenerate it and redeploy.');
  await reply.getByRole('button', { name: 'Send reply' }).click();
  await stepUp(page);
  await expect(reply).toBeHidden();
  await expect(page.getByText('Your lockfile needs npm 10.')).toBeVisible();

  await page.getByRole('button', { name: 'Assign to me' }).click();
  const triage = page.getByRole('dialog', { name: 'Triage ticket' });
  await triage.getByLabel('Reason').fill('taking it');
  await triage.getByRole('button', { name: 'Save' }).click();
  await expect(triage).toBeHidden();
  await expect(page.getByText('You', { exact: true })).toBeVisible();
});

test('the overview and sidebar count stuck customers and unread support updates', async ({ page }) => {
  await page.goto('/overview');
  const card = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Customers', exact: true }) }).first();
  await expect(card).toContainText('2 open signals on 2 accounts');
  await expect(card).toContainText('2 unread updates');
  const nav = page.getByRole('navigation', { name: 'Operations' });
  await expect(nav.getByRole('link', { name: /Stuck customers/ })).toContainText('2');
  await expect(nav.getByRole('link', { name: /Support inbox/ })).toContainText('2');
});

test('tenant search finds any account in one request', async ({ page }) => {
  await page.goto('/tenants');
  await page.getByPlaceholder('Email, app slug, domain, URL or ID…').fill('checkout-api');
  await page.getByRole('button', { name: 'Search every account', exact: true }).click();
  await expect(page.getByText('Every account matching “checkout-api”')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open account' }).first()).toHaveAttribute('href', new RegExp(ACCOUNT));

  // An exact email match opens the account; the jump box arrives with ?q=.
  await page.goto('/tenants?q=ada%40customer.test');
  await expect(page).toHaveURL(new RegExp(`/tenants/${ACCOUNT}`));
});

test('the tenant overview shows signal history and leaves failures to the diagnosis', async ({ page }) => {
  await page.goto(`/tenants/${ACCOUNT}`);
  const history = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Signal history', exact: true }) }).first();
  await expect(history.getByRole('row').filter({ hasText: 'checkout-api' })).toContainText('Contacted');
  await expect(history.getByRole('link', { name: 'ticket' })).toHaveAttribute('href', /\/support\/a1000000-0000-4000-8000-000000000042/);
  await expect(history.getByRole('row').filter({ hasText: 'shop.example' })).toContainText('Cleared on its own');
  await expect(page.getByRole('heading', { name: 'In flight and incidents' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toHaveCount(0);
});
