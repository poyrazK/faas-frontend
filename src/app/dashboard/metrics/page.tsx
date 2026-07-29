'use client';

/* ==========================================================================
   Metrics — gateway-measured, from /v1/apps/metrics (#393), which rolls up
   every app in one call.

   This page used to derive its numbers from the invocations table, which only
   ever saw dispatched work (queue / cron / delayed tasks) and never plain
   HTTPS traffic. These figures come from the gateway itself, so they cover
   real request volume, latency percentiles and error rate.

   Two contract details that shape the UI:
     • `source` may be "degraded: <reason>", in which case every number is a
       zero placeholder — see <DegradedNotice>.
     • `wake_p95_ms` is the FLEET p95; the underlying histogram is unlabeled.
       It is deliberately labelled as platform-wide, not per-app.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  listApps, getAppsMetrics, listInvocations, isDegraded,
  METRICS_RANGES, type MetricsRange, type AppMetrics,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, FilterSelect } from '@/components/ui/bits';
import { StatTile, SectionCard, MeterRow } from '@/components/ui/Panels';
import { DegradedNotice } from '@/components/ui/DegradedNotice';
import { AsyncBoundary, EmptyState, SkeletonBlock } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { compact, ms, totals } from '@/lib/series';
import { relativeTime } from '@/lib/format';

const RANGE_LABEL: Record<MetricsRange, string> = {
  '5m': 'Last 5 minutes',
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '15d': 'Last 15 days',
};

/** Weighted mean of a percentile across apps, weighted by request volume. */
function weighted(rows: AppMetrics[], pick: (m: AppMetrics) => number): number {
  const total = rows.reduce((s, r) => s + r.request_count, 0);
  if (total === 0) return 0;
  return rows.reduce((s, r) => s + pick(r) * r.request_count, 0) / total;
}

export default function MetricsPage() {
  const [range, setRange] = useState<MetricsRange>('24h');
  const [scope, setScope] = useState('all');

  const apps = useAsync(listApps, []);
  const metrics = useAsync(() => getAppsMetrics(range), [range]);
  // Invocations still own the dispatched-work view: cron/queue failures never
  // reach the gateway, so they are invisible to the metrics endpoint.
  const invocations = useAsync(() => listInvocations(200), []);

  const degraded = isDegraded(metrics.data?.source);

  const rows = useMemo(() => {
    const byslug = metrics.data?.apps ?? {};
    const entries = Object.entries(byslug).filter(([slug]) => scope === 'all' || slug === scope);
    return entries
      .map(([slug, m]) => ({ slug, m }))
      .sort((a, b) => b.m.request_count - a.m.request_count);
  }, [metrics.data, scope]);

  const all = rows.map((r) => r.m);
  const requestTotal = all.reduce((s, m) => s + m.request_count, 0);
  const errorRate = weighted(all, (m) => m.error_rate_pct);
  const coldStart = weighted(all, (m) => m.cold_start_pct);
  const p95 = weighted(all, (m) => m.latency_p95_ms);
  const p99 = weighted(all, (m) => m.latency_p99_ms);
  const wakeP95 = all.length ? Math.max(...all.map((m) => m.wake_p95_ms)) : 0;

  /** Dispatched-work failures, which the gateway never sees. */
  const dispatch = useMemo(() => {
    const list = (invocations.data?.invocations ?? []).filter(
      (r) => scope === 'all' || apps.data?.find((a) => a.slug === scope)?.id === r.app_id,
    );
    return totals(list);
  }, [invocations.data, scope, apps.data]);

  const latencyBands = useMemo(
    () =>
      all.length === 0
        ? []
        : [
            { label: 'p50', value: weighted(all, (m) => m.latency_p50_ms) },
            { label: 'p95', value: p95 },
            { label: 'p99', value: p99 },
          ],
    [all, p95, p99],
  );
  const bandMax = Math.max(...latencyBands.map((b) => b.value), 1);

  return (
    <div>
      <PageHeader
        title="Metrics"
        subtitle="Gateway-measured request volume, latency and errors."
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
              value={range}
              onChange={(v) => setRange(v as MetricsRange)}
              options={METRICS_RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
            />
            <button className="btn-icon btn-icon-bordered" onClick={() => metrics.reload()} aria-label="Refresh">
              <Icon name="refresh" size={16} />
            </button>
          </>
        }
      />

      {degraded && metrics.data && <DegradedNotice source={metrics.data.source} onRetry={metrics.reload} />}

      <AsyncBoundary state={metrics} skeleton={<SkeletonBlock height={140} />}>
        {(data) =>
          !data.apps || rows.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="metrics"
                title={degraded ? 'Metrics backend unavailable' : 'No traffic in this window'}
                hint={
                  degraded
                    ? 'Nothing can be measured until the metrics backend recovers.'
                    : `No requests reached your workflows in the ${RANGE_LABEL[range].toLowerCase()}.`
                }
                action={<Link href="/dashboard/workflows" className="btn btn-secondary">View workflows</Link>}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile
                  label="Requests"
                  value={compact(requestTotal)}
                  sub={`${RANGE_LABEL[range].toLowerCase()} · ${rows.length} workflow${rows.length === 1 ? '' : 's'}`}
                />
                <StatTile label="p95 latency" value={ms(p95)} sub={`p99 ${ms(p99)}`} />
                <StatTile
                  label="Error rate"
                  value={`${errorRate.toFixed(2)}%`}
                  color="var(--color-chart-alt)"
                  sub="2xx-class latency excludes these"
                />
                <StatTile label="Cold start rate" value={`${coldStart.toFixed(1)}%`} sub={`fleet wake p95 ${ms(wakeP95)}`} />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <SectionCard
                  className="xl:col-span-2"
                  title="By workflow"
                  action={
                    <span className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                      as of {relativeTime(data.as_of)}
                    </span>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th>Workflow</th>
                          <th>Requests</th>
                          <th>p50</th>
                          <th>p95</th>
                          <th>p99</th>
                          <th>Error rate</th>
                          <th>Cold starts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ slug, m }) => (
                          <tr key={slug}>
                            <td className="cell-primary">
                              <Link href={`/dashboard/workflows/${slug}`} style={{ color: 'var(--color-brand)' }}>
                                {slug}
                              </Link>
                            </td>
                            <td>{compact(m.request_count)}</td>
                            <td>{ms(m.latency_p50_ms)}</td>
                            <td>{ms(m.latency_p95_ms)}</td>
                            <td>{ms(m.latency_p99_ms)}</td>
                            <td style={m.error_rate_pct > 0 ? { color: 'var(--color-danger)' } : undefined}>
                              {m.error_rate_pct.toFixed(2)}%
                            </td>
                            <td>{m.cold_start_pct.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <div className="space-y-4">
                  <SectionCard title="Latency percentiles" bodyClassName="space-y-3.5 px-5 py-5">
                    {latencyBands.map((b) => (
                      <MeterRow key={b.label} label={b.label} value={ms(b.value)} pct={(b.value / bandMax) * 100} />
                    ))}
                    <p className="pt-1 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                      Request-volume weighted across {rows.length} workflow{rows.length === 1 ? '' : 's'}. 2xx responses
                      only — failures are counted in the error rate instead.
                    </p>
                  </SectionCard>

                  <SectionCard title="Dispatched work" bodyClassName="px-5 py-5">
                    <p className="mb-3 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                      Cron, queue and delayed-task runs never pass through the gateway, so they are counted separately
                      from the request metrics above.
                    </p>
                    <div className="space-y-2.5 text-sm">
                      <Row k="Dispatches seen" v={compact(dispatch.total)} />
                      <Row k="Failed" v={String(dispatch.failed)} danger={dispatch.failed > 0} />
                      <Row k="In flight" v={String(dispatch.pending)} />
                      <Row k="Avg completion" v={ms(dispatch.avgCompletionMs)} />
                    </div>
                    <Link
                      href="/dashboard/queues"
                      className="mt-4 inline-flex items-center gap-1 text-sm font-medium"
                      style={{ color: 'var(--color-brand)' }}
                    >
                      Queue jobs <Icon name="arrowRight" size={13} />
                    </Link>
                  </SectionCard>
                </div>
              </div>
            </>
          )
        }
      </AsyncBoundary>

      <p className="mt-4 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
        Measured by the gateway and served from Prometheus, bounded by its 15-day retention. Wake p95 is fleet-wide —
        the underlying histogram is unlabeled, so it is not specific to your workflows.
      </p>
    </div>
  );
}

function Row({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'var(--color-ink-muted)' }}>{k}</span>
      <span className="font-medium" style={{ color: danger ? 'var(--color-danger)' : 'var(--color-ink)' }}>{v}</span>
    </div>
  );
}
