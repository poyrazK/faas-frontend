import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end tests drive the real console against e2e/mock-apid.mjs, a local
 * stand-in for apid. next.config.ts fixes the /v1 rewrite target at build
 * time, so the app is built with APID_BACKEND_URL pointing at the mock.
 * E2E_DEV=1 uses `next dev` instead (faster to start while writing tests).
 * One worker: every test shares the mock's state and resets it first.
 */
const MOCK_PORT = 3199;
const APP_PORT = 3100;
const reuse = !process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mock-apid.mjs',
      url: `http://localhost:${MOCK_PORT}/healthz`,
      env: { MOCK_APID_PORT: String(MOCK_PORT) },
      reuseExistingServer: reuse,
    },
    {
      command: process.env.E2E_DEV ? `npm run dev -- --port ${APP_PORT}` : `npm run build && npm run start -- --port ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/login`,
      env: { APID_BACKEND_URL: `http://localhost:${MOCK_PORT}` },
      timeout: 300_000,
      reuseExistingServer: reuse,
    },
  ],
});
