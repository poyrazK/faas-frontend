'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { listApps, getUsageSummary } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono } from '@/components/ui/bits';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { PLANS } from '@/lib/format';

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-muted)' }}>{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>{sub}</div>}
    </div>
  );
}

export default function OverviewPage() {
  const { account } = useAuth();
  const apps = useAsync(listApps, []);
  const usage = useAsync(getUsageSummary, []);
  const plan = account ? PLANS[account.plan] : null;

  const usedPct = usage.data && usage.data.included_gb_hours > 0
    ? Math.min(100, Math.round((usage.data.used_gb_hours / usage.data.included_gb_hours) * 100))
    : 0;

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Your Firecracker microVM workloads at a glance."
        actions={<Link href="/dashboard/apps" className="btn btn-primary">+ New app</Link>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Apps"
          value={apps.data ? apps.data.length : account?.app_count ?? '—'}
          sub={plan ? `${plan.apps} allowed on ${plan.label}` : undefined}
        />
        <Stat label="Plan" value={plan?.label ?? '—'} sub={plan ? `${plan.price}/mo` : undefined} />
        <Stat
          label="Usage this month"
          value={usage.data ? `${usage.data.used_gb_hours.toFixed(2)} GB-h` : '—'}
          sub={usage.data ? `${usedPct}% of ${usage.data.included_gb_hours} included` : undefined}
        />
        <Stat label="Max concurrency" value={plan?.concurrency ?? '—'} sub="simultaneous wakes" />
      </div>

      {/* Usage meter */}
      {usage.data && (
        <div className="card mt-4 p-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold">Included GB-hours ({usage.data.month})</span>
            <span style={{ color: 'var(--color-ink-muted)' }}>
              {usage.data.used_gb_hours.toFixed(2)} / {usage.data.included_gb_hours} GB-h
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-surface-subtle)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${usedPct}%`, background: usedPct > 90 ? 'var(--color-warn)' : 'var(--color-brand)' }}
            />
          </div>
          {usage.data.overage_cents > 0 && (
            <p className="mt-2 text-xs" style={{ color: 'var(--color-warn)' }}>
              {usage.data.overage_gb_hours.toFixed(2)} GB-h over included — €{(usage.data.overage_cents / 100).toFixed(2)} this month.
            </p>
          )}
        </div>
      )}

      {/* Apps table */}
      <div className="card mt-6 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <h2 className="text-sm font-semibold">Your apps</h2>
          <Link href="/dashboard/apps" className="text-sm font-semibold" style={{ color: 'var(--color-brand)' }}>View all →</Link>
        </div>
        <AsyncBoundary
          state={apps}
          skeleton={<SkeletonTable cols={4} rows={3} />}
          isEmpty={(d) => d.length === 0}
          empty={
            <EmptyState
              icon="🚀"
              title="No apps yet"
              hint="Deploy your first app and it will park as a snapshot, waking on request in under 350ms."
              action={<Link href="/dashboard/apps" className="btn btn-primary">Create an app</Link>}
            />
          }
        >
          {(list) => (
            <table className="dtable">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Type</th>
                  <th>Memory</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 6).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/dashboard/apps/${a.slug}`} className="font-semibold" style={{ color: 'var(--color-brand)' }}>
                        {a.slug}
                      </Link>
                    </td>
                    <td>
                      <Mono>{a.type}{a.runtime ? ` · ${a.runtime}` : ''}</Mono>
                    </td>
                    <td>{a.ram_mb} MB</td>
                    <td><StatusBadge state={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncBoundary>
      </div>
    </div>
  );
}
