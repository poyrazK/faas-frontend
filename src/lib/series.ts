/* ==========================================================================
   Gregale — derived series for the console's charts.

   The control plane exposes no metrics endpoint, so everything the template
   renders as a chart is folded here from two real sources:

     • GET /v1/invocations  — one row per async/queue/cron/delayed dispatch
     • GET /v1/usage        — per-app GB-hours and request counts for a month

   Nothing in this file invents a data point. When the source rows don't cover
   a bucket, the bucket is genuinely zero, and callers that have no rows at all
   are expected to render an empty state rather than a flat line.

   CAVEAT worth keeping in mind when reading these numbers: `/v1/invocations`
   only records *dispatched* work (async_invoke, queue, delayed_task, cron).
   Plain synchronous HTTPS traffic through the gateway never lands in this
   table, so these series describe background execution, not total requests.
   ========================================================================== */

import type { Invocation, InvocationState, AppUsage, App } from './api';

export interface Point {
  /** Bucket start, midnight UTC. */
  date: Date;
  label: string;
  value: number;
}

const DAY_MS = 86_400_000;

function startOfUTCDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Buckets invocations into one point per day over the trailing `days` window,
 * oldest first. Rows outside the window are ignored.
 */
export function invocationsByDay(rows: Invocation[], days = 7): Point[] {
  const today = startOfUTCDay(new Date());
  const first = today - (days - 1) * DAY_MS;

  const counts = new Map<number, number>();
  for (let i = 0; i < days; i++) counts.set(first + i * DAY_MS, 0);

  for (const r of rows) {
    const t = Date.parse(r.created_at);
    if (Number.isNaN(t)) continue;
    const bucket = startOfUTCDay(new Date(t));
    if (bucket < first || bucket > today) continue;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, value]) => ({ date: new Date(ms), label: dayLabel(ms), value }));
}

/** Same bucketing, but counting only rows in a failed terminal state. */
export function failuresByDay(rows: Invocation[], days = 7): Point[] {
  return invocationsByDay(rows.filter((r) => r.state === 'failed'), days);
}

export interface Totals {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  /** Failed ÷ terminal rows, as a percentage. 0 when nothing has finished. */
  errorRatePct: number;
  /**
   * Mean created_at → completed_at across completed rows, in ms. This is
   * end-to-end time-to-completion (queue wait + cold wake + execution), NOT
   * pure execution duration — the API doesn't break those apart.
   */
  avgCompletionMs: number | null;
  p95CompletionMs: number | null;
}

const TERMINAL: InvocationState[] = ['completed', 'failed', 'cancelled'];

export function totals(rows: Invocation[]): Totals {
  const completed = rows.filter((r) => r.state === 'completed');
  const failed = rows.filter((r) => r.state === 'failed');
  const terminal = rows.filter((r) => TERMINAL.includes(r.state));
  const pending = rows.filter((r) => r.state === 'pending' || r.state === 'dispatching');

  const durations = completed
    .map((r) => (r.completed_at ? Date.parse(r.completed_at) - Date.parse(r.created_at) : NaN))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);

  const mean = durations.length
    ? Math.round(durations.reduce((s, n) => s + n, 0) / durations.length)
    : null;
  const p95 = durations.length
    ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
    : null;

  return {
    total: rows.length,
    completed: completed.length,
    failed: failed.length,
    pending: pending.length,
    errorRatePct: terminal.length ? (failed.length / terminal.length) * 100 : 0,
    avgCompletionMs: mean,
    p95CompletionMs: p95,
  };
}

export interface AppRollup {
  app_id: string;
  slug: string;
  invocations: number;
  failed: number;
  /** Requests counted by the metering pipeline for the month, when available. */
  requests: number | null;
  usedGbHours: number | null;
  avgCompletionMs: number | null;
}

/**
 * Joins apps with their invocation rows and (optionally) the month's metered
 * usage, newest-heaviest first. Apps with no activity still appear, with
 * zeroes — they exist, they just haven't run.
 */
export function rollupByApp(apps: App[], rows: Invocation[], usage?: AppUsage[] | null): AppRollup[] {
  const usageById = new Map((usage ?? []).map((u) => [u.app_id, u]));

  return apps
    .map((app) => {
      const mine = rows.filter((r) => r.app_id === app.id);
      const u = usageById.get(app.id);
      return {
        app_id: app.id,
        slug: app.slug,
        invocations: mine.length,
        failed: mine.filter((r) => r.state === 'failed').length,
        requests: u ? u.requests : null,
        usedGbHours: u ? (u.used_gb_hours ?? u.mb_seconds / 1024 / 3600) : null,
        avgCompletionMs: totals(mine).avgCompletionMs,
      };
    })
    .sort((a, b) => (b.requests ?? b.invocations) - (a.requests ?? a.invocations));
}

/** Human duration for chart axes and stat tiles. */
export function ms(value: number | null): string {
  if (value == null) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)}s`;
  return `${Math.round(value / 60_000)}m`;
}

/** Compact counts: 24800000 → "24.8M". */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 1000) return String(n);
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/**
 * Percentage change between the trailing half of a series and the half before
 * it — the "↑ 12.4% vs previous period" delta on the stat tiles. Returns null
 * when the earlier half is empty, since "up from nothing" isn't a percentage.
 */
export function trend(points: Point[]): { pct: number; direction: 'up' | 'down' | 'flat' } | null {
  if (points.length < 4) return null;
  const half = Math.floor(points.length / 2);
  const earlier = points.slice(0, half).reduce((s, p) => s + p.value, 0);
  const later = points.slice(points.length - half).reduce((s, p) => s + p.value, 0);
  if (earlier === 0) return null;
  const pct = ((later - earlier) / earlier) * 100;
  return { pct: Math.abs(pct), direction: pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat' };
}
