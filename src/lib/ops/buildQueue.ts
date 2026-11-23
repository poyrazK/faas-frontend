/* ==========================================================================
   Build queue and builder slots (apid ADR-20261123163340).

     GET /v1/admin/obs/build-queue?window=24h

   Waits run from enqueue (or a later not_before) to start, durations from
   start to finish, both in seconds. A requeued build's wait includes its
   earlier attempts. Slot fields on a node row come from
   builderd's gauges and mean something only when `observed`.
   ========================================================================== */

import { request } from '@/lib/api';

/** @go api.ObsBuildQueueTotals */
export interface ObsBuildQueueTotals {
  queued: number;
  /** Queued with a not_before still ahead: not waiting yet, and not listed. */
  deferred: number;
  /** Queued behind an identical build (coalesced): in `queued`, but not in the oldest wait or the warn count. */
  held: number;
  running: number;
  oldest_wait_seconds: number;
  waiting_over_warn: number;
  running_over_timeout: number;
  finished: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  duration_p50_seconds: number;
  duration_p95_seconds: number;
  wait_p50_seconds: number;
  wait_p95_seconds: number;
  cache_hits: number;
  cache_misses: number;
  cache_invalidated: number;
  preempted: number;
}

/** @go api.ObsBuildKindStat */
export interface ObsBuildKindStat {
  kind: string;
  queued: number;
  running: number;
  finished: number;
  failed: number;
  duration_p95_seconds: number;
}

/** @go api.ObsBuildFailureCount */
export interface ObsBuildFailureCount {
  class: string;
  count: number;
}

/** @go api.ObsBuilderNodeSlots */
export interface ObsBuilderNodeSlots {
  node: string;
  running_builds: number;
  observed: boolean;
  /** More than one builderd target reported this node, so no slot figure is trusted. */
  conflicting: boolean;
  limit: number;
  reserved: number;
  in_use: number;
  active_reserved: number;
  opportunistic: number;
  active_borrowed: number;
}

/** @go api.ObsBuildRow */
export interface ObsBuildRow {
  id: string;
  deployment_id: string;
  app_id?: string;
  app_slug?: string;
  account_id?: string;
  kind: string;
  status: string;
  failure_class?: string;
  cache_status?: string;
  node?: string;
  source_bytes: number;
  preemptions: number;
  coalesced: boolean;
  enqueued_at: string;
  not_before?: string;
  started_at?: string;
  finished_at?: string;
  wait_seconds: number;
  duration_seconds: number;
}

/** @go api.ObsBuildQueueReport */
export interface ObsBuildQueueReport {
  as_of: string;
  window_seconds: number;
  build_timeout_seconds: number;
  wait_warn_seconds: number;
  active_truncated: boolean;
  finished_truncated: boolean;
  /** observed, unavailable (Prometheus failed) or not_configured. */
  slots_state: string;
  totals: ObsBuildQueueTotals;
  kinds: ObsBuildKindStat[];
  failures: ObsBuildFailureCount[];
  nodes: ObsBuilderNodeSlots[];
  queued: ObsBuildRow[];
  running: ObsBuildRow[];
  slowest: ObsBuildRow[];
  recent_failures: ObsBuildRow[];
}

export const BUILD_QUEUE_WINDOWS = ['1h', '6h', '24h', '72h', '168h'] as const;
export type BuildQueueWindow = (typeof BUILD_QUEUE_WINDOWS)[number];

export const isBuildQueueWindow = (v: string | null | undefined): v is BuildQueueWindow =>
  (BUILD_QUEUE_WINDOWS as readonly string[]).includes(v ?? '');

export const buildQueueQuery =(window: BuildQueueWindow) => `?window=${encodeURIComponent(window)}`;

export const getBuildQueue = (window: BuildQueueWindow = '24h') =>
  request<ObsBuildQueueReport>(`/v1/admin/obs/build-queue${buildQueueQuery(window)}`, { cache: 'no-store' });

/** Window label: "168h" reads as "7d". */
export const windowLabel = (w: BuildQueueWindow) => (w === '168h' ? '7d' : w === '72h' ? '3d' : w);

/** What a failure_class means to an operator. */
export function failureLabel(cls: string): string {
  switch (cls) {
    case 'oom':
      return 'Out of memory';
    case 'timeout':
      return 'Timed out';
    case 'user_error':
      return 'Build error (customer)';
    case 'infra':
      return 'Platform error';
    default:
      return 'Unclassified';
  }
}

/** Share of finished cache lookups that hit, or null when there were none. */
export function cacheHitRate(t: Pick<ObsBuildQueueTotals, 'cache_hits' | 'cache_misses' | 'cache_invalidated'>): number | null {
  const n = t.cache_hits + t.cache_misses + t.cache_invalidated;
  return n ? t.cache_hits / n : null;
}

/** Wait tone: over the warn line is a warning, past three times it is danger. */
export function waitTone(seconds: number, warn: number): 'neutral' | 'warning' | 'danger' {
  if (seconds > 3 * warn) return 'danger';
  if (seconds > warn) return 'warning';
  return 'neutral';
}

/** "1 of 2 reserved · 1 borrowed" style slot summary for a node. */
export function slotSummary(n: ObsBuilderNodeSlots): string {
  if (n.conflicting) return 'conflicting builderd reports';
  if (!n.observed) return 'no slot data';
  const parts = [`${Math.min(n.active_reserved, n.reserved)}/${n.reserved} reserved`];
  if (n.opportunistic) parts.push(`${n.opportunistic} opportunistic`);
  if (n.active_borrowed) parts.push(`${n.active_borrowed} borrowed`);
  return parts.join(' · ');
}
