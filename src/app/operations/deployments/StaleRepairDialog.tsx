'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { FilterSelect } from '@/components/ui/bits';
import { relativeTime } from '@/lib/format';
import { EntityId } from '@/components/operator/EntityId';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { cancelOperatorDeployment, getOperatorDeployment, listOperatorDeployments, type OperatorDeployment } from '@/lib/ops/workloads';
import {
  DEFAULT_STALE_AGE_MINUTES,
  repairStaleDeployments,
  STALE_AGE_OPTIONS,
  STALE_REPAIR_LIMIT,
  STALE_REPAIR_REASON,
  staleDeploymentFilters,
  summarizeStaleRepair,
  type StaleRepairOutcome,
  type StaleRepairResult,
} from '@/lib/ops/staleRepair';

const RESULT_LABEL: Record<StaleRepairResult, { label: string; tone: string }> = {
  cancelled: { label: 'Cancelled', tone: 'badge-success' },
  skipped_active_build: { label: 'Skipped: build active', tone: 'badge-neutral' },
  already_finished: { label: 'Already finished', tone: 'badge-neutral' },
  failed: { label: 'Failed', tone: 'badge-danger' },
  not_attempted: { label: 'Not attempted', tone: 'badge-neutral' },
};

type Scan = { olderThan: number; cutoff: Date; candidates: OperatorDeployment[] } | { error: string } | null;

/**
 * Runbook FaasStaleDeploymentBacklog: find nonterminal deployments older than
 * a cutoff (dry run, nothing changes), then cancel them as one confirmed batch.
 */
export function StaleRepairDialog({ open, onClose, onRepaired }: { open: boolean; onClose: () => void; onRepaired: () => void }) {
  const [olderThan, setOlderThan] = useState(DEFAULT_STALE_AGE_MINUTES);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<Scan>(null);
  const [confirming, setConfirming] = useState(false);
  const [outcomes, setOutcomes] = useState<StaleRepairOutcome[] | null>(null);

  const candidates = scan && 'candidates' in scan ? scan.candidates : null;

  const findStale = async () => {
    setScanning(true);
    setOutcomes(null);
    try {
      const filters = staleDeploymentFilters(olderThan);
      const page = await listOperatorDeployments(filters);
      setScan({ olderThan, cutoff: filters.createdBefore!, candidates: page.deployments });
    } catch (err) {
      setScan({ error: (err as Error).message });
    } finally {
      setScanning(false);
    }
  };

  const close = () => {
    setScan(null);
    setOutcomes(null);
    onClose();
  };

  const rows: StaleRepairOutcome[] = outcomes ?? (candidates ?? []).map((deployment) => ({ deployment, result: 'not_attempted' }));

  return (
    <>
      <Modal open={open} onClose={close} title="Repair stale deployments" width={880}>
        <div className="space-y-4 text-xs">
          <p className="text-[var(--color-ink-soft)]">
            Finds deployments still pending, building, imaging or snapshotting past the cutoff (deleted apps included,
            at most {STALE_REPAIR_LIMIT}). Finding them changes nothing; cancelling skips any whose build is still queued
            or running and records <code>{STALE_REPAIR_REASON}</code> as the reason.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              value={String(olderThan)}
              onChange={(value) => setOlderThan(Number(value))}
              options={STALE_AGE_OPTIONS.map((option) => ({ value: String(option.minutes), label: option.label }))}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void findStale()} disabled={scanning}>
              {scanning ? 'Finding…' : candidates ? 'Find again' : 'Find stale deployments'}
            </button>
            {candidates && candidates.length > 0 && !outcomes && (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming(true)}>
                Cancel {candidates.length} deployment{candidates.length === 1 ? '' : 's'}…
              </button>
            )}
          </div>

          {scan && 'error' in scan && (
            <div role="alert" className="text-[var(--color-danger)]">
              Could not list deployments: {scan.error}
            </div>
          )}
          {scan && 'candidates' in scan && (
            <div className={outcomes ? 'font-semibold' : 'text-[var(--color-ink-muted)]'} role="status">
              {outcomes
                ? summarizeStaleRepair(outcomes)
                : `Dry run: ${scan.candidates.length} deployment${scan.candidates.length === 1 ? '' : 's'} created before ${scan.cutoff.toLocaleString()} ${
                    scan.candidates.length === STALE_REPAIR_LIMIT ? `(the first ${STALE_REPAIR_LIMIT}; run again after repairing)` : ''
                  }. Nothing has changed.`}
            </div>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Deployment</th>
                    <th>App</th>
                    <th>Account</th>
                    <th>Status</th>
                    <th>Created</th>
                    {outcomes && <th>Result</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ deployment: d, result, detail }) => (
                    <tr key={d.id}>
                      <td>
                        <EntityId id={d.id} kind="deployment" />
                      </td>
                      <td>
                        <span className="cell-primary">{d.app_slug}</span>
                        {d.app_status !== 'active' && <span className="badge badge-neutral ml-1.5">{d.app_status}</span>}
                      </td>
                      <td>
                        <EntityId id={d.account_id} kind="account" />
                      </td>
                      <td>
                        <span className="badge badge-warning">{d.status}</span>
                      </td>
                      <td title={d.created_at}>{relativeTime(d.created_at)}</td>
                      {outcomes && (
                        <td title={detail}>
                          <span className={`badge ${RESULT_LABEL[result].tone}`}>{RESULT_LABEL[result].label}</span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {candidates && candidates.length === 0 && (
            <div className="text-[var(--color-ink-muted)]">No deployment has been stuck that long.</div>
          )}
        </div>
      </Modal>

      {confirming && candidates && (
        <OperatorActionDialog
          open
          title={`Cancel ${candidates.length} stale deployment${candidates.length === 1 ? '' : 's'}`}
          tone="danger"
          reason="none"
          confirmText={`cancel ${candidates.length}`}
          submitLabel="Cancel deployments"
          fingerprint={`repair-stale|${candidates.map((d) => d.id).join(',')}`}
          impact={
            <div className="space-y-1.5">
              <p>
                Cancels each listed deployment that is still in flight. Customers see the deployment as cancelled and
                deploy again; their live release is not touched.
              </p>
              <p className="text-xs text-[var(--color-ink-soft)]">
                Deployments with a queued or running build are skipped. The batch stops at the first unexpected error.
              </p>
            </div>
          }
          onClose={() => setConfirming(false)}
          onSubmit={async ({ idempotencyKey }) => {
            const result = await repairStaleDeployments(
              candidates,
              { inspect: getOperatorDeployment, cancel: cancelOperatorDeployment },
              { idempotencyKey, onProgress: setOutcomes },
            );
            setOutcomes(result);
            onRepaired();
            const failure = result.find((outcome) => outcome.result === 'failed');
            if (failure) throw new Error(`${summarizeStaleRepair(result)}. ${failure.deployment.id}: ${failure.detail}`);
            return summarizeStaleRepair(result);
          }}
        />
      )}
    </>
  );
}
