'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getObsAnomalies,
  getObsBuilderHeartbeats,
  getObsOverview,
  getObsHealth,
  getObsRateLimits,
  getObsWakeLatencies,
  listObsEvents,
  listObsNodes,
  searchObsAuditLog,
  obsNodeEventsUrl,
  type ObsAnomalyRow,
  type ObsBuilderHeartbeatRow,
  type ObsEventRow,
  type ObsOverviewResponse,
  type ObsRateLimitResponse,
  type ObsWakeLatencyRow,
  type ObsHealthResponse,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

function LoadingState({ label }: { label: string }) {
  return <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">{label}…</div>;
}

function ErrorState({ message }: { message: string }) {
  return <div className="p-6 text-center text-xs text-[var(--color-danger)]">{message}</div>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">{children}</div>;
}

function builderCpu(builder: ObsBuilderHeartbeatRow): string {
  return builder.cpu_pct_60s == null ? '—' : `${builder.cpu_pct_60s.toFixed(1)}%`;
}

function builderDisk(builder: ObsBuilderHeartbeatRow): string {
  return builder.disk_used_bytes == null
    ? '—'
    : `${(builder.disk_used_bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const NODE_EVENT_NAMES = ['app_changed', 'deployment_changed', 'instance_changed', 'compute_node_changed'];

interface StreamEntry {
  event: string;
  data: string;
  receivedAt: string;
}

function formatStreamData(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function FleetEventStream() {
  const [connection, setConnection] = useState<'connecting' | 'open' | 'error'>('connecting');
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const source = new EventSource(obsNodeEventsUrl, { withCredentials: true });
    const listeners = NODE_EVENT_NAMES.map((eventName) => {
      const listener = (event: Event) => {
        const message = event as MessageEvent<string>;
        if (!message.data) return;
        setEntries((current) => [
          { event: eventName, data: message.data, receivedAt: new Date().toISOString() },
          ...current,
        ].slice(0, 30));
      };
      source.addEventListener(eventName, listener);
      return { eventName, listener };
    });
    source.onopen = () => setConnection('open');
    source.onerror = () => setConnection('error');
    return () => {
      for (const { eventName, listener } of listeners) source.removeEventListener(eventName, listener);
      source.close();
    };
  }, [generation]);

  return (
    <SectionCard
      title="Live Fleet Event Stream"
      action={
        <div className="flex items-center gap-2">
          <span className={`badge ${connection === 'open' ? 'badge-success' : connection === 'error' ? 'badge-danger' : 'badge-warning'}`}>
            {connection === 'open' ? 'Streaming' : connection === 'error' ? 'Disconnected' : 'Connecting…'}
          </span>
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => { setConnection('connecting'); setGeneration((value) => value + 1); }}>
            Reconnect
          </button>
        </div>
      }
    >
      <div className="border-b border-[var(--color-line)] p-4 text-xs text-[var(--color-ink-muted)]">
        Server-sent app, deployment, instance, and compute-node changes. Heartbeats keep the connection alive but are not rendered as events.
      </div>
      {entries.length === 0 ? (
        <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
          {connection === 'error' ? 'The live feed is unavailable or operator authentication has expired.' : 'Waiting for a fleet event…'}
        </div>
      ) : (
        <div className="max-h-80 divide-y divide-[var(--color-line)] overflow-y-auto">
          {entries.map((entry, index) => (
            <div key={`${entry.receivedAt}-${index}`} className="grid gap-2 p-3 text-xs sm:grid-cols-[170px_1fr]">
              <div>
                <div className="font-mono font-semibold text-[var(--color-brand-bright)]">{entry.event}</div>
                <div className="text-[var(--color-ink-muted)]">{new Date(entry.receivedAt).toLocaleTimeString()}</div>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[var(--color-ink-muted)]">{formatStreamData(entry.data)}</pre>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export default function IncidentCenterPage() {
  const overview = useAsync(getObsOverview, [], 30000);
  const health = useAsync(getObsHealth, [], 30000);
  const nodes = useAsync(listObsNodes, [], 30000);
  const builders = useAsync(getObsBuilderHeartbeats, [], 30000);
  const wake = useAsync(() => getObsWakeLatencies(24), [], 30000);
  const anomalies = useAsync(() => getObsAnomalies(24), [], 30000);
  const rateLimits = useAsync(() => getObsRateLimits(24), [], 15000);
  const events = useAsync(() => listObsEvents(25), [], 15000);
  const audit = useAsync(
    () => searchObsAuditLog({ limit: 25, operator_only: true }),
    [],
    15000,
  );

  const data: ObsOverviewResponse | null = overview.data;
  const nodeRows = nodes.data?.items ?? [];
  const builderRows = builders.data?.items ?? [];
  const wakeRows = wake.data?.items ?? [];
  const anomalyRows = anomalies.data?.items ?? [];
  const rateLimitData: ObsRateLimitResponse | null = rateLimits.data;
  const eventRows = events.data?.items ?? [];
  const auditRows = audit.data?.items ?? [];

  const unhealthyNodes = data?.node_health.filter((node) => !node.active || node.stale) ?? [];
  const severeAnomalies = anomalyRows.filter((row) => (row.z_score ?? 0) >= 3.5);
  const activeBlocks = rateLimitData?.live.filter((row) => row.currently_rate_limited) ?? [];
  const recentFailureCount = data?.recent_failures_1h.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const incidentCount = unhealthyNodes.length + severeAnomalies.length + activeBlocks.length;
  const maxP95 = wakeRows.length > 0 ? Math.max(...wakeRows.map((row) => row.p95_ms)) : null;

  const refreshAll = () => {
    overview.reload();
    health.reload();
    nodes.reload();
    builders.reload();
    wake.reload();
    anomalies.reload();
    rateLimits.reload();
    events.reload();
    audit.reload();
  };

  const healthData: ObsHealthResponse | null = health.data;
  const missingOutcomes = Object.entries(healthData?.operator_intent_outcome_missing_total ?? {});
  const incompleteTraceKinds = Object.entries(healthData?.trace_id_completeness_ratio ?? {}).filter(([, ratio]) => ratio < 1);

  return (
    <div>
      <PageHeader
        title="Incident Center"
        subtitle="One operational view for fleet health, tenant-impacting signals, recovery telemetry, and the latest operator trail"
        actions={
          <button onClick={refreshAll} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh Signals
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Open Health Signals"
          value={incidentCount}
          sub={`${unhealthyNodes.length} node · ${severeAnomalies.length} anomaly · ${activeBlocks.length} IP block`}
          color="var(--color-danger)"
        />
        <StatTile
          label="Failure Events (1h)"
          value={recentFailureCount}
          sub={`${data?.recent_failures_1h.length ?? 0} failure categories`}
          color="var(--color-warning)"
        />
        <StatTile
          label="Builder Backlog"
          value={builders.data?.queued_builds ?? 0}
          sub={`${builderRows.length} builder heartbeat(s)`}
          color="var(--color-brand-bright)"
        />
        <StatTile
          label="Highest Wake p95"
          value={maxP95 == null ? '—' : `${maxP95.toFixed(0)} ms`}
          sub="24h rolling node latency"
          color={maxP95 != null && maxP95 > 1000 ? 'var(--color-danger)' : 'var(--color-chart)'}
        />
      </div>

      <div className="mt-6">
        <SectionCard
          title="Observability Pipeline Health"
          action={<span className={`badge ${health.error ? 'badge-danger' : healthData && (healthData.alerts_firing > 0 || missingOutcomes.some(([, count]) => count > 0) || incompleteTraceKinds.length > 0) ? 'badge-warning' : 'badge-success'}`}>{health.error ? 'Unavailable' : healthData ? 'Reporting' : 'Loading…'}</span>}
        >
          {health.loading && !healthData ? (
            <LoadingState label="Checking audit and trace health" />
          ) : health.error ? (
            <ErrorState message={health.error.message || 'Could not load observability health.'} />
          ) : healthData ? (
            <div className="p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-[var(--color-line)] p-3 text-xs"><div className="text-[var(--color-ink-muted)]">Audit writes (5m)</div><div className="mt-1 font-semibold">{healthData.audit_log_write_total_5m.toLocaleString()}</div><div className="text-[var(--color-ink-muted)]">{healthData.audit_log_write_failures_5m} failed</div></div>
                <div className="rounded-lg border border-[var(--color-line)] p-3 text-xs"><div className="text-[var(--color-ink-muted)]">Audit trace coverage</div><div className="mt-1 font-semibold">{(healthData.audit_log_coverage_ratio_5m * 100).toFixed(1)}%</div><div className="text-[var(--color-ink-muted)]">last five minutes</div></div>
                <div className="rounded-lg border border-[var(--color-line)] p-3 text-xs"><div className="text-[var(--color-ink-muted)]">Firing alerts</div><div className={`mt-1 font-semibold ${healthData.alerts_firing > 0 ? 'text-[var(--color-danger)]' : ''}`}>{healthData.alerts_firing}</div><div className="text-[var(--color-ink-muted)]">Prometheus alert state</div></div>
                <div className="rounded-lg border border-[var(--color-line)] p-3 text-xs"><div className="text-[var(--color-ink-muted)]">Snapshot generated</div><div className="mt-1 font-semibold">{relativeTime(healthData.generated_at)}</div><div className="text-[var(--color-ink-muted)]">{new Date(healthData.generated_at).toLocaleTimeString()}</div></div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-semibold">Missing operator outcomes</div>
                  {missingOutcomes.length === 0 ? <div className="text-xs text-[var(--color-ink-muted)]">No intent kinds reported.</div> : <div className="space-y-1">{missingOutcomes.map(([kind, count]) => <div key={kind} className="flex items-center justify-between text-xs"><span className="font-mono">{kind}</span><span className={`badge ${count > 0 ? 'badge-danger' : 'badge-success'}`}>{count}</span></div>)}</div>}
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold">Trace completeness by action kind</div>
                  {Object.entries(healthData.trace_id_completeness_ratio).length === 0 ? <div className="text-xs text-[var(--color-ink-muted)]">No operator action kinds reported.</div> : <div className="space-y-1">{Object.entries(healthData.trace_id_completeness_ratio).map(([kind, ratio]) => <div key={kind} className="flex items-center justify-between text-xs"><span className="font-mono">{kind}</span><span className={`badge ${ratio < 1 ? 'badge-warning' : 'badge-success'}`}>{(ratio * 100).toFixed(1)}%</span></div>)}</div>}
                </div>
              </div>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard
          title={
            <div className="flex items-center gap-2">
              <Icon name="alerts" size={16} className="text-[var(--color-danger)]" />
              <span>Priority Signals</span>
            </div>
          }
          action={
            <div className="flex gap-2">
              <Link href="/operations/anomalies" className="btn btn-secondary btn-xs">Anomalies</Link>
              <Link href="/operations/nodes" className="btn btn-secondary btn-xs">Nodes</Link>
            </div>
          }
        >
          {overview.loading && !data ? (
            <LoadingState label="Collecting fleet signals" />
          ) : overview.error ? (
            <ErrorState message={overview.error.message || 'Could not load fleet health signals.'} />
          ) : incidentCount === 0 ? (
            <EmptyState>No active node, anomaly, or rate-limit signals require intervention.</EmptyState>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {unhealthyNodes.map((node) => (
                <div key={`node-${node.name}`} className="flex items-center justify-between gap-4 p-4 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon name="storage" size={14} className="text-[var(--color-warning)]" />
                    <div className="min-w-0">
                      <div className="font-semibold">Node heartbeat requires attention</div>
                      <div className="truncate font-mono text-[var(--color-ink-muted)]">{node.name}</div>
                    </div>
                  </div>
                  <span className="badge badge-warning">{node.active ? 'Stale' : 'Inactive'}</span>
                </div>
              ))}
              {severeAnomalies.slice(0, 8).map((row: ObsAnomalyRow, index) => (
                <div key={`anomaly-${row.app_id}-${row.minute}-${index}`} className="flex items-center justify-between gap-4 p-4 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon name="spark" size={14} className="text-[var(--color-danger)]" />
                    <div className="min-w-0">
                      <div className="font-semibold">Usage anomaly detected</div>
                      <div className="truncate font-mono text-[var(--color-ink-muted)]">
                        <Mono>{row.account_id.slice(0, 13)}…</Mono> · {row.reason}
                      </div>
                    </div>
                  </div>
                  <span className="badge badge-danger font-mono">Z {row.z_score?.toFixed(2)}</span>
                </div>
              ))}
              {activeBlocks.slice(0, 8).map((row) => (
                <div key={`block-${row.ip}`} className="flex items-center justify-between gap-4 p-4 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon name="shield" size={14} className="text-[var(--color-danger)]" />
                    <div>
                      <div className="font-semibold">Live IP rate limit active</div>
                      <div className="font-mono text-[var(--color-ink-muted)]">{row.ip} · {row.live_hits_30s} hits / 30s</div>
                    </div>
                  </div>
                  <span className="badge badge-danger">429 block</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recovery Readiness"
          action={<Link href="/operations/controls" className="btn btn-secondary btn-xs">Open Controls</Link>}
        >
          <div className="divide-y divide-[var(--color-line)]">
            <div className="flex items-center justify-between p-4 text-xs">
              <span>Active compute nodes</span>
              <span className="font-mono font-semibold">{data?.totals.nodes_active ?? '—'} / {(data?.totals.nodes_active ?? 0) + (data?.totals.nodes_inactive ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between p-4 text-xs">
              <span>Builder heartbeat coverage</span>
              <span className={`badge ${builderRows.length > 0 ? 'badge-success' : 'badge-warning'}`}>
                {builderRows.length > 0 ? `${builderRows.length} reporting` : 'No heartbeats'}
              </span>
            </div>
            <div className="flex items-center justify-between p-4 text-xs">
              <span>Node wake SLO (&lt;350ms p50)</span>
              <span className={`badge ${wakeRows.length > 0 && wakeRows.every((row) => row.p50_ms <= 350) ? 'badge-success' : 'badge-warning'}`}>
                {wakeRows.length === 0 ? 'No samples' : wakeRows.every((row) => row.p50_ms <= 350) ? 'Within SLO' : 'Elevated'}
              </span>
            </div>
            <div className="flex items-center justify-between p-4 text-xs">
              <span>Registered nodes with inventory</span>
              <span className="font-mono font-semibold">{nodeRows.length}</span>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6">
        <FleetEventStream />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Compute & Builder Telemetry" action={<Link href="/operations/nodes" className="btn btn-secondary btn-xs">Inspect Nodes</Link>}>
          {nodes.loading && !nodes.data && builders.loading && !builders.data ? (
            <LoadingState label="Loading host telemetry" />
          ) : nodes.error || builders.error ? (
            <ErrorState message={(nodes.error || builders.error)?.message || 'Could not load host telemetry.'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] text-[var(--color-ink-muted)]">
                  <tr><th className="px-4 py-3">Host</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Live VMs</th><th className="px-4 py-3">Builder CPU / Disk</th></tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {nodeRows.map((node) => {
                    const builder = builderRows.find((row) => row.node_id === node.name || row.node_id === node.id);
                    return (
                      <tr key={node.id}>
                        <td className="px-4 py-3 font-semibold">{node.name}</td>
                        <td className="px-4 py-3"><span className={`badge ${node.active ? 'badge-success' : 'badge-neutral'}`}>{node.active ? 'Active' : 'Inactive'}</span></td>
                        <td className="px-4 py-3 font-mono">{node.instances_live}</td>
                        <td className="px-4 py-3 font-mono">{builder ? `${builderCpu(builder)} · ${builderDisk(builder)}` : 'No builder sample'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {nodeRows.length === 0 && <EmptyState>No compute nodes registered.</EmptyState>}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Wake Latency by Node" action={<Link href="/operations/nodes" className="btn btn-secondary btn-xs">Latency Detail</Link>}>
          {wake.loading && !wake.data ? (
            <LoadingState label="Loading wake latency" />
          ) : wake.error ? (
            <ErrorState message={wake.error.message || 'Could not load wake latency.'} />
          ) : wakeRows.length === 0 ? (
            <EmptyState>No wake latency samples in the selected 24h window.</EmptyState>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {wakeRows.map((row: ObsWakeLatencyRow) => (
                <div key={row.node} className="flex items-center justify-between p-4 text-xs">
                  <div><div className="font-semibold">{row.node}</div><div className="text-[var(--color-ink-muted)]">{row.sample_count} samples</div></div>
                  <div className="text-right font-mono"><div>p50 {row.p50_ms.toFixed(0)} ms</div><div className="text-[var(--color-ink-muted)]">p95 {row.p95_ms.toFixed(0)} · p99 {row.p99_ms.toFixed(0)}</div></div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Recent Operator Actions" action={<Link href="/operations/audit-log" className="btn btn-secondary btn-xs">Full Audit Trail</Link>}>
          {audit.loading && !audit.data ? <LoadingState label="Loading operator audit" /> : audit.error ? <ErrorState message={audit.error.message || 'Could not load operator audit.'} /> : auditRows.length === 0 ? <EmptyState>No operator actions recorded recently.</EmptyState> : (
            <div className="divide-y divide-[var(--color-line)]">
              {auditRows.slice(0, 8).map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-4 p-4 text-xs">
                  <div className="min-w-0"><div className="truncate font-mono font-semibold">{row.kind}</div><div className="truncate text-[var(--color-ink-muted)]">{row.actor}{row.subject ? ` · ${row.subject}` : ''}</div></div>
                  <span className="shrink-0 text-[var(--color-ink-muted)]">{relativeTime(row.at)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent Platform Events" action={<Link href="/operations/audit-log" className="btn btn-secondary btn-xs">Event Trail</Link>}>
          {events.loading && !events.data ? <LoadingState label="Loading platform events" /> : events.error ? <ErrorState message={events.error.message || 'Could not load platform events.'} /> : eventRows.length === 0 ? <EmptyState>No platform events recorded recently.</EmptyState> : (
            <div className="divide-y divide-[var(--color-line)]">
              {eventRows.slice(0, 8).map((row: ObsEventRow) => (
                <div key={row.id} className="flex items-center justify-between gap-4 p-4 text-xs">
                  <div className="min-w-0"><div className="truncate font-mono font-semibold">{row.kind}</div><div className="truncate text-[var(--color-ink-muted)]">{row.actor}{row.subject ? ` · ${row.subject}` : ''}</div></div>
                  <span className="shrink-0 text-[var(--color-ink-muted)]">{relativeTime(row.at)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
