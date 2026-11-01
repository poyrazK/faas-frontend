/* ==========================================================================
   The overview's "what needs attention" list: one place that answers "is
   anything wrong right now?" from data the console already polls — the
   incident inbox (failed deployments, job runs, nodes and alerts in one
   list), the alert workload summary, node heartbeats, and the operator's own
   actions. Deployment and job-run lists are not read here: apid audits every
   read of them as an operator view, so the overview never polls them.

   Deployments that fail or wait the same way ("deployment failed
   (capacity_unavailable)") share one row with a count, so a burst of them
   cannot push every other incident off the list.

   Missing evidence is never an all-clear: a source that could not be read is
   reported as unknown and keeps the headline from saying "All clear".
   ========================================================================== */

import type { ObsOverviewNodeHealth } from '@/lib/api';
import { incidentHref, nodeHref } from '@/lib/routes';
import { INCIDENT_TYPE_LABELS, type ObsAlertWorkloadSummary, type ObsIncident, type ObsIncidentListResponse } from './incidents';

export type AttentionTone = 'danger' | 'warning';

export interface AttentionItem {
  key: string;
  tone: AttentionTone;
  title: string;
  /** What it is and where: "Deployment · checkout-api". */
  detail: string;
  href: string;
  /** ISO time the problem was observed, when known. */
  at?: string;
}

export interface AttentionIntent {
  intentId: string;
  kind: string;
  target: string;
  status: string;
}

export interface AttentionInput {
  /** The incident inbox (default filters), or an Error when it could not be read. */
  incidents?: ObsIncidentListResponse | Error | null;
  alerts?: ObsAlertWorkloadSummary | Error | null;
  nodes?: ObsOverviewNodeHealth[] | Error | null;
  intents?: AttentionIntent[];
}

export interface AttentionReport {
  items: AttentionItem[];
  /** Total incidents in the inbox; items shows at most `limit` rows of them. */
  incidentCount: number;
  /** Incidents in rows beyond `limit`, counted but not listed. */
  hiddenIncidents: number;
  /** Sources that could not be read or are incomplete: the list may be missing problems. */
  unknown: string[];
  headline: { tone: 'ok' | 'warning' | 'danger' | 'unknown'; text: string };
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, error: 1, warning: 2 };

const byUrgency = (a: ObsIncident, b: ObsIncident) =>
  (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || Date.parse(b.observed_at) - Date.parse(a.observed_at);

const isError = (value: unknown): value is Error => value instanceof Error;

const groupKey = (incident: ObsIncident) => `${incident.severity}|${incident.status}|${incident.summary}`;

/**
 * The sorted inbox as rows: deployments sharing a summary make one row, at
 * the place of its most urgent (and most recent) member; the rest stay single.
 */
function incidentRows(sorted: ObsIncident[]): ObsIncident[][] {
  const groups = new Map<string, ObsIncident[]>();
  for (const incident of sorted) {
    if (incident.type !== 'deployment') continue;
    const group = groups.get(groupKey(incident));
    if (group) group.push(incident);
    else groups.set(groupKey(incident), [incident]);
  }
  const rows: ObsIncident[][] = [];
  for (const incident of sorted) {
    const group = incident.type === 'deployment' ? groups.get(groupKey(incident)) : undefined;
    if (!group || group.length === 1) rows.push([incident]);
    else if (group[0] === incident) rows.push(group);
  }
  return rows;
}

function incidentItem(incident: ObsIncident): AttentionItem {
  return {
    key: `incident:${incident.id}`,
    tone: incident.severity === 'warning' ? 'warning' : 'danger',
    title: incident.summary,
    detail: `${INCIDENT_TYPE_LABELS[incident.type] ?? incident.type}${incident.resource_name ? ` · ${incident.resource_name}` : ''}`,
    href: incidentHref(incident.id),
    at: incident.observed_at,
  };
}

/** One row for deployments sharing a summary; it opens them on the Deployments page. */
function deploymentGroupItem(group: ObsIncident[]): AttentionItem {
  const [first] = group;
  const apps = [...new Set(group.map((incident) => incident.resource_name || incident.app_id || incident.resource_id))];
  const accounts = new Set(group.map((incident) => incident.account_id));
  const query = new URLSearchParams({ status: first.status === 'failed' ? 'failed' : 'in_flight' });
  if (accounts.size === 1 && first.account_id) query.set('account', first.account_id);
  return {
    key: `deployments:${groupKey(first)}`,
    tone: first.severity === 'warning' ? 'warning' : 'danger',
    // apid's summary is "deployment <status>", with " (<error code>)" when a failure has one.
    title: first.summary.startsWith('deployment ')
      ? `${group.length} deployments ${first.summary.slice('deployment '.length)}`
      : `${group.length} × ${first.summary}`,
    detail: `Deployments · ${apps.slice(0, 3).join(', ')}${apps.length > 3 ? ` and ${apps.length - 3} more` : ''}`,
    href: `/deployments?${query}`,
    at: first.observed_at,
  };
}

/** Builds the list, most urgent first; incident rows beyond `limit` are counted, not listed. */
export function buildAttention(input: AttentionInput, limit = 8): AttentionReport {
  const items: AttentionItem[] = [];
  const unknown: string[] = [];
  let incidentCount = 0;
  let hiddenIncidents = 0;

  // Actions the operator started that failed come first: they are the operator's own loose ends.
  for (const intent of input.intents ?? []) {
    if (intent.status === 'failed' || intent.status === 'outcome_unknown') {
      items.push({
        key: `intent:${intent.intentId}`,
        tone: 'danger',
        title: intent.status === 'failed' ? `Your ${intent.kind.replace(/_/g, ' ')} failed` : `Your ${intent.kind.replace(/_/g, ' ')} has an unknown outcome`,
        detail: intent.target,
        href: '/controls',
      });
    }
  }

  if (isError(input.incidents)) unknown.push(`Incident inbox: ${input.incidents.message}`);
  else if (input.incidents) {
    const sorted = [...input.incidents.items].sort(byUrgency);
    incidentCount = sorted.length;
    const rows = incidentRows(sorted);
    for (const row of rows.slice(0, limit)) items.push(row.length === 1 ? incidentItem(row[0]) : deploymentGroupItem(row));
    for (const row of rows.slice(limit)) hiddenIncidents += row.length;
    for (const source of input.incidents.unavailable_sources ?? []) unknown.push(`Incident source ${source.replace(/_/g, ' ')} is unavailable`);
  }

  if (isError(input.alerts)) unknown.push(`Alert summary: ${input.alerts.message}`);
  else if (input.alerts) {
    const counts = input.alerts.counts;
    if (!counts) unknown.push('Platform alerts have not been collected yet');
    else if (counts.needs_attention > 0) {
      items.push({
        key: 'alerts:needs-attention',
        tone: counts.firing > 0 ? 'danger' : 'warning',
        title: `${counts.needs_attention} platform alert${counts.needs_attention === 1 ? '' : 's'} need${counts.needs_attention === 1 ? 's' : ''} an owner or acknowledgment`,
        detail: `${counts.firing} firing · ${counts.unknown} unknown status`,
        href: '/incidents?type=platform_alert&ack=unacknowledged',
      });
    }
  }

  if (isError(input.nodes)) unknown.push(`Node heartbeats: ${input.nodes.message}`);
  else {
    for (const node of input.nodes ?? []) {
      if (node.active && node.stale) {
        items.push({
          key: `node:${node.name}`,
          tone: 'warning',
          title: `${node.name} has a stale heartbeat`,
          detail: 'Compute node · still in placement',
          href: nodeHref(node.name),
          at: node.last_heartbeat_at,
        });
      }
    }
  }

  const danger = items.filter((item) => item.tone === 'danger').length;
  const total = items.length + hiddenIncidents;
  const headline: AttentionReport['headline'] =
    danger > 0
      ? { tone: 'danger', text: `${total} thing${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} attention` }
      : items.length > 0
        ? { tone: 'warning', text: `${total} warning${total === 1 ? '' : 's'} to look at` }
        : unknown.length > 0
          ? { tone: 'unknown', text: 'No known problems, but some signals are unavailable' }
          : { tone: 'ok', text: 'All clear' };

  return { items, incidentCount, hiddenIncidents, unknown, headline };
}
