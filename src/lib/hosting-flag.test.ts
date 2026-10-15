import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('requires explicit lowercase true to enable the dashboard (%s)', async (value) => {
  vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_ENABLED', value);
  vi.resetModules();
  expect((await import('./hosting-flag')).hostingDashboardEnabled).toBe(value === 'true');
});
