import type { IconName } from '@/components/ui/Icons';

/* ==========================================================================
   The one list of operator pages. The sidebar renders it and proxy.ts maps
   each clean URL (/tenants) onto its route file (app/operations/tenants), so
   adding a page means adding it here and creating the folder — nothing else.
   ========================================================================== */

export interface OpsRoute {
  /** URL segment, identical to the folder under src/app/operations. */
  slug: string;
  label: string;
  icon: IconName;
  group: 'Monitor' | 'Customers' | 'Fleet' | 'Platform';
}

export const OPS_ROUTES: readonly OpsRoute[] = [
  { slug: 'overview', label: 'Fleet overview', icon: 'overview', group: 'Monitor' },
  { slug: 'incidents', label: 'Incidents', icon: 'alerts', group: 'Monitor' },
  { slug: 'anomalies', label: 'Anomalies', icon: 'spark', group: 'Monitor' },
  { slug: 'audit-log', label: 'Audit trail', icon: 'logs', group: 'Monitor' },
  { slug: 'telemetry', label: 'Telemetry health', icon: 'bell', group: 'Monitor' },
  { slug: 'status', label: 'Status page', icon: 'globe', group: 'Monitor' },
  { slug: 'tenants', label: 'Tenants', icon: 'user', group: 'Customers' },
  { slug: 'deployments', label: 'Customer deployments', icon: 'deployments', group: 'Customers' },
  { slug: 'jobs', label: 'Job runs', icon: 'queues', group: 'Customers' },
  { slug: 'repairs', label: 'Data repairs', icon: 'databases', group: 'Customers' },
  { slug: 'metering', label: 'Metering', icon: 'usage', group: 'Customers' },
  { slug: 'lookup', label: 'Support lookup', icon: 'traces', group: 'Customers' },
  { slug: 'rate-limits', label: 'Rate limits', icon: 'shield', group: 'Customers' },
  { slug: 'billing', label: 'Billing catalog', icon: 'plans', group: 'Customers' },
  { slug: 'nodes', label: 'Compute nodes', icon: 'storage', group: 'Fleet' },
  { slug: 'capacity', label: 'Capacity', icon: 'metrics', group: 'Fleet' },
  { slug: 'controls', label: 'Emergency controls', icon: 'bolt', group: 'Fleet' },
  { slug: 'flags', label: 'Platform flags', icon: 'filter', group: 'Platform' },
  { slug: 'configuration', label: 'Runtime configuration', icon: 'settings', group: 'Platform' },
  { slug: 'github', label: 'GitHub recovery', icon: 'code', group: 'Platform' },
];

/** Route folders under app/operations that are reachable but not in the sidebar. */
export const OPS_HIDDEN_SLUGS: readonly string[] = ['login'];

export const OPS_HOME = '/overview';

/** Clean URL for a route; the proxy rewrites it onto app/operations/<slug>. */
export const opsHref = (slug: string) => `/${slug}`;

/** True when `pathname` (clean or /operations-prefixed) is inside the route. */
export function isRouteActive(slug: string, pathname: string): boolean {
  const clean = pathname.startsWith('/operations/') ? pathname.slice('/operations'.length) : pathname;
  return clean === `/${slug}` || clean.startsWith(`/${slug}/`);
}

/** Tabs of the tenant workspace (/tenants/<id>?tab=…). */
export const TENANT_TABS = ['overview', 'apps', 'deployments', 'jobs', 'billing', 'flags', 'activity'] as const;
export type TenantTab = (typeof TENANT_TABS)[number];

/** The one URL for a customer: every page that shows an account ID links here. */
export function tenantHref(accountId: string, tab?: TenantTab): string {
  const base = `/tenants/${encodeURIComponent(accountId.trim())}`;
  return tab && tab !== 'overview' ? `${base}?tab=${tab}` : base;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isAccountId = (value: string) => UUID_PATTERN.test(value.trim());

/* ── Deep links: one URL per thing an operator might paste into a channel ── */

const withQuery = (path: string, query: Record<string, string>) => `${path}?${new URLSearchParams(query)}`;

/** A deployment's detail panel on Customer deployments. */
export const deploymentHref = (deploymentId: string) => withQuery('/deployments', { deployment: deploymentId.trim() });

/** A job run's detail panel on Job runs. */
export const jobRunHref = (runId: string) => withQuery('/jobs', { run: runId.trim() });

/** A compute node's detail panel on Compute nodes. */
export const nodeHref = (nodeName: string) => withQuery('/nodes', { node: nodeName.trim() });

/** An incident ("<type>/<id>") opened on Incidents. */
export const incidentHref = (incidentId: string) => withQuery('/incidents', { incident: incidentId.trim() });

/** Support lookup for one OTel trace or one wake. */
export const traceHref = (traceId: string) => withQuery('/lookup', { trace: traceId.trim() });
export const wakeHref = (wakeId: string) => withQuery('/lookup', { wake: wakeId.trim() });

/** Customer deployments filtered to one app (every status). */
export const appDeploymentsHref = (appId: string) => withQuery('/deployments', { app: appId.trim(), status: 'all' });
