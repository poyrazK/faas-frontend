// Next inlines this explicit, default-off operations-preview flag at build time.
// Apid independently enforces its runtime flag, operator allowlist, and MFA.
export const hostingDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_ENABLED === 'true';
export const hostingDomainsDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_DOMAINS_ENABLED === 'true';

export const hostingAnalyticsDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_ANALYTICS_ENABLED === 'true';

export const hostingConfigDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_CONFIG_ENABLED === 'true';

export const hostingPreviewsDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_PREVIEWS_ENABLED === 'true';

export const hostingHistoryDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_HISTORY_ENABLED === 'true';

export const hostingRetentionDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_RETENTION_ENABLED === 'true';

export const hostingOIDCDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_OIDC_ENABLED === 'true';

export const hostingDiagnosticsDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_DIAGNOSTICS_ENABLED === 'true';

export const hostingCISetupDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_CI_SETUP_ENABLED === 'true';

export const hostingActivityDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_ACTIVITY_ENABLED === 'true';

export const hostingPreviewReservationsDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_PREVIEW_RESERVATIONS_ENABLED === 'true';
