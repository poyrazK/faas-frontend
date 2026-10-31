/* ==========================================================================
   Stale deployment repair — `gregalectl deployments repair-stale` in the
   console (runbook FaasStaleDeploymentBacklog). A dry run lists nonterminal
   deployments older than a cutoff; applying it inspects each one, skips any
   whose build is still queued or running, and cancels the rest with the
   reconciler's reason code. Like the CLI, it stops at the first unexpected
   failure instead of pressing on.
   ========================================================================== */

import { ApiError, type OperatorWrite } from '@/lib/api';
import type {
  OperatorDeployment,
  OperatorDeploymentDetailResponse,
  OperatorDeploymentFilters,
  OperatorDeploymentMutationResponse,
  OperatorDeploymentStatus,
} from './workloads';

export const STALE_STATUSES: OperatorDeploymentStatus[] = ['pending', 'building', 'imaging', 'snapshotting'];
export const STALE_REPAIR_REASON = 'stale_deployment_reconciler';
export const STALE_REPAIR_LIMIT = 200;
/** The CLI refuses cutoffs under 15 minutes; 2 hours is its default. */
export const STALE_AGE_OPTIONS = [
  { minutes: 15, label: 'Older than 15 min' },
  { minutes: 60, label: 'Older than 1 h' },
  { minutes: 120, label: 'Older than 2 h' },
  { minutes: 360, label: 'Older than 6 h' },
  { minutes: 1440, label: 'Older than 24 h' },
] as const;
export const DEFAULT_STALE_AGE_MINUTES = 120;

/** The dry-run query: the same filters repair-stale sends. */
export const staleDeploymentFilters = (olderThanMinutes: number, now = Date.now()): OperatorDeploymentFilters => ({
  statuses: STALE_STATUSES,
  includeDeleted: true,
  createdBefore: new Date(now - Math.max(15, olderThanMinutes) * 60_000),
  limit: STALE_REPAIR_LIMIT,
});

export type StaleRepairResult = 'cancelled' | 'skipped_active_build' | 'already_finished' | 'failed' | 'not_attempted';

export interface StaleRepairOutcome {
  deployment: OperatorDeployment;
  result: StaleRepairResult;
  detail?: string;
}

export interface StaleRepairClient {
  inspect: (id: string) => Promise<OperatorDeploymentDetailResponse>;
  cancel: (id: string, reason: string, opts: OperatorWrite) => Promise<OperatorDeploymentMutationResponse>;
}

/**
 * Applies the repair to the dry-run candidates, one at a time. Each cancel
 * carries a key derived from the dialog's own key, so retrying the dialog
 * replays the same requests instead of issuing new ones.
 */
export async function repairStaleDeployments(
  candidates: OperatorDeployment[],
  client: StaleRepairClient,
  options: { idempotencyKey: string; onProgress?: (outcomes: StaleRepairOutcome[]) => void },
): Promise<StaleRepairOutcome[]> {
  const outcomes: StaleRepairOutcome[] = candidates.map((deployment) => ({ deployment, result: 'not_attempted' }));
  const report = () => options.onProgress?.(outcomes.map((outcome) => ({ ...outcome })));
  for (const [index, deployment] of candidates.entries()) {
    try {
      const detail = await client.inspect(deployment.id);
      const build = detail.build;
      if (build && (build.status === 'queued' || build.status === 'running')) {
        outcomes[index] = { deployment, result: 'skipped_active_build', detail: `build ${build.id} is ${build.status}` };
      } else {
        const res = await client.cancel(deployment.id, STALE_REPAIR_REASON, {
          idempotencyKey: `${options.idempotencyKey}:${deployment.id}`,
        });
        outcomes[index] = { deployment, result: 'cancelled', detail: `now ${res.deployment.status}` };
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        outcomes[index] = { deployment, result: 'already_finished', detail: err.message };
      } else {
        outcomes[index] = { deployment, result: 'failed', detail: (err as Error).message };
        report();
        return outcomes;
      }
    }
    report();
  }
  return outcomes;
}

/** "Cancelled 9 · skipped 2 (active build) · 1 already finished". */
export function summarizeStaleRepair(outcomes: StaleRepairOutcome[]): string {
  const count = (result: StaleRepairResult) => outcomes.filter((outcome) => outcome.result === result).length;
  const parts = [`Cancelled ${count('cancelled')}`];
  if (count('skipped_active_build')) parts.push(`skipped ${count('skipped_active_build')} (active build)`);
  if (count('already_finished')) parts.push(`${count('already_finished')} already finished`);
  if (count('failed')) parts.push(`stopped at a failure; ${count('not_attempted')} not attempted`);
  return parts.join(' · ');
}
