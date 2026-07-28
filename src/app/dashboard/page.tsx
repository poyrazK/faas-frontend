'use client';

/* ==========================================================================
   Overview — the template's dashboard home.

   Sources, all real:
     • /v1/apps            — workflow inventory
     • /v1/invocations     — dispatch rows: the charts, error rate, latency
     • /v1/usage           — per-app metered requests + GB-hours this month
     • /v1/usage/summary   — account roll-up and overage

   The invocations endpoint pages at 200 rows, so when a busy account fills
   the page the header says so rather than implying it saw everything.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { listApps, listInvocations, getUsageSummary, getUsageByApp } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono, FilterSelect } from '@/components/ui/bits';
import { StatTile, SectionCard, MeterRow, TableFooter } from '@/components/ui/Panels';
import { AreaChart, BarChart } from '@/components/ui/Chart';
import { EmptyState, SkeletonBlock, ErrorState } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { PLANS, relativeTime, euros } from '@/lib/format';
import { invocationsByDay, failuresByDay, totals, rollupByApp, trend, compact, ms } from '@/lib/series';

const SAMPLE = 200;

const SOURCE_LABEL: Record<string, string> = {
  async_invoke: 'Async invoke',
  queue: 'Queue',
  cron: 'Cron',
  delayed_task: 'Delayed task',
};

export default function OverviewPage() {
  const { account } = useAuth();
  const [days, setDays] = useState(7);

  const apps = useAsync(listApps, []);
  // Stamped at fetch time so the trailing window is anchored to when the data
  // was read, not to every render — render stays pure.
  const invocations = useAsync(
    async () => ({ rows: (await listInvocations(SAMPLE)).invocations, fetchedAt: Date.now() }),
    [],
  );
  const summary = useAsync(() => getUsageSummary(), []);
  const perApp = useAsync(() => getUsageByApp(), []);

  const rows = useMemo(() => invocations.data?.rows ?? [], [invocations.data]);
  const windowed = useMemo(() => {
    const cutoff = (invocations.data?.fetchedAt ?? 0) - days * 86_400_000;
    return rows.filter((r) => Date.parse(r.created_at) >= cutoff);
  }, [rows, days, invocations.data]);

  const series = useMemo(() => invocationsByDay(windowed, days), [windowed, days]);
  const errorSeries = useMemo(() => failuresByDay(windowed, days), [windowed, days]);
  const stats = useMemo(() => totals(windowed), [windowed]);
  const rollup = useMemo(
    () => rollupByApp(apps.data ?? [], windowed, perApp.data),
    [apps.data, windowed, perApp.data],
  );

  const meteredRequests = perApp.data?.reduce((s, u) => s + (u.requests ?? 0), 0) ?? null;
  const truncated = rows.length >= SAMPLE;
  const plan = account ? PLANS[account.plan] : null;

  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of windowed) counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [windowed]);

  const gbHourBars = useMemo(
    () =>
      rollup
        .filter((r) => (r.usedGbHours ?? 0) > 0)
        .slice(0, 12)
        .map((r) => ({ date: new Date(), label: r.slug, value: Number((r.usedGbHours ?? 0).toFixed(3)) })),
    [rollup],
  );

  const loadingCore = invocations.loading && !invocations.data;

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="A high level overview of your infrastructure and usage."
        actions={
          <>
            <FilterSelect
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              options={[
                { value: '7', label: 'Last 7 days' },
                { value: '14', label: 'Last 14 days' },
                { value: '30', label: 'Last 30 days' },
              ]}
            />
            <button
              className="btn-icon btn-icon-bordered"
              onClick={() => {
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

      {/* ── Stat tiles ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Metered requests"
          value={meteredRequests == null ? '—' : compact(meteredRequests)}
          sub={summary.data ? `Billing month ${summary.data.month}` : 'This billing month'}
        />
        <StatTile
          label="Invocations"
          value={compact(stats.total)}
          trend={trend(series)}
          series={series}
          sub={`${stats.completed} completed · ${stats.pending} in flight`}
        />
        <StatTile
          label="Avg time to completion"
          value={ms(stats.avgCompletionMs)}
          sub={stats.p95CompletionMs != null ? `p95 ${ms(stats.p95CompletionMs)}` : 'Queue wait + wake + run'}
        />
        <StatTile
          label="Error rate"
          value={`${stats.errorRatePct.toFixed(2)}%`}
          trend={trend(errorSeries)}
          invertTrend
          series={errorSeries}
          color="var(--color-chart-alt)"
          sub={`${stats.failed} failed of ${stats.completed + stats.failed} finished`}
        />
      </div>

      {/* ── Chart + top workflows ──────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Invocations"
          action={
            <span className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              {truncated ? `newest ${SAMPLE} dispatches` : 'dispatched work'}
            </span>
          }
          bodyClassName="p-4"
        >
          {loadingCore ? (
            <SkeletonBlock height={260} />
          ) : invocations.error ? (
            <ErrorState error={invocations.error} onRetry={invocations.reload} />
          ) : windowed.length === 0 ? (
            <EmptyState
              icon="spark"
              title="No dispatched invocations"
              hint="Queue jobs, cron runs and async invokes appear here. Synchronous HTTPS traffic isn't recorded in this table."
            />
          ) : (
            <AreaChart points={series} height={260} valueLabel="Invocations" format={(n) => compact(n)} />
          )}
        </SectionCard>

        <SectionCard
          title="Top workflows"
          action={
            <Link href="/dashboard/workflows" className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>
              View all
            </Link>
          }
          bodyClassName="p-2"
        >
          {rollup.length === 0 ? (
            <EmptyState icon="workflows" title="No workflows yet" hint="Create one to see it ranked here." />
          ) : (
            <ul>
              {rollup.slice(0, 6).map((r) => (
                <li key={r.app_id}>
                  <Link
                    href={`/dashboard/workflows/${r.slug}`}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--color-surface-subtle)]"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand-bright)' }}
                    >
                      <Icon name="workflows" size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
                      {r.slug}
                    </span>
                    <span className="text-sm font-medium">
                      {r.requests != null ? compact(r.requests) : compact(r.invocations)}
                    </span>
                    {r.failed > 0 && (
                      <span className="text-xs" style={{ color: 'var(--color-danger)' }}>
                        {r.failed} failed
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* ── Recent invocations · sources · usage ───────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Recent invocations"
          action={
            <Link href="/dashboard/logs" className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>
              View all
            </Link>
          }
        >
          {windowed.length === 0 ? (
            <EmptyState icon="clock" title="Nothing dispatched yet" />
          ) : (
            <>
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
                            <Link href={`/dashboard/workflows/${app.slug}`} style={{ color: 'var(--color-brand)' }}>
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
              <TableFooter from={1} to={Math.min(5, windowed.length)} total={windowed.length} noun="invocations" />
            </>
          )}
        </SectionCard>

        <SectionCard title="Invocation sources" bodyClassName="space-y-3.5 px-5 py-5">
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
          <p className="pt-1 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
            Gregale runs a single region today, so traffic isn&apos;t split geographically.
          </p>
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
        <Fact icon="scale" title="Scale to zero" sub="Parked apps cost nothing" />
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
