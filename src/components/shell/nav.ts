import type { IconName } from '@/components/ui/Icons';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /**
   * True when the control plane has no endpoint behind this surface yet, so
   * the page renders an <Unavailable> panel. Flagged here as well so the
   * sidebar can mark it, rather than leading someone into a dead end.
   */
  unbacked?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/**
 * The console's navigation, following the product template's grouping.
 * Gregale vocabulary note: a "workflow" here is an app in the REST API
 * (`/v1/apps`) and in the CLI — same object, template's name for it.
 */
export const NAV: NavGroup[] = [
  {
    items: [{ href: '/dashboard', label: 'Overview', icon: 'overview' }],
  },
  {
    label: 'Build',
    items: [
      { href: '/dashboard/workflows', label: 'Workflows', icon: 'workflows' },
      { href: '/dashboard/apis', label: 'APIs', icon: 'apis' },
      { href: '/dashboard/crons', label: 'Cron Jobs', icon: 'crons' },
      { href: '/dashboard/queues', label: 'Queue Jobs', icon: 'queues' },
      { href: '/dashboard/workers', label: 'Workers', icon: 'workers' },
      { href: '/dashboard/deployments', label: 'Deployments', icon: 'deployments' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/dashboard/domains', label: 'Domains', icon: 'domains' },
      { href: '/dashboard/secrets', label: 'Secrets', icon: 'secrets' },
      { href: '/dashboard/env', label: 'Env Vars', icon: 'env' },
      { href: '/dashboard/storage', label: 'Storage', icon: 'storage', unbacked: true },
      { href: '/dashboard/databases', label: 'Databases', icon: 'databases', unbacked: true },
    ],
  },
  {
    label: 'Observability',
    items: [
      { href: '/dashboard/logs', label: 'Logs', icon: 'logs' },
      { href: '/dashboard/metrics', label: 'Metrics', icon: 'metrics' },
      { href: '/dashboard/traces', label: 'Traces', icon: 'traces', unbacked: true },
      { href: '/dashboard/alerts', label: 'Alerts', icon: 'alerts' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { href: '/dashboard/usage', label: 'Usage', icon: 'usage' },
      { href: '/dashboard/invoices', label: 'Invoices', icon: 'invoices' },
      { href: '/dashboard/plans', label: 'Plans', icon: 'plans' },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/dashboard/keys', label: 'API Keys', icon: 'keys' },
      { href: '/dashboard/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

/** Longest-prefix match, so /dashboard/workflows/foo highlights Workflows. */
export function isActive(href: string, pathname: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(href + '/');
}
