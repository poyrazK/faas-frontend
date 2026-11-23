/* ==========================================================================
   Memory pressure (apid ADR-20261123190507).

     GET /v1/admin/obs/memory-pressure?window=24h

   Measured memory is admission's charge from the node's own scheduler
   (ADR-909); booked is Σ(ram_mb + 8) of its live instances, capped at
   overcommit_percent of the ceiling. Above the ceiling schedd compresses,
   then parks frozen VMs, then evicts running ones down to the eviction
   target.
   ========================================================================== */

import { request } from '@/lib/api';

/** @go api.ObsMemoryPressureTotals */
export interface ObsMemoryPressureTotals {
  nodes: number;
  nodes_over: number;
  nodes_near: number;
  nodes_stale: number;
  ceiling_mb: number;
  measured_mb: number;
  booked_mb: number;
  running: number;
  frozen: number;
  evictions: number;
  frozen_parks: number;
  oom_kills: number;
  apps_affected: number;
}

/** @go api.ObsMemoryNode */
export interface ObsMemoryNode {
  node_id: string;
  name: string;
  active: boolean;
  /** over, near, ok, stale or unmeasured. */
  state: string;
  mem_mb: number;
  ceiling_mb: number;
  booked_mb: number;
  booked_limit_mb: number;
  measured_mb?: number;
  used_mb?: number;
  measured_at?: string;
  measurement_age_seconds: number;
  running: number;
  waking: number;
  cold_booting: number;
  frozen: number;
  evictions: number;
  frozen_parks: number;
  oom_kills: number;
}

/** @go api.ObsMemoryReasonCount */
export interface ObsMemoryReasonCount {
  kind: string;
  reason: string;
  count: number;
}

/** @go api.ObsMemoryApp */
export interface ObsMemoryApp {
  app_id: string;
  app_slug?: string;
  account_id?: string;
  plan?: string;
  evictions: number;
  frozen_parks: number;
  oom_kills: number;
  max_peak_mb?: number;
  plan_mb?: number;
  last_at: string;
}

/** @go api.ObsMemoryEvent */
export interface ObsMemoryEvent {
  at: string;
  /** eviction, frozen_park or oom_kill. */
  kind: string;
  reason?: string;
  instance_id?: string;
  app_id?: string;
  app_slug?: string;
  account_id?: string;
  plan?: string;
  node_id?: string;
  node_name?: string;
  ram_mb?: number;
  peak_mb?: number;
  plan_mb?: number;
  deployment_failed?: boolean;
}

/** @go api.ObsMemoryPressureReport */
export interface ObsMemoryPressureReport {
  as_of: string;
  window_seconds: number;
  overcommit_percent: number;
  eviction_target_percent: number;
  measurement_stale_seconds: number;
  /** More events existed than apid reads: the oldest are missing from the counts. */
  truncated: boolean;
  totals: ObsMemoryPressureTotals;
  nodes: ObsMemoryNode[];
  reasons: ObsMemoryReasonCount[];
  apps: ObsMemoryApp[];
  events: ObsMemoryEvent[];
}

export const MEMORY_WINDOWS = ['1h', '6h', '24h', '72h', '168h'] as const;
export type MemoryWindow = (typeof MEMORY_WINDOWS)[number];

export const isMemoryWindow = (v: string | null | undefined): v is MemoryWindow => (MEMORY_WINDOWS as readonly string[]).includes(v ?? '');

export const memoryWindowLabel = (w: MemoryWindow) => (w === '168h' ? '7d' : w === '72h' ? '3d' : w);

export const getMemoryPressure = (window: MemoryWindow = '24h') =>
  request<ObsMemoryPressureReport>(`/v1/admin/obs/memory-pressure?window=${encodeURIComponent(window)}`, { cache: 'no-store' });

/** Badge tone for a node state. */
export function nodeStateTone(state: string): 'danger' | 'warning' | 'neutral' | 'success' {
  switch (state) {
    case 'over':
      return 'danger';
    case 'near':
    case 'stale':
      return 'warning';
    case 'ok':
      return 'success';
    default:
      return 'neutral';
  }
}

/** Share of the ceiling, whole percent, or null when unknown. */
export function pctOf(mb: number | null | undefined, ceiling: number): number | null {
  if (mb == null || !ceiling) return null;
  return Math.round((mb / ceiling) * 100);
}

/** What an event was, for an operator. */
export function eventLabel(e: Pick<ObsMemoryEvent, 'kind' | 'reason'>): string {
  switch (e.kind) {
    case 'oom_kill':
      return 'OOM kill';
    case 'frozen_park':
      return 'Frozen VM parked';
    default:
      return e.reason === 'measured_memory' ? 'Evicted: measured memory' : e.reason === 'ram_pressure' ? 'Evicted: reservations' : 'Evicted';
  }
}
