'use client';

import React from 'react';
import Link from 'next/link';
import { getObsOverview } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { relativeTime } from '@/lib/format';
import { nodeHref } from '@/lib/routes';
import { DEFAULT_INCIDENT_FILTERS, getAlertWorkloadSummary, listIncidents } from '@/lib/ops/incidents';
import { buildAttention, type AttentionItem, type AttentionReport } from '@/lib/ops/attention';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { TenantLink } from '@/components/operator/TenantLink';
import { IntentStatusBadge, intentOutcome, isTerminalIntent, useOperatorIntents } from '@/components/operator/OperatorIntents';

const POLL_MS = 30_000;
const LIST_LIMIT = 8;

/**
 * The on-call home: first what needs attention (incidents, alerts needing an
 * owner, nodes with stale heartbeats, the operator's own failed actions),
 * then the operator's actions in flight, then the fleet at a glance.
 */
export default function OverviewPage() {
  const overview = useAsync(getObsOverview, [], POLL_MS);
  const incidents = useAsync(() => listIncidents(DEFAULT_INCIDENT_FILTERS), [], POLL_MS);
  const alerts = useAsync(getAlertWorkloadSummary, [], POLL_MS);
  const { intents } = useOperatorIntents();

  const loading = (overview.loading && !overview.data) || (incidents.loading && !incidents.data) || (alerts.loading && !alerts.data);
  // A failed refresh keeps showing the last good answer; only a source that never answered is unknown.
  const report = buildAttention(
    {
      incidents: incidents.data ?? (incidents.error && !incidents.loading ? incidents.error : null),
      alerts: alerts.data ?? (alerts.error && !alerts.loading ? alerts.error : null),
      nodes: overview.data?.node_health ?? (overview.error && !overview.loading ? overview.error : null),
      intents,
    },
    LIST_LIMIT,
  );
  const running = intents.filter((intent) => !isTerminalIntent(intent.status));
  const refreshAll = () => {
    overview.reload();
    incidents.reload();
    alerts.reload();
  };

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="What needs attention right now, then the fleet at a glance."
        actions={
          <button onClick={refreshAll} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />
      <SnapshotFreshness snapshots={[overview, incidents, alerts]} />

      <Headline report={report} loading={loading} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <SectionCard
            title="Needs attention"
            action={
              <Link href="/incidents" className="btn btn-ghost btn-xs">
                All incidents
                <Icon name="arrowRight" size={12} />
              </Link>
            }
          >
            {loading && report.items.length === 0 ? (
              <div className="p-6 text-sm text-[var(--color-ink-muted)]">Checking incidents, alerts and nodes…</div>
            ) : report.items.length === 0 ? (
              <div className="p-6 text-sm text-[var(--color-ink-muted)]">
                {report.unknown.length ? 'Nothing known needs attention.' : 'Nothing needs attention.'}
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {report.items.map((item) => (
                  <AttentionRow key={item.key} item={item} />
                ))}
              </ul>
            )}
            {report.incidentCount > LIST_LIMIT && (
              <div className="table-foot">
                <Link href="/incidents" className="hover:underline">
                  {report.incidentCount - LIST_LIMIT} more incident{report.incidentCount - LIST_LIMIT === 1 ? '' : 's'} in the inbox
                </Link>
              </div>
            )}
            {report.unknown.length > 0 && (
              <div role="status" className="border-t border-[var(--color-line)] bg-[var(--color-warning-subtle)] px-4 py-3 text-xs text-[var(--color-warning-bold)]">
                <div className="font-semibold">This list may be missing problems:</div>
                <ul className="mt-1 list-disc pl-4">
                  {report.unknown.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-4">
          <SectionCard
            title="Your actions"
            action={
              <Link href="/controls" className="btn btn-ghost btn-xs">
                Tracker
              </Link>
            }
          >
            {running.length === 0 ? (
              <div className="p-4 text-xs text-[var(--color-ink-muted)]">Nothing running. Actions you start appear here until they finish.</div>
            ) : (
              <ul className="divide-y divide-[var(--color-line)] text-xs">
                {running.slice(0, 5).map((intent) => (
                  <li key={intent.intentId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{intent.kind.replace(/_/g, ' ')}</div>
                      <div className="truncate text-[var(--color-ink-muted)]">{intent.target} · {intentOutcome(intent)}</div>
                    </div>
                    <IntentStatusBadge status={intent.status} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Compute nodes"
            action={
              <Link href="/nodes" className="btn btn-ghost btn-xs">
                Nodes
              </Link>
            }
          >
            {!overview.data?.node_health.length ? (
              <div className="p-4 text-xs text-[var(--color-ink-muted)]">{overview.data ? 'No compute nodes are registered.' : 'Loading…'}</div>
            ) : (
              <ul className="divide-y divide-[var(--color-line)] text-xs">
                {overview.data.node_health.map((node) => (
                  <li key={node.name}>
                    <Link href={nodeHref(node.name)} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-subtle)]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            !node.active ? 'bg-[var(--color-ink-faint)]' : node.stale ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-brand-bright)]'
                          }`}
                        />
                        <span className="truncate font-semibold">{node.name}</span>
                      </span>
                      <span className="shrink-0 text-[var(--color-ink-muted)]">
                        {!node.active ? 'Out of placement' : node.stale ? 'Heartbeat stale' : node.last_heartbeat_at ? relativeTime(node.last_heartbeat_at) : 'No heartbeat'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-[var(--color-ink-soft)]">Fleet at a glance</h2>
      {overview.error && overview.data && (
        <div role="alert" className="mb-3 text-xs text-[var(--color-warning-bold)]">
          Refresh failed: {overview.error.message}. These figures are from the last successful snapshot.
        </div>
      )}
      {overview.error && !overview.data && !overview.loading ? (
        <div role="alert" className="card p-4 text-xs text-[var(--color-danger)]">
          Could not load fleet figures: {overview.error.message}
        </div>
      ) : (
        <FleetGlance data={overview.data} />
      )}
    </div>
  );
}

function Headline({ report, loading }: { report: AttentionReport; loading: boolean }) {
  if (loading && report.items.length === 0) {
    return <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">Checking the fleet…</div>;
  }
  const { tone, text } = report.headline;
  const style = {
    ok: { icon: 'check' as const, box: 'border-[var(--color-brand-line)] bg-[var(--color-brand-soft)]', ink: 'text-[var(--color-brand-bright)]' },
    warning: { icon: 'alerts' as const, box: 'border-[#f2e2bd] bg-[var(--color-warning-subtle)]', ink: 'text-[var(--color-warning-bold)]' },
    danger: { icon: 'alerts' as const, box: 'border-[#f5d5d5] bg-[var(--color-danger-subtle)]', ink: 'text-[var(--color-danger)]' },
    unknown: { icon: 'help' as const, box: 'border-[#f2e2bd] bg-[var(--color-warning-subtle)]', ink: 'text-[var(--color-warning-bold)]' },
  }[tone];
  return (
    <div role="status" className={`flex items-center gap-3 rounded-xl border px-5 py-4 ${style.box}`}>
      <Icon name={style.icon} size={20} className={style.ink} />
      <span className={`text-lg font-semibold ${style.ink}`}>{text}</span>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <li>
      <Link href={item.href} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-subtle)]">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.tone === 'danger' ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-warning)]'}`}
          aria-label={item.tone === 'danger' ? 'Urgent' : 'Warning'}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{item.title}</span>
          <span className="block truncate text-xs text-[var(--color-ink-muted)]">{item.detail}</span>
        </span>
        {item.at && <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{relativeTime(item.at)}</span>}
        <Icon name="chevronRight" size={14} className="shrink-0 text-[var(--color-ink-faint)]" />
      </Link>
    </li>
  );
}

function FleetGlance({ data }: { data: Awaited<ReturnType<typeof getObsOverview>> | null }) {
  const totals = data?.totals;
  const value = (n?: number) => (data ? (n ?? 0) : '…');
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active accounts" value={value(totals?.accounts_active)} sub={data ? `${totals?.accounts_past_due ?? 0} past due · ${totals?.accounts_suspended ?? 0} suspended` : undefined} />
        <StatTile label="Live instances" value={value(totals?.instances_live)} sub={data ? `${totals?.instances_waking ?? 0} waking · ${totals?.apps_total ?? 0} apps` : undefined} />
        <StatTile label="Nodes in placement" value={value(totals?.nodes_active)} sub={data ? `${totals?.nodes_inactive ?? 0} out of placement` : undefined} />
        <StatTile label="Audit events (24h)" value={value(totals?.audit_events_24h)} sub={data ? `${totals?.orgs_total ?? 0} organizations` : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Failures in the last hour">
          {!data?.recent_failures_1h.length ? (
            <div className="p-4 text-xs text-[var(--color-ink-muted)]">{data ? 'No failure events in the last hour.' : 'Loading…'}</div>
          ) : (
            <ul className="divide-y divide-[var(--color-line)] text-xs">
              {data.recent_failures_1h.map((failure) => (
                <li key={failure.kind} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="font-mono">{failure.kind}</span>
                  <span className="badge badge-warning">{failure.count}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Most rate-limited accounts (24h)">
          {!data?.top_rate_limited_accounts_24h.length ? (
            <div className="p-4 text-xs text-[var(--color-ink-muted)]">{data ? 'No account was rate limited in the last 24 hours.' : 'Loading…'}</div>
          ) : (
            <ul className="divide-y divide-[var(--color-line)] text-xs">
              {data.top_rate_limited_accounts_24h.map((account) => (
                <li key={account.account_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <TenantLink accountId={account.account_id} short />
                  <span className="font-semibold">{account.hits.toLocaleString()} hits</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
