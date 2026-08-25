'use client';

import React from 'react';
import { getObsOverview } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono } from '@/components/ui/bits';
import { StatTile, SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

export default function FleetOverviewPage() {
  const { data, loading, error, reload } = useAsync(getObsOverview, [], 30000);

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
          <span className="animate-spin inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />
          Loading Fleet Overview…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-subtle)] text-[var(--color-danger)]">
          <Icon name="shield" size={24} />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Operator Access Required</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {error.message || 'Could not load fleet overview. Operator admin permissions & MFA step-up required.'}
        </p>
        <button onClick={reload} className="btn btn-secondary btn-sm mt-4">
          <Icon name="refresh" size={14} />
          Retry Request
        </button>
      </div>
    );
  }

  const totals = data?.totals;
  const snapshotTime = data?.generated_at ? new Date(data.generated_at).toLocaleTimeString() : '';

  return (
    <div>
      <PageHeader
        title="Fleet Overview"
        subtitle={`Real-time platform operator observability bundle (Snapshot at ${snapshotTime})`}
        actions={
          <button onClick={reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh Overview
          </button>
        }
      />

      {/* KPI Tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Active Accounts"
          value={totals?.accounts_active ?? 0}
          sub={`${totals?.accounts_past_due ?? 0} past due · ${totals?.accounts_suspended ?? 0} suspended`}
        />
        <StatTile
          label="Live MicroVM Instances"
          value={totals?.instances_live ?? 0}
          sub={`${totals?.instances_waking ?? 0} waking · ${totals?.apps_total ?? 0} total apps`}
          color="var(--color-brand-bright)"
        />
        <StatTile
          label="Compute Host Nodes"
          value={totals?.nodes_active ?? 0}
          sub={`${totals?.nodes_inactive ?? 0} inactive nodes`}
        />
        <StatTile
          label="24h Audit Events"
          value={totals?.audit_events_24h ?? 0}
          sub={`${totals?.orgs_total ?? 0} total organizations`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Node Health Status */}
        <SectionCard title="Compute Node Health">
          {data?.node_health && data.node_health.length > 0 ? (
            <div className="divide-y divide-[var(--color-line)]">
              {data.node_health.map((node) => (
                <div key={node.name} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2.5 w-2.5 rounded-full ${
                        !node.active
                          ? 'bg-[var(--color-ink-muted)]'
                          : node.stale
                          ? 'bg-[var(--color-warning)]'
                          : 'live-dot bg-[var(--color-brand-bright)]'
                      }`}
                    />
                    <div>
                      <div className="font-semibold text-sm">{node.name}</div>
                      <div className="text-xs text-[var(--color-ink-muted)]">
                        {node.last_heartbeat_at
                          ? `Last heartbeat ${relativeTime(node.last_heartbeat_at)}`
                          : 'Never heartbeated'}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`badge ${
                      !node.active
                        ? 'badge-neutral'
                        : node.stale
                        ? 'badge-warning'
                        : 'badge-success'
                    }`}
                  >
                    {!node.active ? 'Inactive' : node.stale ? 'Stale Heartbeat' : 'Healthy'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">
              No compute nodes registered.
            </div>
          )}
        </SectionCard>

        {/* Top Rate-Limited Accounts & Failures */}
        <div className="space-y-6">
          <SectionCard title="Top Rate-Limited Accounts (24h)">
            {data?.top_rate_limited_accounts_24h && data.top_rate_limited_accounts_24h.length > 0 ? (
              <div className="divide-y divide-[var(--color-line)]">
                {data.top_rate_limited_accounts_24h.map((rl) => (
                  <div key={rl.account_id} className="flex items-center justify-between p-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Icon name="shield" size={14} className="text-[var(--color-warning)]" />
                      <Mono>{rl.account_id}</Mono>
                    </div>
                    <div className="font-semibold text-[var(--color-danger)]">{rl.hits} hits</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">
                Zero rate-limit violations recorded in 24h.
              </div>
            )}
          </SectionCard>

          <SectionCard title="Recent Failure Breakdown (1h)">
            {data?.recent_failures_1h && data.recent_failures_1h.length > 0 ? (
              <div className="divide-y divide-[var(--color-line)]">
                {data.recent_failures_1h.map((f) => (
                  <div key={f.kind} className="flex items-center justify-between p-4 text-sm">
                    <span className="font-mono text-xs">{f.kind}</span>
                    <span className="badge badge-warning">{f.count} occurrences</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">
                No failure events recorded in the last hour.
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
