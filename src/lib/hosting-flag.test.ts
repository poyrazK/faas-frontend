import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('requires explicit lowercase true to enable the dashboard (%s)', async (value) => {
  vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_ENABLED', value);
  vi.resetModules();
  expect((await import('./hosting-flag')).hostingDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('custom domains require a separate explicit build opt-in (%s)', async (value) => {
  vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_DOMAINS_ENABLED', value);
  vi.resetModules();
  const flags = await import('./hosting-flag');
  expect(flags.hostingDashboardEnabled).toBe(true);
  expect(flags.hostingDomainsDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('traffic analytics require a separate explicit build opt-in (%s)', async (value) => {
  vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_ANALYTICS_ENABLED', value);
  vi.resetModules();
  expect((await import('./hosting-flag')).hostingAnalyticsDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('release configuration requires an explicit build opt-in (%s)', async (value) => {
  vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_CONFIG_ENABLED', value); vi.resetModules();
  expect((await import('./hosting-flag')).hostingConfigDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('private previews require a separate explicit build opt-in (%s)', async (value) => {
 vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_PREVIEWS_ENABLED', value); vi.resetModules();
 expect((await import('./hosting-flag')).hostingPreviewsDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('release history requires a separate explicit build opt-in (%s)', async (value) => {
 vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_HISTORY_ENABLED', value); vi.resetModules();
 expect((await import('./hosting-flag')).hostingHistoryDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('retention requires a separate explicit build opt-in (%s)', async (value) => {
 vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_RETENTION_ENABLED', value); vi.resetModules();
 expect((await import('./hosting-flag')).hostingRetentionDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('OIDC requires a separate explicit build opt-in (%s)', async (value) => {
 vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_OIDC_ENABLED', value); vi.resetModules();
 const {hostingOIDCDashboardEnabled} = await import('./hosting-flag');
 expect(hostingOIDCDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('diagnostics requires an independent build opt-in (%s)', async (value) => {
 vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_DIAGNOSTICS_ENABLED', value); vi.resetModules();
 const {hostingDiagnosticsDashboardEnabled} = await import('./hosting-flag');
 expect(hostingDiagnosticsDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('CI setup requires an independent build opt-in (%s)', async (value) => {
 vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_CI_SETUP_ENABLED', value); vi.resetModules();
 expect((await import('./hosting-flag')).hostingCISetupDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('activity requires its own build opt-in (%s)', async (value) => {
 vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_ACTIVITY_ENABLED', value); vi.resetModules();
 expect((await import('./hosting-flag')).hostingActivityDashboardEnabled).toBe(value === 'true');
});

it.each([undefined, '', 'false', '1', 'TRUE', 'true'])('preview reservations require their own build opt-in (%s)', async (value) => {
 vi.stubEnv('NEXT_PUBLIC_FRONTEND_HOSTING_PREVIEW_RESERVATIONS_ENABLED', value); vi.resetModules();
 expect((await import('./hosting-flag')).hostingPreviewReservationsDashboardEnabled).toBe(value === 'true');
});
