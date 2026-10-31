import { describe, expect, it } from 'vitest';
import type { ComputeNode } from './nodes';
import { evaluateReleaseStatus, observedReleases } from './releaseStatus';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const NOW = Date.parse('2026-10-31T12:00:00Z');
const node = (name: string, over: Partial<ComputeNode> = {}) =>
  ({ name, active: true, lifecycle: 'active', release_id: A, last_heartbeat_at: '2026-10-31T11:59:30Z', ...over }) as ComputeNode;

describe('evaluateReleaseStatus', () => {
  it('is ready only when every active node runs the release with a fresh heartbeat', () => {
    expect(evaluateReleaseStatus([node('n1'), node('n2')], A, NOW)).toMatchObject({ ready: true, activeNodeCount: 2 });
  });

  it('reports each node failure in the CLI order', () => {
    const report = evaluateReleaseStatus(
      [
        node('drained', { lifecycle: 'draining' }),
        node('no-release', { release_id: null }),
        node('old', { release_id: B }),
        node('silent', { last_heartbeat_at: undefined }),
        node('stale', { last_heartbeat_at: '2026-10-31T11:58:00Z' }),
        node('ok'),
      ],
      A,
      NOW,
    );
    expect(report.ready).toBe(false);
    expect(report.failureReason).toBe('active_nodes_not_converged');
    expect(report.nodes.map((n) => n.failure ?? 'ready')).toEqual([
      'lifecycle_not_active',
      'observed_release_missing',
      'release_mismatch',
      'heartbeat_missing',
      'heartbeat_stale',
      'ready',
    ]);
    expect(report.nodes[4].heartbeatAgeMs).toBe(120_000);
  });

  it('treats an empty fleet as not ready', () => {
    expect(evaluateReleaseStatus([], A, NOW)).toMatchObject({ ready: false, failureReason: 'no_active_nodes' });
  });

  it('lists observed releases, most common first', () => {
    expect(observedReleases([node('1'), node('2', { release_id: B }), node('3'), node('4', { release_id: null })])).toEqual([
      { release: A, count: 2 },
      { release: B, count: 1 },
    ]);
  });
});
