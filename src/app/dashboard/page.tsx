'use client';

/* ==========================================================================
   Overview — the template's dashboard home.

   Sources, all real:
     • /v1/apps          — workflow inventory
     • /v1/apps/metrics  — gateway request volume, latency, errors (#393)
     • /v1/invocations   — dispatched work: queue, cron, delayed tasks
     • /v1/usage[/summary] — metered GB-hours and overage

   The distinction that runs through this page: the metrics endpoint measures
   HTTPS traffic at the gateway, while the invocations table records
   background dispatches that never touch the gateway. Neither is a superset
   of the other, so they are presented as separate panels rather than summed.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import {
  listApps, listInvocations, getUsageSummary, getUsageByApp, getAppsMetrics,
  isDegraded, METRICS_RANGES, type MetricsRange,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono, FilterSelect } from '@/components/ui/bits';
import { StatTile, SectionCard, MeterRow } from '@/components/ui/Panels';
import { DegradedNotice } from '@/components/ui/DegradedNotice';
import { AreaChart, BarChart } from '@/components/ui/Chart';
import { EmptyState, SkeletonBlock, ErrorState } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { PLANS, relativeTime, euros } from '@/lib/format';
import { invocationsByDay, totals, trend, compact, ms } from '@/lib/series';

const SAMPLE = 200;

const RANGE_LABEL: Record<MetricsRange, string> = {
  '5m': 'Last 5 minutes',
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '15d': 'Last 15 days',
};

const SOURCE_LABEL: Record<string, string> = {
  async_invoke: 'Async invoke',
  queue: 'Queue',
  cron: 'Cron',
  delayed_task: 'Delayed task',
};

export default function OverviewPage() {
  const { account } = useAuth();
  const [range, setRange] = useState<MetricsRange>('24h');

  const apps = useAsync(listApps, []);
  const metrics = useAsync(() => getAppsMetrics(range), [range]);
  const invocations = useAsync(
    async () => ({ rows: (await listInvocations(SAMPLE)).invocations, fetchedAt: Date.now() }),
    [],
  );
  const summary = useAsync(() => getUsageSummary(), []);
  const perApp = useAsync(() => getUsageByApp(), []);

  const degraded = isDegraded(metrics.data?.source);

  /* Gateway metrics, rolled up across apps. */
  const byApp = metrics.data?.apps ?? null;
  const metricRows = useMemo(
    () =>
      Object.entries(byApp ?? {})
        .map(([slug, m]) => ({ slug, m }))
        .sort((a, b) => b.m.request_count - a.m.request_count),
    [byApp],
  );
  const requestTotal = metricRows.reduce((s, r) => s + r.m.request_count, 0);
  const weighted = (pick: (m: (typeof metricRows)[number]['m']) => number) =>
    requestTotal === 0 ? 0 : metricRows.reduce((s, r) => s + pick(r.m) * r.m.request_count, 0) / requestTotal;

  /* Dispatched work, from the invocations table. */
  const rows = useMemo(() => invocations.data?.rows ?? [], [invocations.data]);
  const windowed = useMemo(() => {
    const cutoff = (invocations.data?.fetchedAt ?? 0) - 7 * 86_400_000;
    return rows.filter((r) => Date.parse(r.created_at) >= cutoff);
  }, [rows, invocations.data]);
  const series = useMemo(() => invocationsByDay(windowed, 7), [windowed]);
  const dispatch = useMemo(() => totals(windowed), [windowed]);
  const truncated = rows.length >= SAMPLE;

  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of windowed) counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [windowed]);

  const gbHourBars = useMemo(() => {
    const slugFor = (id: string) => apps.data?.find((a) => a.id === id)?.slug ?? id.slice(0, 6);
    return (perApp.data ?? [])
      .map((u) => ({
        date: new Date(),
        label: slugFor(u.app_id),
        value: Number((u.used_gb_hours ?? u.mb_seconds / 1024 / 3600).toFixed(3)),
      }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [perApp.data, apps.data]);

  const plan = account ? PLANS[account.plan] : null;

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="A high level overview of your infrastructure and usage."
        actions={
          <>
            <FilterSelect
              value={range}
              onChange={(v) => setRange(v as MetricsRange)}
              options={METRICS_RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
            />
            <button
              className="btn-icon btn-icon-bordered"
              onClick={() => {
                metrics.reload();
                invocations.reload();
                summary.reload();
                perApp.reload();
                apps.reload();
              }}
              aria-label="Refresh"
            >
              <Icon name="refresh" size={16} />
            </button>
          </>
        }
      />

      {degraded && metrics.data && <DegradedNotice source={metrics.data.source} onRetry={metrics.reload} />}

      {/* ── Stat tiles: gateway-measured ───────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Requests"
          value={metrics.data ? compact(requestTotal) : '—'}
          sub={RANGE_LABEL[range].toLowerCase()}
        />
        <StatTile
          label="p95 latency"
          value={metrics.data ? ms(weighted((m) => m.latency_p95_ms)) : '—'}
          sub={metrics.data ? `p99 ${ms(weighted((m) => m.latency_p99_ms))}` : undefined}
        />
        <StatTile
          label="Error rate"
          value={metrics.data ? `${weighted((m) => m.error_rate_pct).toFixed(2)}%` : '—'}
          color="var(--color-chart-alt)"
          sub={`across ${metricRows.length} workflow${metricRows.length === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Cold start rate"
          value={metrics.data ? `${weighted((m) => m.cold_start_pct).toFixed(1)}%` : '—'}
          sub={plan ? `${plan.ramMb} MB · ${plan.concurrency} concurrent` : undefined}
        />
      </div>

      {/* ── Dispatched work + top workflows ────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Dispatched work (7 days)"
          action={
            <span className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              {truncated ? `newest ${SAMPLE} dispatches` : 'queue · cron · delayed tasks'}
            </span>
          }
          bodyClassName="p-4"
        >
          {invocations.loading && !invocations.data ? (
            <SkeletonBlock height={260} />
          ) : invocations.error ? (
            <ErrorState error={invocations.error} onRetry={invocations.reload} />
          ) : windowed.length === 0 ? (
            <EmptyState
              icon="spark"
              title="No dispatched invocations"
              hint="Queue jobs, cron runs and async invokes appear here. HTTPS traffic is measured separately, in the tiles above."
            />
          ) : (
            <AreaChart points={series} height={260} valueLabel="Dispatches" format={(n) => compact(n)} />
          )}
        </SectionCard>

        <SectionCard
          title="Top services"
          action={
            <Link href="/dashboard/services" className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>
              View all
            </Link>
          }
          bodyClassName="p-2"
        >
          {metricRows.length === 0 ? (
            <EmptyState
              icon="workflows"
              title={degraded ? 'Metrics unavailable' : 'No traffic yet'}
              hint={degraded ? undefined : 'Services rank here once they serve requests.'}
            />
          ) : (
            <ul>
              {metricRows.slice(0, 6).map(({ slug, m }) => (
                <li key={slug}>
                  <Link
                    href={`/dashboard/services/${slug}`}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--color-surface-subtle)]"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand-bright)' }}
                    >
                      <Icon name="workflows" size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
                      {slug}
                    </span>
                    <span className="text-sm font-medium">{compact(m.request_count)}</span>
                    {m.error_rate_pct > 0 && (
                      <span className="text-xs" style={{ color: 'var(--color-danger)' }}>
                        {m.error_rate_pct.toFixed(1)}%
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* ── Recent dispatches · sources · usage ────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Recent dispatches"
          action={
            <Link href="/dashboard/queues" className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>
              View all
            </Link>
          }
        >
          {windowed.length === 0 ? (
            <EmptyState icon="clock" title="Nothing dispatched yet" />
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {windowed.slice(0, 5).map((r) => {
                  const app = apps.data?.find((a) => a.id === r.app_id);
                  return (
                    <tr key={r.id}>
                      <td className="cell-primary">
                        {app ? (
                          <Link href={`/dashboard/services/${app.slug}`} style={{ color: 'var(--color-brand)' }}>
                            {app.slug}
                          </Link>
                        ) : (
                          <Mono>{r.app_id.slice(0, 8)}</Mono>
                        )}
                      </td>
                      <td>{SOURCE_LABEL[r.source] ?? r.source}</td>
                      <td>
                        <StatusBadge state={r.state} />
                      </td>
                      <td>{relativeTime(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title="Dispatch sources" bodyClassName="space-y-3.5 px-5 py-5">
          {sources.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              No dispatches in this window.
            </p>
          ) : (
            sources.map(([source, count]) => (
              <MeterRow
                key={source}
                label={SOURCE_LABEL[source] ?? source}
                value={`${Math.round((count / windowed.length) * 100)}%`}
                pct={(count / windowed.length) * 100}
              />
            ))
          )}
          <div className="flex items-center justify-between pt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
            <span>Failed dispatches</span>
            <span style={{ color: dispatch.failed > 0 ? 'var(--color-danger)' : 'var(--color-ink)' }}>
              {dispatch.failed}
            </span>
          </div>
          {trend(series) && (
            <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
              Volume {trend(series)!.direction === 'up' ? 'up' : 'down'} {trend(series)!.pct.toFixed(1)}% versus the
              previous period.
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="Usage &amp; cost"
          action={
            <Link href="/dashboard/usage" className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>
              View details
            </Link>
          }
          bodyClassName="px-5 py-5"
        >
          {summary.data ? (
            <>
              <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                Overage this month
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[28px] font-bold leading-none">{euros(summary.data.overage_cents)}</span>
                <span className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                  {summary.data.month}
                </span>
              </div>
              <div className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                {summary.data.used_gb_hours.toFixed(2)} of {summary.data.included_gb_hours} GB-h included
                {plan ? ` on ${plan.label}` : ''}
              </div>
              <span className="meter mt-3">
                <span
                  style={{
                    width: `${Math.min(100, (summary.data.used_gb_hours / Math.max(1, summary.data.included_gb_hours)) * 100)}%`,
                  }}
                />
              </span>

              {gbHourBars.length > 0 && (
                <div className="mt-5">
                  <div className="mb-1 text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                    GB-hours by workflow
                  </div>
                  <BarChart points={gbHourBars} height={110} format={(n) => `${n} GB-h`} />
                </div>
              )}
            </>
          ) : summary.error ? (
            <ErrorState error={summary.error} onRetry={summary.reload} />
          ) : (
            <SkeletonBlock height={140} />
          )}
        </SectionCard>
      </div>

      {/* ── Footer strip ───────────────────────────────────────────────── */}
      <div className="card mt-4 flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
        <Fact icon="bolt" title="Firecracker powered" sub="< 350ms p50 cold wake" />
        <Fact icon="scale" title="Scale to zero" sub="Parked services cost nothing" />
        <Fact
          icon="shield"
          title="Hardware isolation"
          sub={plan ? `${plan.ramMb} MB · ${plan.concurrency} concurrent` : 'A microVM per tenant'}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <a href="/v1/openapi.yaml" target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            API reference <Icon name="external" size={12} />
          </a>
          <Link href="/dashboard/plans" className="btn btn-dark btn-sm">
            Upgrade plan
          </Link>
        </div>
      </div>
    </div>
  );
}

function Fact({ icon, title, sub }: { icon: 'bolt' | 'scale' | 'shield'; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand-bright)' }}
      >
        <Icon name={icon} size={16} />
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block text-xs" style={{ color: 'var(--color-ink-muted)' }}>
          {sub}
        </span>
      </span>
    </div>
  );
}
