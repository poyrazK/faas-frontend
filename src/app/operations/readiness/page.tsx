'use client';

import React from 'react';
import Link from 'next/link';
import {
  getObsBuilderHeartbeats,
  getObsCapacity,
  getObsOverview,
  getObsWakeLatencies,
  getOperatorRuntimeConfig,
  listObsNodes,
  searchObsAuditLog,
  type ObsCapacityResponse,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { Icon } from '@/components/ui/Icons';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';

type CheckState = 'loading' | 'pass' | 'warn' | 'fail';

interface ReadinessCheck {
  label: string;
  state: CheckState;
  detail: string;
  source: string;
}

function stateClass(state: CheckState): string {
  if (state === 'pass') return 'badge-success';
  if (state === 'warn') return 'badge-warning';
  if (state === 'fail') return 'badge-danger';
  return 'badge-neutral';
}

function stateLabel(state: CheckState): string {
  if (state === 'pass') return 'Ready';
  if (state === 'warn') return 'Attention';
  if (state === 'fail') return 'Unavailable';
  return 'Checking';
}

function queryCheck(
  label: string,
  source: string,
  loading: boolean,
  error: Error | null,
  hasData: boolean,
  detail: string,
): ReadinessCheck {
  return {
    label,
    source,
    state: loading ? 'loading' : error || !hasData ? 'fail' : 'pass',
    detail: loading ? 'Collecting current signal…' : error ? error.message : !hasData ? 'No response returned.' : detail,
  };
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-line)] p-4 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            check.state === 'pass'
              ? 'bg-[var(--color-brand-bright)]/10 text-[var(--color-brand-bright)]'
              : check.state === 'warn'
              ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning-bold)]'
              : check.state === 'fail'
              ? 'bg-[var(--color-danger-subtle)] text-[var(--color-danger)]'
              : 'bg-[var(--color-surface-subtle)] text-[var(--color-ink-muted)]'
          }`}
        >
          <Icon name={check.state === 'pass' ? 'check' : check.state === 'loading' ? 'refresh' : 'x'} size={13} />
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-sm">{check.label}</div>
          <div className="mt-1 text-xs text-[var(--color-ink-muted)]">{check.detail}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-[10px] font-mono text-[var(--color-ink-muted)]">{check.source}</span>
        <span className={`badge ${stateClass(check.state)}`}>{stateLabel(check.state)}</span>
      </div>
    </div>
  );
}

function capacityDetail(data: ObsCapacityResponse | null): string {
  if (!data) return 'No capacity snapshot returned.';
  const summary = data.summary;
  if (summary.unplaced_apps > 0) {
    return `${summary.unplaced_apps} app(s) have no placement; admission margin is ${summary.admission_margin_mb} MB.`;
  }
  return `${summary.admission_margin_mb} MB admission margin across ${summary.active_nodes} active node(s).`;
}

export default function PlatformReadinessPage() {
  const overview = useAsync(getObsOverview, [], 30000);
  const nodes = useAsync(listObsNodes, [], 30000);
  const capacity = useAsync(getObsCapacity, [], 30000);
  const builders = useAsync(getObsBuilderHeartbeats, [], 30000);
  const wake = useAsync(() => getObsWakeLatencies(24), [], 30000);
  const config = useAsync(getOperatorRuntimeConfig, [], 30000);
  const audit = useAsync(() => searchObsAuditLog({ limit: 1, operator_only: true }), [], 30000);

  const overviewData = overview.data;
  const capacityData = capacity.data;
  const unhealthyNodes = overviewData?.node_health.filter((node) => !node.active || node.stale).length ?? 0;
  const blockedConfig = config.data?.items.filter((item) => ['failed', 'blocked'].includes(item.status)).length ?? 0;
  const pendingConfig = config.data?.items.filter((item) => item.status === 'pending').length ?? 0;
  const readyChecks = [
    overview.error || !overviewData
      ? queryCheck('Control plane observability', '/v1/admin/obs/overview', overview.loading, overview.error, !!overviewData, '')
      : {
          label: 'Control plane observability',
          source: '/v1/admin/obs/overview',
          state: unhealthyNodes === 0 ? 'pass' : 'warn',
          detail: unhealthyNodes === 0 ? 'Fleet overview is reachable and reports no unhealthy nodes.' : `${unhealthyNodes} node(s) need attention.`,
        } satisfies ReadinessCheck,
    nodes.error || !nodes.data
      ? queryCheck('Compute inventory', '/v1/admin/obs/nodes', nodes.loading, nodes.error, !!nodes.data, '')
      : {
          label: 'Compute inventory',
          source: '/v1/admin/obs/nodes',
          state: nodes.data.items.length > 0 ? 'pass' : 'warn',
          detail: nodes.data.items.length > 0 ? `${nodes.data.items.length} compute node(s) are registered.` : 'No compute nodes are registered.',
        } satisfies ReadinessCheck,
    capacity.error || !capacityData
      ? queryCheck('Placement capacity', '/v1/admin/obs/capacity', capacity.loading, capacity.error, !!capacityData, '')
      : {
          label: 'Placement capacity',
          source: '/v1/admin/obs/capacity',
          state: capacityData.summary.unplaced_apps > 0 || capacityData.summary.admission_margin_mb < 0 ? 'warn' : 'pass',
          detail: capacityDetail(capacityData),
        } satisfies ReadinessCheck,
    builders.error || !builders.data
      ? queryCheck('Builder fleet liveness', '/v1/admin/obs/builder-heartbeats', builders.loading, builders.error, !!builders.data, '')
      : {
          label: 'Builder fleet liveness',
          source: '/v1/admin/obs/builder-heartbeats',
          state: builders.data.items.length > 0 ? 'pass' : 'warn',
          detail: builders.data.items.length > 0 ? `${builders.data.items.length} builder heartbeat(s); ${builders.data.queued_builds} queued build(s).` : 'No builder heartbeat has been recorded.',
        } satisfies ReadinessCheck,
    wake.error || !wake.data
      ? queryCheck('Wake latency SLO', '/v1/admin/obs/nodes/wake-latency', wake.loading, wake.error, !!wake.data, '')
      : {
          label: 'Wake latency SLO',
          source: '/v1/admin/obs/nodes/wake-latency',
          state: wake.data.items.length === 0 ? 'warn' : wake.data.items.every((row) => row.p50_ms <= 350) ? 'pass' : 'warn',
          detail: wake.data.items.length === 0 ? 'No samples are available for the 24h window.' : `${wake.data.items.length} node(s) sampled; target is p50 ≤ 350 ms.`,
        } satisfies ReadinessCheck,
    config.error || !config.data
      ? queryCheck('Runtime configuration convergence', '/v1/admin/config', config.loading, config.error, !!config.data, '')
      : {
          label: 'Runtime configuration convergence',
          source: '/v1/admin/config',
          state: blockedConfig > 0 ? 'fail' : pendingConfig > 0 ? 'warn' : 'pass',
          detail: blockedConfig > 0 ? `${blockedConfig} setting(s) are failed or blocked.` : pendingConfig > 0 ? `${pendingConfig} setting(s) are awaiting apply.` : 'All catalogued settings are converged or deployment-managed.',
        } satisfies ReadinessCheck,
    audit.error || !audit.data
      ? queryCheck('Operator audit trail', '/v1/admin/obs/audit-log/search', audit.loading, audit.error, !!audit.data, '')
      : {
          label: 'Operator audit trail',
          source: '/v1/admin/obs/audit-log/search',
          state: 'pass',
          detail: audit.data.items.length > 0 ? 'Operator actions are queryable from the global audit trail.' : 'Audit endpoint is reachable; no operator actions match the current filter.',
        } satisfies ReadinessCheck,
    {
      label: 'Signed release identity',
      source: 'backend gap',
      state: 'warn',
      detail: 'Current operator APIs do not expose the installed daemon SHA, signed manifest, or per-node running release.',
    } satisfies ReadinessCheck,
    {
      label: 'Fleet enrollment lifecycle',
      source: 'backend gap',
      state: 'warn',
      detail: 'The console can drain and activate nodes, but join, replacement, and decommission workflows are not API-backed yet.',
    } satisfies ReadinessCheck,
    {
      label: 'Durable incident ownership',
      source: 'backend gap',
      state: 'warn',
      detail: 'Incident Center aggregates signals but does not yet persist acknowledgement, ownership, escalation, or resolution.',
    } satisfies ReadinessCheck,
  ];

  const passing = readyChecks.filter((check) => check.state === 'pass').length;
  const attention = readyChecks.filter((check) => check.state === 'warn' || check.state === 'fail').length;
  const refreshAll = () => {
    overview.reload();
    nodes.reload();
    capacity.reload();
    builders.reload();
    wake.reload();
    config.reload();
    audit.reload();
  };

  return (
    <div>
      <PageHeader
        title="Platform Readiness"
        subtitle="Operator preflight across fleet health, capacity, builders, configuration convergence, and auditability"
        actions={
          <button type="button" onClick={refreshAll} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh Preflight
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Checks Ready" value={passing} sub={`of ${readyChecks.length} current preflight checks`} color="var(--color-brand-bright)" />
        <StatTile label="Needs Attention" value={attention} sub="Warnings or unavailable signals" color={attention > 0 ? 'var(--color-warning)' : 'var(--color-brand-bright)'} />
        <StatTile label="Registered Nodes" value={capacityData?.summary.total_nodes ?? nodes.data?.items.length ?? '—'} sub={`${capacityData?.summary.active_nodes ?? overviewData?.totals.nodes_active ?? '—'} active`} />
        <StatTile label="Admission Margin" value={capacityData ? `${capacityData.summary.admission_margin_mb} MB` : '—'} sub="Fleet placement headroom" color="var(--color-chart)" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <SectionCard
          title="Operational preflight"
          action={<span className={`badge ${attention === 0 ? 'badge-success' : 'badge-warning'}`}>{attention === 0 ? 'Ready for review' : `${attention} attention item(s)`}</span>}
        >
          <div className="divide-y divide-[var(--color-line)]">
            {readyChecks.map((check) => <CheckRow key={check.label} check={check} />)}
          </div>
        </SectionCard>

        <SectionCard title="Operator workflow">
          <div className="divide-y divide-[var(--color-line)]">
            <Link href="/operations/nodes" className="flex items-center justify-between p-4 text-sm hover:bg-[var(--color-surface-subtle)]">
              <span className="flex items-center gap-2"><Icon name="storage" size={15} />Inspect or drain a node</span><Icon name="arrowRight" size={14} />
            </Link>
            <Link href="/operations/configuration" className="flex items-center justify-between p-4 text-sm hover:bg-[var(--color-surface-subtle)]">
              <span className="flex items-center gap-2"><Icon name="settings" size={15} />Review config convergence</span><Icon name="arrowRight" size={14} />
            </Link>
            <Link href="/operations/controls" className="flex items-center justify-between p-4 text-sm hover:bg-[var(--color-surface-subtle)]">
              <span className="flex items-center gap-2"><Icon name="bolt" size={15} />Open recovery controls</span><Icon name="arrowRight" size={14} />
            </Link>
            <Link href="/operations/audit-log" className="flex items-center justify-between p-4 text-sm hover:bg-[var(--color-surface-subtle)]">
              <span className="flex items-center gap-2"><Icon name="logs" size={15} />Search operator audit</span><Icon name="arrowRight" size={14} />
            </Link>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard title="Remaining platform lifecycle gaps">
          <div className="grid gap-4 p-4 text-sm md:grid-cols-3">
            <div className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-4">
              <div className="font-semibold">Release identity</div>
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">The current operator API does not expose the signed daemon release, manifest, or per-node running version. A readiness result cannot claim those artifacts are installed.</p>
            </div>
            <div className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-4">
              <div className="font-semibold">Fleet enrollment</div>
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">The console can inspect, drain, force-drain, and activate nodes, but join, decommission, and replacement workflows are not yet represented here.</p>
            </div>
            <div className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-4">
              <div className="font-semibold">Incident lifecycle</div>
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Incident Center currently aggregates live signals. Acknowledgement, ownership, escalation, and resolution still need durable operator records.</p>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="mt-4 text-xs text-[var(--color-ink-muted)]">
        This page is deliberately evidence-based: a missing backend signal is shown as unavailable or attention-required rather than inferred as healthy.
      </div>
    </div>
  );
}
