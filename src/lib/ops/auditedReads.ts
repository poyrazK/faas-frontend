/* ==========================================================================
   Audited reads. apid records every read of the operator deployment list,
   job-run list and incident inbox as an operator.action.view audit row, and
   since faas ADR-20261102071817 those rows are kept in audit_log: sealed,
   searchable and never deleted. A console tab that polls them on a timer
   writes thousands of rows a day that nobody chose to make. So:

   - the deployment and job-run lists refresh on a timer only while they show
     work in flight, and otherwise on open, on Refresh and on filter changes;
   - the incident inbox, which has no "in flight", refreshes every 2 minutes;
   - lists of operator actions hide those views unless asked for them.
   ========================================================================== */

import type { OperatorDeployment, OperatorJobRun } from './workloads';

/** How often an audited list refreshes while something it shows is in flight. */
export const AUDITED_POLL_MS = 30_000;
/** How often the incident inbox (also audited) refreshes. */
export const INCIDENT_INBOX_POLL_MS = 120_000;

const IN_FLIGHT_DEPLOYMENT = new Set(['pending', 'building', 'imaging', 'snapshotting']);
const IN_FLIGHT_JOB_RUN = new Set(['queued', 'running']);

export const hasDeploymentInFlight = (deployments: OperatorDeployment[] | null | undefined) =>
  !!deployments?.some((deployment) => IN_FLIGHT_DEPLOYMENT.has(deployment.status));

export const hasJobRunInFlight = (runs: OperatorJobRun[] | null | undefined) =>
  !!runs?.some((run) => IN_FLIGHT_JOB_RUN.has(run.aggregate_status));

/** The audit kind apid writes for an operator's audited read. */
export const OPERATOR_VIEW_KIND = 'operator.action.view';

export const isOperatorView = (kind: string) => kind === OPERATOR_VIEW_KIND;

/** Splits audit rows into operator views and everything else, keeping order. */
export function splitOperatorViews<T extends { kind: string }>(rows: readonly T[]): { others: T[]; views: number } {
  const others = rows.filter((row) => !isOperatorView(row.kind));
  return { others, views: rows.length - others.length };
}

export const viewCount = (n: number) => `${n} operator view${n === 1 ? '' : 's'}`;
