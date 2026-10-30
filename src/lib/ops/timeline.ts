/* ==========================================================================
   One customer's history, merged from every source the console can read.
   apid has no per-account timeline endpoint, so the workspace fetches each
   source scoped to the account and this module turns them into one list.
   Pure functions only, so the merge is unit-tested.
   ========================================================================== */

import type { GlobalAuditLogEntry, ObsAuditActivityRow, ObsInvocationRow } from '@/lib/api';
import type { ObsIncident } from './incidents';
import type { OperatorDeployment } from './workloads';

export type TimelineKind = 'operator' | 'audit' | 'deployment' | 'incident' | 'invocation';

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  operator: 'Operator actions',
  audit: 'Account events',
  deployment: 'Deployments',
  incident: 'Incidents',
  invocation: 'Invocations',
};

export type TimelineTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface TimelineEntry {
  /** Unique across sources: "<kind>:<source id>". */
  key: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail?: string;
  actor?: string;
  tone: TimelineTone;
  /** Console page that shows this item, when there is one. */
  href?: string;
}

export interface TimelineSources {
  operatorActions?: GlobalAuditLogEntry[];
  accountEvents?: ObsAuditActivityRow[];
  deployments?: OperatorDeployment[];
  incidents?: ObsIncident[];
  invocations?: ObsInvocationRow[];
}

const FAILED_DEPLOYMENT = new Set(['failed', 'cancelled']);
const RUNNING_DEPLOYMENT = new Set(['pending', 'building', 'imaging', 'snapshotting']);

function deploymentTone(status: string): TimelineTone {
  if (FAILED_DEPLOYMENT.has(status)) return status === 'failed' ? 'danger' : 'neutral';
  if (RUNNING_DEPLOYMENT.has(status)) return 'warning';
  return status === 'live' ? 'success' : 'neutral';
}

function invocationTone(row: ObsInvocationRow): TimelineTone {
  if (row.state === 'failed' || row.outcome?.startsWith('error')) return 'danger';
  return row.state === 'completed' ? 'neutral' : 'warning';
}

/** Turns "operator.action.account.suspend" into "Account suspend". */
export function humanizeKind(kind: string): string {
  const trimmed = kind.replace(/^operator\.action\./, '').replace(/^operator\./, '');
  const words = trimmed.split(/[._]/).filter(Boolean).join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : kind;
}

/**
 * Merges every source into one newest-first list. An audit row that appears
 * in both the operator search and the account's own events is shown once,
 * as an operator action. Incidents are kept only when they name this account.
 */
export function buildTimeline(accountId: string, sources: TimelineSources): TimelineEntry[] {
  const entries = new Map<string, TimelineEntry>();
  const add = (entry: TimelineEntry) => {
    if (!entries.has(entry.key) && Number.isFinite(Date.parse(entry.at))) entries.set(entry.key, entry);
  };

  for (const row of sources.operatorActions ?? []) {
    add({
      key: `audit:${row.id}`,
      kind: 'operator',
      at: row.received_at,
      title: humanizeKind(row.kind),
      actor: row.actor,
      detail: row.kind,
      tone: /suspend|refund|revoke|force|hold_placed|delete/.test(row.kind) ? 'warning' : 'neutral',
    });
  }
  for (const row of sources.accountEvents ?? []) {
    add({ key: `audit:${row.id}`, kind: 'audit', at: row.at, title: humanizeKind(row.kind), actor: row.actor, detail: row.kind, tone: 'neutral' });
  }
  for (const dep of sources.deployments ?? []) {
    add({
      key: `deployment:${dep.id}`,
      kind: 'deployment',
      at: dep.created_at,
      title: `${dep.app_slug} deployment ${dep.status}`,
      detail: dep.error_code ? `${dep.error_code}${dep.error ? ` — ${dep.error}` : ''}` : dep.kind,
      tone: deploymentTone(dep.status),
      href: `/deployments?${new URLSearchParams({ deployment: dep.id })}`,
    });
  }
  for (const incident of sources.incidents ?? []) {
    if (incident.account_id !== accountId) continue;
    add({
      key: `incident:${incident.id}`,
      kind: 'incident',
      at: incident.observed_at,
      title: incident.summary,
      detail: `${incident.type.replace('_', ' ')} · ${incident.resource_name ?? incident.resource_id}`,
      tone: incident.severity === 'critical' || incident.severity === 'error' ? 'danger' : 'warning',
      href: '/incidents',
    });
  }
  for (const row of sources.invocations ?? []) {
    add({
      key: `invocation:${row.id}`,
      kind: 'invocation',
      at: row.created_at,
      title: `${row.app_slug ?? row.app_id.slice(0, 8)} · ${row.method} ${row.path}`,
      detail: [row.outcome ?? row.state, row.source, row.last_error].filter(Boolean).join(' · '),
      tone: invocationTone(row),
    });
  }

  return [...entries.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key));
}

/** Entries grouped by local calendar day, newest day first, for a dated list. */
export function groupByDay(entries: TimelineEntry[], locale?: string): { day: string; entries: TimelineEntry[] }[] {
  const groups: { day: string; entries: TimelineEntry[] }[] = [];
  for (const entry of entries) {
    const day = new Date(entry.at).toLocaleDateString(locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}
