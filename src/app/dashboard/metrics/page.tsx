'use client';

/* ==========================================================================
   Metrics — everything derivable from the invocations table plus the month's
   metered usage. There is no time-series metrics backend, so this page is
   explicit about the two things it can't do: it samples the newest 200
   dispatches, and it doesn't see synchronous gateway traffic at all.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { listApps, listInvocations, getUsageByApp } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, FilterSelect } from '@/components/ui/bits';
import { StatTile, SectionCard, MeterRow } from '@/components/ui/Panels';
import { AreaChart, BarChart } from '@/components/ui/Chart';
import { AsyncBoundary, EmptyState, SkeletonBlock } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { invocationsByDay, failuresByDay, totals, rollupByApp, trend, compact, ms } from '@/lib/series';

const SAMPLE = 200;

export default function MetricsPage() {
  const apps = useAsync(listApps, []);
  // Stamped at fetch time so the trailing window doesn't depend on render time.
  const invocations = useAsync(
    async () => ({ rows: (await listInvocations(SAMPLE)).invocations, fetchedAt: Date.now() }),
    [],
  );
  const usage = useAsync(() => getUsageByApp(), []);

  const [days, setDays] = useState(7);
  const [scope, setScope] = useState('all');

  const all = useMemo(() => invocations.data?.rows ?? [], [invocations.data]);

  const rows = useMemo(() => {
    const cutoff = (invocations.data?.fetchedAt ?? 0) - days * 86_400_000;
    const app = apps.data?.find((a) => a.slug === scope);
    return all.filter((r) => Date.parse(r.created_at) >= cutoff && (scope === 'all' || r.app_id === app?.id));
  }, [all, days, scope, apps.data, invocations.data]);

  const series = useMemo(() => invocationsByDay(rows, days), [rows, days]);
  const errors = useMemo(() => failuresByDay(rows, days), [rows, days]);
  const stats = useMemo(() => totals(rows), [rows]);
  const rollup = useMemo(() => rollupByApp(apps.data ?? [], rows, usage.data), [apps.data, rows, usage.data]);

  /** Completion times bucketed into readable latency bands. */
  const latencyBands = useMemo(() => {
    const bands: { label: string; max: number }[] = [
      { label: '<250ms', max: 250 },
      { label: '<500ms', max: 500 },
      { label: '<1s', max: 1000 },
      { label: '<5s', max: 5000 },
      { label: '<30s', max: 30_000 },
      { label: '30s+', max: Infinity },
    ];
    const counts = bands.map(() => 0);
    let total = 0;
    for (const r of rows) {
      if (r.state !== 'completed' || !r.completed_at) continue;
      const d = Date.parse(r.completed_at) - Date.parse(r.created_at);
      if (!Number.isFinite(d) || d < 0) continue;
      total++;
      counts[bands.findIndex((b) => d < b.max)]++;
    }
    return { bands, counts, total };
  }, [rows]);

  const gbBars = useMemo(
    () =>
      rollup
        .filter((r) => (r.usedGbHours ?? 0) > 0)
        .slice(0, 12)
        .map((r) => ({ date: new Date(), label: r.slug, value: Number((r.usedGbHours ?? 0).toFixed(3)) })),
    [rollup],
  );

  return (
    <div>
      <PageHeader
        title="Metrics"
        subtitle="Throughput, latency and failures across your workflows."
        actions={
          <>
            <FilterSelect
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'All Workflows' },
                ...(apps.data ?? []).map((a) => ({ value: a.slug, label: a.slug })),
              ]}
            />
            <FilterSelect
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              options={[
                { value: '7', label: 'Last 7 days' },
                { value: '14', label: 'Last 14 days' },
                { value: '30', label: 'Last 30 days' },
              ]}
            />
            <button className="btn-icon btn-icon-bordered" onClick={() => invocations.reload()} aria-label="Refresh">
              <Icon name="refresh" size={16} />
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Invocations" value={compact(stats.total)} series={series} trend={trend(series)} />
        <StatTile label="Avg completion" value={ms(stats.avgCompletionMs)} sub="Queue wait + wake + run" />
        <StatTile label="p95 completion" value={ms(stats.p95CompletionMs)} sub={`${latencyBands.total} timed runs`} />
        <StatTile
          label="Error rate"
          value={`${stats.errorRatePct.toFixed(2)}%`}
          series={errors}
          trend={trend(errors)}
          invertTrend
          color="var(--color-chart-alt)"
          sub={`${stats.failed} failed`}
        />
      </div>

      <AsyncBoundary state={invocations} skeleton={<SkeletonBlock height={280} />}>
        {() =>
          rows.length === 0 ? (
            <div className="card mt-4">
              <EmptyState
                icon="metrics"
                title="No data in this window"
                hint="Metrics are derived from dispatched invocations — queue jobs, cron runs and async invokes. Nothing has run in the selected period."
                action={<Link href="/dashboard/workflows" className="btn btn-secondary">View workflows</Link>}
              />
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <SectionCard className="xl:col-span-2" title="Invocations over time" bodyClassName="p-4">
                  <AreaChart points={series} height={250} format={(n) => compact(n)} />
                </SectionCard>

                <SectionCard title="Completion time distribution" bodyClassName="space-y-3.5 px-5 py-5">
                  {latencyBands.total === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                      Nothing has completed in this window.
                    </p>
                  ) : (
                    latencyBands.bands.map((b, i) => (
                      <MeterRow
                        key={b.label}
                        label={b.label}
                        value={latencyBands.counts[i]}
                        pct={(latencyBands.counts[i] / latencyBands.total) * 100}
                      />
                    ))
                  )}
                </SectionCard>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <SectionCard className="xl:col-span-2" title="By workflow">
                  <div className="overflow-x-auto">
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th>Workflow</th>
                          <th>Invocations</th>
                          <th>Failed</th>
                          <th>Avg completion</th>
                          <th>Metered requests</th>
                          <th>GB-hours</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rollup.map((r) => (
                          <tr key={r.app_id}>
                            <td className="cell-primary">
                              <Link href={`/dashboard/workflows/${r.slug}`} style={{ color: 'var(--color-brand)' }}>{r.slug}</Link>
                            </td>
                            <td>{compact(r.invocations)}</td>
                            <td style={r.failed > 0 ? { color: 'var(--color-danger)' } : undefined}>{r.failed || '—'}</td>
                            <td>{ms(r.avgCompletionMs)}</td>
                            <td>{r.requests != null ? compact(r.requests) : '—'}</td>
                            <td>{r.usedGbHours != null ? r.usedGbHours.toFixed(3) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <SectionCard title="GB-hours this month" bodyClassName="px-5 py-5">
                  {gbBars.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                      No metered compute yet this month.
                    </p>
                  ) : (
                    <BarChart points={gbBars} height={180} format={(n) => `${n} GB-h`} />
                  )}
                </SectionCard>
              </div>
            </>
          )
        }
      </AsyncBoundary>

      <p className="mt-4 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
        Derived from the newest {SAMPLE} invocation rows and this month&apos;s metering. Invocations cover dispatched
        work only — synchronous HTTPS requests through the gateway aren&apos;t recorded per-request, so use metered
        requests for billable traffic.
      </p>
    </div>
  );
}
