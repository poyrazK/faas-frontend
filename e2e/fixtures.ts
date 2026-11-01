import { test as base, expect, type Page } from '@playwright/test';

/* Shared setup for the end-to-end suite: every test starts from a fresh mock. */

export const MOCK_URL = 'http://localhost:3199';
export const ACCOUNT = '11111111-2222-4333-8444-555555555555';
export const DEPLOYMENT = '7a1b2c3d-0000-4000-8000-000000000001';
export const RELEASE_NEW = 'a3f9c2d1e8b74c6f9d0e1a2b3c4d5e6f7a8b9c0d';
export const TOTP = '123456';
export const HOSTING_SITE = 'd0000000-0000-4000-8000-000000000001';

export interface MockRequest {
  method: string;
  path: string;
  search: string;
  status: number;
  idempotencyKey: string | null;
}

interface Mock {
  /** Flips mock switches: {"enrolled": false} (no authenticator), {"expired": true} (session gone), {"oidc": false} (hosting OIDC off). */
  set: (switches: { enrolled?: boolean; expired?: boolean; oidc?: boolean }) => Promise<void>;
  /** Requests the console sent since the test started, oldest first. */
  requests: () => Promise<MockRequest[]>;
}

export const test = base.extend<{ mock: Mock }>({
  mock: [
    async ({ request }, use) => {
      await request.post(`${MOCK_URL}/__mock/reset`);
      await use({
        set: async (switches) => {
          await request.post(`${MOCK_URL}/__mock/state`, { data: switches });
        },
        requests: async () => (await request.get(`${MOCK_URL}/__mock/requests`)).json(),
      });
    },
    { auto: true },
  ],
});

export { expect };

/** Answers the step-up prompt with the mock's authenticator code. */
export async function stepUp(page: Page) {
  const dialog = page.getByRole('dialog', { name: "Confirm it's you" });
  await dialog.getByLabel('Authenticator code').fill(TOTP);
  await dialog.getByRole('button', { name: 'Verify' }).click();
  await expect(dialog).toBeHidden();
}

/** Opens the checkout-api workload in the tenant workspace (instances in running, waking and parked states). */
export async function openWorkload(page: Page) {
  await page.goto(`/tenants/${ACCOUNT}?tab=apps`);
  await page.getByRole('button', { name: 'Workload', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Workload · checkout-api' })).toBeVisible();
}
