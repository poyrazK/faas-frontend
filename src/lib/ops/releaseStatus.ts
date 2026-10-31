/* ==========================================================================
   Fleet release convergence — `gregalectl compute-nodes release-status`:
   is every active compute node running the desired release with a fresh
   heartbeat? Mirrors evaluateComputeNodesReleaseStatus, including its
   per-node readiness failures and the 90 s heartbeat staleness default.
   ========================================================================== */

import type { ComputeNode } from './nodes';

/** state.DefaultHeartbeatStaleness */
export const RELEASE_HEARTBEAT_STALENESS_MS = 90_000;
/** A release is a 40-character lowercase git SHA. */
export const RELEASE_SHA = /^[0-9a-f]{40}$/;

export type ReleaseReadinessFailure =
  | 'lifecycle_not_active'
  | 'observed_release_missing'
  | 'release_mismatch'
  | 'heartbeat_missing'
  | 'heartbeat_stale';

export const READINESS_FAILURE_LABEL: Record<ReleaseReadinessFailure, string> = {
  lifecycle_not_active: 'Not active',
  observed_release_missing: 'No release reported',
  release_mismatch: 'Different release',
  heartbeat_missing: 'No heartbeat',
  heartbeat_stale: 'Heartbeat stale',
};

export interface NodeReleaseStatus {
  name: string;
  observedRelease: string;
  lifecycle: string;
  lastHeartbeatAt?: string;
  heartbeatAgeMs?: number;
  ready: boolean;
  failure?: ReleaseReadinessFailure;
}

export interface ReleaseStatusReport {
  desiredRelease: string;
  ready: boolean;
  /** no_active_nodes | active_nodes_not_converged */
  failureReason?: string;
  activeNodeCount: number;
  nodes: NodeReleaseStatus[];
}

const effectiveLifecycle = (node: ComputeNode) => node.lifecycle || (node.active ? 'active' : 'unavailable');

export function evaluateReleaseStatus(
  nodes: ComputeNode[],
  desired: string,
  now = Date.now(),
  stalenessMs = RELEASE_HEARTBEAT_STALENESS_MS,
): ReleaseStatusReport {
  if (nodes.length === 0) {
    return { desiredRelease: desired, ready: false, failureReason: 'no_active_nodes', activeNodeCount: 0, nodes: [] };
  }
  const statuses = nodes.map((node): NodeReleaseStatus => {
    const observed = node.release_id ?? '';
    const heartbeat = node.last_heartbeat_at ? Date.parse(node.last_heartbeat_at) : NaN;
    const hasHeartbeat = Number.isFinite(heartbeat) && heartbeat > 0;
    const age = hasHeartbeat ? Math.max(0, now - heartbeat) : undefined;
    const failure: ReleaseReadinessFailure | undefined =
      !node.active || effectiveLifecycle(node) !== 'active'
        ? 'lifecycle_not_active'
        : !observed
          ? 'observed_release_missing'
          : observed !== desired
            ? 'release_mismatch'
            : !hasHeartbeat
              ? 'heartbeat_missing'
              : age! > stalenessMs
                ? 'heartbeat_stale'
                : undefined;
    return {
      name: node.name,
      observedRelease: observed,
      lifecycle: effectiveLifecycle(node),
      lastHeartbeatAt: hasHeartbeat ? node.last_heartbeat_at : undefined,
      heartbeatAgeMs: age,
      ready: !failure,
      failure,
    };
  });
  const ready = statuses.every((status) => status.ready);
  return {
    desiredRelease: desired,
    ready,
    failureReason: ready ? undefined : 'active_nodes_not_converged',
    activeNodeCount: nodes.length,
    nodes: statuses,
  };
}

/** Releases the active nodes report, most common first — quick picks for the desired release. */
export function observedReleases(nodes: ComputeNode[]): { release: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const node of nodes) if (node.release_id) counts.set(node.release_id, (counts.get(node.release_id) ?? 0) + 1);
  return [...counts.entries()].map(([release, count]) => ({ release, count })).sort((a, b) => b.count - a.count || a.release.localeCompare(b.release));
}
