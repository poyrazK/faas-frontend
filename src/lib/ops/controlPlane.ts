/* ==========================================================================
   Control-plane health (apid ADR-20261126120000).

     GET /v1/admin/obs/control-plane

   The control plane's Postgres, its backups and WAL, the delivery outboxes,
   every daemon's database pool and pg_notify hub, the control-plane scrape
   targets and the host. Each check copies the threshold of the alert it
   mirrors.
   ========================================================================== */

import { request } from '@/lib/api';

/** @go api.ObsControlPlaneTotals */
export interface ObsControlPlaneTotals {
  checks: number;
  critical: number;
  warning: number;
  unknown: number;
}

/** @go api.ObsControlPlaneCheck */
export interface ObsControlPlaneCheck {
  key: string;
  /** postgres, backups, delivery or daemons. */
  group: string;
  label: string;
  /** ok, warning, critical or unknown (not read, or its collector is stale). */
  state: string;
  value?: number;
  /** percent, seconds, count or bytes. */
  unit: string;
  warn_at?: number;
  critical_at?: number;
  /** Last success of a backup or archive signal. */
  at?: string;
  detail: string;
  /** The alert this check mirrors. */
  alert?: string;
}

/** @go api.ObsControlPlanePostgres */
export interface ObsControlPlanePostgres {
  client_connections?: number;
  connection_capacity?: number;
  database_size_bytes?: number;
  longest_query_seconds?: number;
  oldest_transaction_seconds?: number;
  idle_in_transaction_max_seconds?: number;
  cache_hit_percent?: number;
  commits_per_second?: number;
  rollback_percent?: number;
  temp_bytes?: number;
  collector_age_seconds?: number;
}

/** @go api.ObsControlPlaneBackend */
export interface ObsControlPlaneBackend {
  application: string;
  state: string;
  count: number;
}

/** @go api.ObsControlPlaneStatement */
export interface ObsControlPlaneStatement {
  query_id: string;
  /** pg_stat_statements' normalized text (no parameter values). */
  query: string;
  exec_seconds: number;
  calls?: number;
  mean_ms?: number;
}

/** @go api.ObsControlPlanePool */
export interface ObsControlPlanePool {
  pool: string;
  job: string;
  node?: string;
  acquired: number;
  idle: number;
  max?: number;
  utilization_percent?: number;
  canceled_acquires: number;
  mean_acquire_wait_ms?: number;
  state: string;
}

/** @go api.ObsControlPlaneNotifyHub */
export interface ObsControlPlaneNotifyHub {
  hub: string;
  job: string;
  node?: string;
  conns: number;
  subscribers: number;
  reconnects: number;
  state: string;
}

/** @go api.ObsControlPlaneTarget */
export interface ObsControlPlaneTarget {
  job: string;
  instance: string;
  up: boolean;
}

/** @go api.ObsControlPlaneHost */
export interface ObsControlPlaneHost {
  cpus?: number;
  load1?: number;
  mem_total_bytes?: number;
  mem_available_bytes?: number;
}

/** @go api.ObsControlPlaneReport */
export interface ObsControlPlaneReport {
  as_of: string;
  /** observed, partial, unavailable or not_configured. */
  source: string;
  failed_queries: string[];
  window_seconds: number;
  /** The worst check's state. */
  state: string;
  totals: ObsControlPlaneTotals;
  checks: ObsControlPlaneCheck[];
  postgres: ObsControlPlanePostgres;
  backends: ObsControlPlaneBackend[];
  statements: ObsControlPlaneStatement[];
  pools: ObsControlPlanePool[];
  notify_hubs: ObsControlPlaneNotifyHub[];
  targets: ObsControlPlaneTarget[];
  host: ObsControlPlaneHost;
}

export const getControlPlane = () => request<ObsControlPlaneReport>('/v1/admin/obs/control-plane', { cache: 'no-store' });

/** Badge tone for a check, pool or hub state. */
export function cpStateTone(state: string): 'danger' | 'warning' | 'success' | 'neutral' {
  switch (state) {
    case 'critical':
      return 'danger';
    case 'warning':
    case 'unknown':
      return 'warning';
    case 'ok':
      return 'success';
    default:
      return 'neutral';
  }
}

const STATE_LABELS: Record<string, string> = { critical: 'Critical', warning: 'Warning', unknown: 'Not reported', ok: 'OK' };

export const cpStateLabel = (state: string) => STATE_LABELS[state] ?? state;

const GROUP_LABELS: Record<string, string> = {
  postgres: 'Postgres',
  backups: 'Backups & WAL',
  delivery: 'Delivery outboxes',
  daemons: 'Daemons',
};

export const CP_GROUPS = ['postgres', 'backups', 'delivery', 'daemons'] as const;

export const cpGroupLabel = (group: string) => GROUP_LABELS[group] ?? group;

/** Seconds as "45 s", "12 min", "3.5 h" or "2.1 d". */
export function formatSeconds(s: number | null | undefined): string {
  if (s == null) return '—';
  if (s < 120) return `${Math.round(s)} s`;
  if (s < 7200) return `${Math.round(s / 60)} min`;
  if (s < 48 * 3600) return `${Number((s / 3600).toFixed(1))} h`;
  return `${Number((s / 86400).toFixed(1))} d`;
}

/** A check's threshold in its unit, e.g. "warn > 75% · critical > 90%". */
export function formatThreshold(c: ObsControlPlaneCheck): string {
  const fmt = (v: number) => (c.unit === 'percent' ? `${v}%` : c.unit === 'seconds' ? formatSeconds(v) : `${v}`);
  const parts: string[] = [];
  if (c.warn_at != null) parts.push(`warn > ${fmt(c.warn_at)}`);
  if (c.critical_at != null) parts.push(`critical > ${fmt(c.critical_at)}`);
  return parts.join(' · ');
}

/** Checks of one group, worst first, then in report order. */
export function checksOf(r: ObsControlPlaneReport, group: string): ObsControlPlaneCheck[] {
  const rank: Record<string, number> = { critical: 0, warning: 1, unknown: 2, ok: 3 };
  return r.checks
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.group === group)
    .sort((a, b) => (rank[a.c.state] ?? 4) - (rank[b.c.state] ?? 4) || a.i - b.i)
    .map(({ c }) => c);
}
