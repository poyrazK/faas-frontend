/* ==========================================================================
   The ⌘K jump box: whatever an operator pastes (an ID from a ticket, a log
   line, an alert) or types (a page name, a node, an org) becomes a short
   list of places to open. Nothing is fetched to decide: an ID on its own
   does not say what it is, so a UUID offers each kind of page it could be.
   ========================================================================== */

import {
  OPS_ROUTES,
  appDeploymentsHref,
  deploymentHref,
  incidentHref,
  isAccountId,
  jobRunHref,
  nodeHref,
  opsHref,
  tenantHref,
  traceHref,
  wakeHref,
} from '@/lib/routes';
import { parseIncidentId } from './incidents';
import { TRACE_ID_PATTERN } from './support';
import { looksLikeEmail } from './tenantSearch';

export interface JumpTarget {
  href: string;
  label: string;
  /** Where it opens, shown beside the label. */
  hint: string;
}

const ALERT_EPISODE_ID = /^[0-9a-f]{64}$/;
const NODE_NAME = /^[a-z0-9][a-z0-9.-]{0,62}$/i;

/** Destinations for `raw`, most specific first; every page when it is empty. */
export function jumpTargets(raw: string): JumpTarget[] {
  const query = raw.trim();
  const lower = query.toLowerCase();
  const pages = OPS_ROUTES.filter((route) => !query || route.label.toLowerCase().includes(lower) || route.slug.includes(lower)).map(
    (route) => ({ href: opsHref(route.slug), label: route.label, hint: route.group }),
  );
  if (!query) return pages;

  const ids: JumpTarget[] = [];
  if (parseIncidentId(lower)) {
    ids.push({ href: incidentHref(lower), label: `Incident ${lower}`, hint: 'Incidents' });
  } else if (isAccountId(query)) {
    ids.push(
      { href: tenantHref(lower), label: 'Tenant with this account ID', hint: 'Tenants' },
      { href: deploymentHref(lower), label: 'Deployment with this ID', hint: 'Deployments' },
      { href: jobRunHref(lower), label: 'Job run with this ID', hint: 'Job runs' },
      { href: appDeploymentsHref(lower), label: 'Deployments of the app with this ID', hint: 'Deployments' },
      { href: wakeHref(lower), label: 'Wake with this ID', hint: 'Support lookup' },
    );
  } else if (TRACE_ID_PATTERN.test(lower)) {
    ids.push(
      { href: traceHref(lower), label: `Trace ${lower}`, hint: 'Support lookup' },
      { href: wakeHref(lower), label: 'Wake with this ID', hint: 'Support lookup' },
    );
  } else if (ALERT_EPISODE_ID.test(lower)) {
    ids.push({ href: incidentHref(`platform_alert/${lower}`), label: 'Platform alert episode', hint: 'Incidents' });
  } else if (looksLikeEmail(query)) {
    ids.push({ href: `/tenants?q=${encodeURIComponent(query)}`, label: `Find the tenant with ${query}`, hint: 'Tenants · email search' });
  }
  if (ids.length) return [...ids, ...pages];

  const fallbacks: JumpTarget[] = [];
  if (NODE_NAME.test(query)) fallbacks.push({ href: nodeHref(query), label: `Compute node ${query}`, hint: 'Compute nodes' });
  fallbacks.push({ href: `/tenants?q=${encodeURIComponent(query)}`, label: `Search tenants for “${query}”`, hint: 'Tenants' });
  return [...pages, ...fallbacks];
}
