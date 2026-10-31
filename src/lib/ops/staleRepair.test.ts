import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type { OperatorDeployment, OperatorDeploymentDetailResponse, OperatorDeploymentMutationResponse } from './workloads';
import { repairStaleDeployments, staleDeploymentFilters, summarizeStaleRepair, STALE_REPAIR_REASON } from './staleRepair';

const dep = (id: string) => ({ id, status: 'building', app_slug: 'app', account_id: 'acct' }) as OperatorDeployment;
const detail = (id: string, buildStatus?: string) =>
  ({ deployment: dep(id), build: buildStatus ? { id: `b-${id}`, status: buildStatus, enqueued_at: '' } : undefined }) as OperatorDeploymentDetailResponse;
const cancelled = (id: string) => ({ deployment: { ...dep(id), status: 'cancelled' }, action: 'cancel' }) as OperatorDeploymentMutationResponse;

describe('stale deployment repair', () => {
  it('queries like repair-stale, never below the 15-minute floor', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    expect(staleDeploymentFilters(120, now)).toEqual({
      statuses: ['pending', 'building', 'imaging', 'snapshotting'],
      includeDeleted: true,
      createdBefore: new Date('2026-10-31T10:00:00Z'),
      limit: 200,
    });
    expect(staleDeploymentFilters(1, now).createdBefore).toEqual(new Date('2026-10-31T11:45:00Z'));
  });

  it('skips active builds, tolerates already-finished ones, and keys each cancel', async () => {
    const cancel = vi.fn(async (id: string) => {
      if (id === 'd3') throw new ApiError({ title: 'Conflict', status: 409, code: 'not_cancellable', detail: 'deployment is live' }, 409, '');
      return cancelled(id);
    });
    const inspect = vi.fn(async (id: string) => detail(id, id === 'd2' ? 'running' : 'failed'));
    const progress = vi.fn();
    const outcomes = await repairStaleDeployments([dep('d1'), dep('d2'), dep('d3')], { inspect, cancel }, { idempotencyKey: 'k', onProgress: progress });

    expect(outcomes.map((o) => o.result)).toEqual(['cancelled', 'skipped_active_build', 'already_finished']);
    expect(cancel).toHaveBeenCalledWith('d1', STALE_REPAIR_REASON, { idempotencyKey: 'k:d1' });
    expect(cancel).not.toHaveBeenCalledWith('d2', expect.anything(), expect.anything());
    expect(progress).toHaveBeenCalledTimes(3);
    expect(summarizeStaleRepair(outcomes)).toBe('Cancelled 1 · skipped 1 (active build) · 1 already finished');
  });

  it('stops at the first unexpected failure and leaves the rest untouched', async () => {
    const cancel = vi.fn(async (id: string) => {
      if (id === 'd1') throw new ApiError({ title: 'Step-up required', status: 403, code: 'step_up_required' }, 403, '');
      return cancelled(id);
    });
    const outcomes = await repairStaleDeployments([dep('d1'), dep('d2')], { inspect: async (id) => detail(id), cancel }, { idempotencyKey: 'k' });
    expect(outcomes.map((o) => o.result)).toEqual(['failed', 'not_attempted']);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(summarizeStaleRepair(outcomes)).toBe('Cancelled 0 · stopped at a failure; 1 not attempted');
  });
});
