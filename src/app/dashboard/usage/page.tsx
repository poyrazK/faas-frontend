'use client';

/* ==========================================================================
   Usage — the month's metered consumption. Plan switching lives on /plans;
   this page is purely "what did I use and what will it cost".
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { getUsageSummary, getUsageByApp, listApps } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/lib/auth';
import { PageHeader, FilterSelect } from '@/components/ui/bits';
import { StatTile, SectionCard, MeterRow } from '@/components/ui/Panels';
import { BarChart } from '@/components/ui/Chart';
import { AsyncBoundary, EmptyState, SkeletonBlock } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { PLANS, euros } from '@/lib/format';
import { compact } from '@/lib/series';

/** The last six billing months, newest first, as YYYY-MM. */
function recentMonths(count = 6): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export default function UsagePage() {
  const { account } = useAuth();
  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState(months[0]);

  const summary = useAsync(() => getUsageSummary(month), [month]);
  const perApp = useAsync(() => getUsageByApp(month), [month]);
  const apps = useAsync(listApps, []);

  const plan = account ? PLANS[account.plan] : null;
  const appSlug = (id: string) => apps.data?.find((a) => a.id === id)?.slug ?? id.slice(0, 8);

  const rows = useMemo(() => {
    const list = (perApp.data ?? []).map((u) => ({
      app_id: u.app_id,
      slug: appSlug(u.app_id),
      requests: u.requests ?? 0,
      gbHours: u.used_gb_hours ?? u.mb_seconds / 1024 / 3600,
    }));
    return list.sort((a, b) => b.gbHours - a.gbHours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perApp.data, apps.data]);

  const totalGb = rows.reduce((s, r) => s + r.gbHours, 0);
  const totalRequests = rows.reduce((s, r) => s + r.requests, 0);

  return (
    <div>
      <PageHeader
        title="Usage"
        subtitle="Metered compute and requests for the billing month."
        actions={
          <>
            <FilterSelect value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: m }))} />
            <Link href="/dashboard/plans" className="btn btn-secondary">
              <Icon name="plans" size={14} /> Change plan
            </Link>
          </>
        }
      />

      <AsyncBoundary state={summary} skeleton={<SkeletonBlock height={140} />}>
        {(u) => {
          const pct = u.included_gb_hours > 0 ? Math.min(100, (u.used_gb_hours / u.included_gb_hours) * 100) : 0;
          return (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile
                  label="GB-hours used"
                  value={u.used_gb_hours.toFixed(2)}
                  sub={`of ${u.included_gb_hours} included${plan ? ` on ${plan.label}` : ''}`}
                />
                <StatTile label="Metered requests" value={compact(totalRequests)} sub={`across ${rows.length} workflows`} />
                <StatTile
                  label="Overage"
                  value={`${u.overage_gb_hours.toFixed(2)} GB-h`}
                  sub={u.overage_gb_hours > 0 ? 'Beyond your included allowance' : 'Within your allowance'}
                />
                <StatTile
                  label="Overage cost"
                  value={euros(u.overage_cents)}
                  sub={`Billing month ${u.month}`}
                  color="var(--color-chart-alt)"
                />
              </div>

              <SectionCard className="mt-4" title={`Included allowance · ${u.month}`} bodyClassName="px-5 py-5">
                <div className="mb-2 flex items-baseline justify-between text-sm">
                  <span className="font-medium">
                    {u.used_gb_hours.toFixed(2)} / {u.included_gb_hours} GB-hours
                  </span>
                  <span style={{ color: 'var(--color-ink-muted)' }}>{pct.toFixed(0)}% consumed</span>
                </div>
                <span className="meter" style={{ height: 10 }}>
                  <span style={{ width: `${pct}%`, background: pct > 90 ? 'var(--color-warn)' : 'var(--color-brand)' }} />
                </span>
                {u.overage_cents > 0 ? (
                  <p className="mt-3 text-sm" style={{ color: 'var(--color-warn)' }}>
                    {u.overage_gb_hours.toFixed(2)} GB-h over your allowance — {euros(u.overage_cents)} this month at
                    €0.01 per GB-hour.
                  </p>
                ) : (
                  <p className="mt-3 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                    No overage. Parked workflows hold no memory and bill nothing.
                  </p>
                )}
              </SectionCard>
            </>
          );
        }}
      </AsyncBoundary>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard className="xl:col-span-2" title="Usage by workflow">
          <AsyncBoundary
            state={perApp}
            isEmpty={() => rows.length === 0}
            skeleton={<SkeletonBlock height={200} />}
            empty={
              <EmptyState
                icon="usage"
                title="No metered usage this month"
                hint="Consumption appears once a workflow runs. Parked workflows accrue nothing."
              />
            }
          >
            {() => (
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Requests</th>
                    <th>GB-hours</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.app_id}>
                      <td className="cell-primary">
                        <Link href={`/dashboard/workflows/${r.slug}`} style={{ color: 'var(--color-brand)' }}>{r.slug}</Link>
                      </td>
                      <td>{compact(r.requests)}</td>
                      <td>{r.gbHours.toFixed(3)}</td>
                      <td style={{ width: 180 }}>
                        <span className="meter">
                          <span style={{ width: `${totalGb > 0 ? (r.gbHours / totalGb) * 100 : 0}%` }} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </AsyncBoundary>
        </SectionCard>

        <SectionCard title="Breakdown" bodyClassName="space-y-3.5 px-5 py-5">
          {rows.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              Nothing metered this month.
            </p>
          ) : (
            <>
              {rows.slice(0, 6).map((r) => (
                <MeterRow
                  key={r.app_id}
                  label={r.slug}
                  value={`${totalGb > 0 ? Math.round((r.gbHours / totalGb) * 100) : 0}%`}
                  pct={totalGb > 0 ? (r.gbHours / totalGb) * 100 : 0}
                />
              ))}
              <div className="pt-2">
                <BarChart
                  points={rows.slice(0, 10).map((r) => ({ date: new Date(), label: r.slug, value: Number(r.gbHours.toFixed(3)) }))}
                  height={130}
                  format={(n) => `${n} GB-h`}
                />
              </div>
            </>
          )}
        </SectionCard>
      </div>

      <p className="mt-4 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
        Billing is capacity-based: plan RAM plus 8 MB per running second. A parked workflow has no cgroup and costs
        nothing. Overage beyond your included GB-hours is €0.01 per GB-hour.
      </p>
    </div>
  );
}
