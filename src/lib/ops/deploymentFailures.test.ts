import { describe, expect, it } from 'vitest';
import { failureSignature, groupFailureCauses } from './deploymentFailures';
import type { OperatorDeployment } from './workloads';

const DISK = (available: number) =>
  `vm spawn: builderd: create drive1: builderd: insufficient host free space for build drive: available=${available} bytes, required=21474836480 bytes`;

let seq = 0;
const failed = (error: string | undefined, extra: Partial<OperatorDeployment> = {}): OperatorDeployment => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  app_id: 'app-1',
  app_slug: 'h14-py',
  app_status: 'active',
  account_id: 'acct-1',
  kind: 'tarball',
  status: 'failed',
  source_bytes: 0,
  priority: 0,
  error,
  created_at: '2026-11-01T10:00:00Z',
  ...extra,
});

describe('failureSignature', () => {
  it('replaces sizes, IDs and digests but keeps the words', () => {
    expect(failureSignature(DISK(21436325888))).toBe(
      'vm spawn: builderd: create drive1: builderd: insufficient host free space for build drive: available=N bytes, required=N bytes',
    );
    expect(failureSignature('placement: no active compute_node fits 2056 MB billable / 4 guest vCPU')).toBe(
      'placement: no active compute_node fits N MB billable / N guest vCPU',
    );
    expect(failureSignature('pull 0f1e2d3c4b5a for app 7a1b2c3d-0000-4000-8000-000000000001 failed')).toBe('pull <id> for app <id> failed');
    expect(failureSignature('  build   exited 1 ')).toBe('build exited N');
    expect(failureSignature('p95 over budget in deadbeef')).toBe('p95 over budget in deadbeef');
  });
});

describe('groupFailureCauses', () => {
  it('groups repeats of one failure, most frequent first, and ignores other states', () => {
    const causes = groupFailureCauses([
      failed(DISK(21436325888), { created_at: '2026-10-27T10:00:00Z' }),
      failed(DISK(19063808000), { app_id: 'app-2', created_at: '2026-10-28T10:00:00Z' }),
      failed(DISK(20703383552), { account_id: 'acct-2', app_id: 'app-3', created_at: '2026-10-26T10:00:00Z' }),
      failed('snapshot prime failed: no active compute_node fits 2056 MB billable', { error_code: 'capacity_unavailable' }),
      failed('build exited 1', { status: 'live' }),
      failed(undefined),
    ]);
    expect(causes.map((c) => c.deployments.length)).toEqual([3, 1, 1]);
    const [disk, capacity, unknown] = causes;
    expect(disk).toMatchObject({ code: '', apps: 3, accounts: 2, latest: '2026-10-28T10:00:00Z' });
    expect(disk.example).toBe(DISK(21436325888));
    // A tie in count goes to the more recent cause.
    expect(capacity).toMatchObject({ code: 'capacity_unavailable', message: 'snapshot prime failed: no active compute_node fits N MB billable' });
    expect(capacity.example).toMatch(/^capacity_unavailable: snapshot prime failed/);
    expect(unknown).toMatchObject({ code: '', message: '', example: '' });
  });

  it('gives a cause the same short ID every time, and different causes different IDs', () => {
    const a = groupFailureCauses([failed(DISK(1))])[0].id;
    expect(groupFailureCauses([failed(DISK(2))])[0].id).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(groupFailureCauses([failed('build exited 1')])[0].id).not.toBe(a);
    expect(groupFailureCauses([failed('build exited 1', { error_code: 'build_failed' })])[0].id).not.toBe(
      groupFailureCauses([failed('build exited 1')])[0].id,
    );
  });
});
