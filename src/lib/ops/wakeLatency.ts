/* ==========================================================================
   Fleet wake latency (apid ADR-20261121200409).

     GET /v1/admin/obs/wake-latency?window=&node=&app_id=

   Read from the wake.* events: durations by method and node, the phases
   vmmd and schedd report, why wakes cold booted, the slowest wakes and the
   apps that keep cold booting.
   ========================================================================== */

import { request } from '@/lib/api';

/** @go api.ObsWakeTotals */
export interface ObsWakeTotals {
  wakes: number;
  restores: number;
  cold_boots: number;
  thaws: number;
  failures: number;
  /** Restores vmmd ran as cold boots. */
  fallbacks: number;
  restores_over_target: number;
  /** Platform snapshot refresh boots: counted here, left out of every other figure. */
  platform_refreshes: number;
}

/** @go api.ObsWakeMethodStat */
export interface ObsWakeMethodStat {
  method: string;
  count: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  over_target: number;
}

/** @go api.ObsWakeNodeStat */
export interface ObsWakeNodeStat {
  node_id: string;
  node_name?: string;
  restores: number;
  cold_boots: number;
  thaws: number;
  failures: number;
  fallbacks: number;
  restore_p50_ms: number;
  restore_p95_ms: number;
  restores_over_target: number;
}

/** @go api.ObsWakePhaseStat */
export interface ObsWakePhaseStat {
  /** restore and cold_boot are vmmd's phases, thaw and schedd are schedd's. */
  method: string;
  phase: string;
  samples: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
}

/** @go api.ObsWakeReasonCount */
export interface ObsWakeReasonCount {
  reason: string;
  count: number;
}

/** @go api.ObsWakeSample */
export interface ObsWakeSample {
  wake_id: string;
  instance_id?: string;
  app_id: string;
  app_slug?: string;
  account_id?: string;
  node_id?: string;
  node_name?: string;
  method: string;
  tier?: string;
  trigger?: string;
  cold_reason?: string;
  fallback_reason?: string;
  duration_ms: number;
  completed_at: string;
  /** "<method>/<phase>", the wake's longest phase. */
  slow_phase?: string;
  slow_phase_ms?: number;
}

/** @go api.ObsWakeAppStat */
export interface ObsWakeAppStat {
  app_id: string;
  app_slug?: string;
  account_id?: string;
  wakes: number;
  restores: number;
  cold_boots: number;
  fallbacks: number;
  top_cold_reason?: string;
  p95_ms: number;
}

/** @go api.ObsWakeLatencyReport */
export interface ObsWakeLatencyReport {
  window: string;
  since: string;
  as_of: string;
  target_ms: number;
  /** Event kinds that hit apid's per-kind read cap: the figures cover only the newest part of the window. */
  truncated?: string[];
  totals: ObsWakeTotals;
  methods: ObsWakeMethodStat[];
  nodes: ObsWakeNodeStat[];
  phases: ObsWakePhaseStat[];
  cold_reasons: ObsWakeReasonCount[];
  failure_reasons: ObsWakeReasonCount[];
  slowest: ObsWakeSample[];
  cold_boot_apps: ObsWakeAppStat[];
}

export const WAKE_WINDOWS = ['15m', '1h', '6h', '24h'] as const;
export type WakeWindow = (typeof WAKE_WINDOWS)[number];

export const isWakeWindow = (v: string | null): v is WakeWindow => WAKE_WINDOWS.includes(v as WakeWindow);

export interface WakeLatencyFilter {
  window?: WakeWindow;
  node?: string;
  appId?: string;
}

export function wakeLatencyQuery(f: WakeLatencyFilter): string {
  const q = new URLSearchParams();
  if (f.window && f.window !== '1h') q.set('window', f.window);
  if (f.node) q.set('node', f.node);
  if (f.appId) q.set('app_id', f.appId);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const getWakeLatency = (f: WakeLatencyFilter = {}) =>
  request<ObsWakeLatencyReport>(`/v1/admin/obs/wake-latency${wakeLatencyQuery(f)}`, { cache: 'no-store' });

/** Share of restores within target, as a whole percent; null with no restores. */
export function restoresWithinTargetPct(t: ObsWakeTotals): number | null {
  if (t.restores === 0) return null;
  return Math.floor(((t.restores - t.restores_over_target) / t.restores) * 100);
}

/** Share of wakes that cold booted instead of restoring or thawing, as a whole percent. */
export function coldBootPct(t: ObsWakeTotals): number | null {
  if (t.wakes === 0) return null;
  return Math.round((t.cold_boots / t.wakes) * 100);
}

/** "load_snapshot" → "load snapshot"; a schedd span keeps its pre_rpc/post_rpc prefix readable. */
export const phaseLabel = (phase: string) => phase.replace(/_/g, ' ');

export const methodLabel = (method: string) =>
  ({ restore: 'Restore', cold_boot: 'Cold boot', thaw: 'Thaw', schedd: 'Schedd' })[method] ?? method;

export function formatMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms} ms`;
}

/** A duration's tone against the restore target: within, up to twice, beyond. */
export function latencyTone(ms: number, targetMs: number): 'success' | 'warning' | 'danger' {
  if (ms <= targetMs) return 'success';
  if (ms <= targetMs * 2) return 'warning';
  return 'danger';
}
