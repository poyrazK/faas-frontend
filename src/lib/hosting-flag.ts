// Next inlines this explicit, default-off operations-preview flag at build time.
// Apid independently enforces its runtime flag, operator allowlist, and MFA.
export const hostingDashboardEnabled = process.env.NEXT_PUBLIC_FRONTEND_HOSTING_ENABLED === 'true';
