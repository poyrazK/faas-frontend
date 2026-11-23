'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import {
  eventLabel,
  getMemoryPressure,
  isMemoryWindow,
  MEMORY_WINDOWS,
  memoryWindowLabel,
  nodeStateTone,
  pctOf,
  type ObsMemoryNode,
  type ObsMemoryPressureReport,
} from '@/lib/ops/memoryPressure';
import { formatMegabytes } from '@/lib/operator';
import { useAsync } from '@/lib/useAsync';
import { useUrlParams } from '@/lib/useUrlState';
import { relativeTime } from '@/lib/format';
import { appDeploymentsHref, instanceHref, nodeHref, opsHref } from '@/lib/routes';
import { FilterSelect, PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { EntityId } from '@/components/operator/EntityId';

/* ==========================================================================
   Memory pressure (apid ADR-20261123190507): how close each node is to its
   RAM admission ceiling, measured and booked, and who was pushed out:
   evictions, frozen VMs parked under pressure, and OOM kills.
   ========================================================================== */

export default function MemoryPressurePage() {
  return (
    <Suspense>
      <MemoryPressure />
    </Suspense>
  );
}

function MemoryPressure() {
  const [params, update] = useUrlParams();
  const raw = params.get('window');
  const win = isMemoryWindow(raw) ? raw : '24h';
  const report = useAsync(() => getMemoryPressure(win), [win]);
  const r = report.data;
  return (
    <div>
      <PageHeader
        title="Memory pressure"
        subtitle="Each node's measured and booked memory against its admission ceiling, and the apps evicted or OOM-killed in the window."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              value={win}
              onChange={(v) => update({ window: v === '24h' ? null : v })}
              options={MEMORY_WINDOWS.map((w) => ({ value: w, label: `Last ${memoryWindowLabel(w)}` }))}
            />
            <button onClick={report.reload} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />
      {report.loading && !r ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading memory…</div>
      ) : report.error && !r ? (
        <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
          {report.error.message || 'Could not load memory pressure.'}
        </div>
      ) : r ? (
        <Report r={r} win={win} />
      ) : null}
    </div>
  );
}

function Report({ r, win }: { r: ObsMemoryPressureReport; win: Parameters<typeof memoryWindowLabel>[0] }) {
  const t = r.totals;
  const over = r.nodes.filter((n) => n.state === 'over');
  return (
    <div className="space-y-4">
      {over.length > 0 && (
        <div role="alert" className="rounded-lg bg-[var(--color-danger-subtle)] p-3 text-sm text-[var(--color-danger)]">
          {over.length} node{over.length === 1 ? ' is' : 's are'} over the admission ceiling: schedd is evicting until it is back under {r.eviction_target_percent}%.{' '}
          {over.map((n, i) => (
            <span key={n.node_id}>
              {i > 0 && ', '}
              <Link href={nodeHref(n.name)} className="font-medium underline">
                {n.name}
              </Link>
            </span>
          ))}
        </div>
      )}
      {r.truncated && (
        <div role="status" className="rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
          Too many events to read them all; the counts cover only the newest part of the window.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Measured memory"
          value={t.ceiling_mb ? `${pctOf(t.measured_mb, t.ceiling_mb)}%` : '—'}
          sub={`${formatMegabytes(t.measured_mb)} of ${formatMegabytes(t.ceiling_mb)} ceiling · ${t.nodes_over} over · ${t.nodes_near} near${t.nodes_stale ? ` · ${t.nodes_stale} stale` : ''}`}
        />
        <StatTile label="Booked" value={formatMegabytes(t.booked_mb)} sub={`${t.running} running · ${t.frozen} frozen · cap ${r.overcommit_percent}% of ceiling`} />
        <StatTile
          label={`Evictions, last ${memoryWindowLabel(win)}`}
          value={t.evictions + t.frozen_parks}
          sub={`${t.evictions} running · ${t.frozen_parks} frozen parked · ${t.apps_affected} app${t.apps_affected === 1 ? '' : 's'} affected`}
        />
        <StatTile label="OOM kills" value={t.oom_kills} sub="workloads over their plan RAM" />
      </div>

      <SectionCard title="Nodes">
        {r.nodes.length === 0 ? (
          <Empty>No compute nodes.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>State</th>
                  <th>Measured</th>
                  <th>Booked</th>
                  <th>Running / frozen</th>
                  <th>Evicted</th>
                  <th>OOM</th>
                  <th>Measured at</th>
                </tr>
              </thead>
              <tbody>
                {r.nodes.map((n) => (
                  <NodeRow key={n.node_id} n={n} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-foot">
          Booked headroom and placement are on <Link href={opsHref('capacity')} className="underline">Capacity</Link>.
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard title="By reason">
          {r.reasons.length === 0 ? (
            <Empty>No evictions or OOM kills.</Empty>
          ) : (
            <table className="dtable text-xs">
              <tbody>
                {r.reasons.map((x) => (
                  <tr key={x.kind + x.reason}>
                    <td className="cell-primary">{eventLabel(x)}</td>
                    <td>{x.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
        <div className="xl:col-span-2">
          <SectionCard title="Most affected apps">
            {r.apps.length === 0 ? (
              <Empty>No app was evicted or OOM-killed.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="dtable text-xs">
                  <thead>
                    <tr>
                      <th>App</th>
                      <th>Account</th>
                      <th>Plan</th>
                      <th>Evicted</th>
                      <th>OOM kills</th>
                      <th>Peak / plan</th>
                      <th>Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.apps.map((a) => (
                      <tr key={a.app_id}>
                        <td>
                          <Link href={appDeploymentsHref(a.app_id)} className="cell-primary hover:underline">
                            {a.app_slug || a.app_id.slice(0, 8)}
                          </Link>
                        </td>
                        <td>{a.account_id ? <EntityId id={a.account_id} kind="account" /> : '—'}</td>
                        <td>{a.plan || '—'}</td>
                        <td>{a.evictions + a.frozen_parks}</td>
                        <td>{a.oom_kills}</td>
                        <td className="font-mono">{a.max_peak_mb ? `${a.max_peak_mb} / ${a.plan_mb} MB` : '—'}</td>
                        <td>{relativeTime(a.last_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Recent events">
        {r.events.length === 0 ? (
          <Empty>Nothing was evicted or OOM-killed in the window.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>App</th>
                  <th>Plan</th>
                  <th>Node</th>
                  <th>Memory</th>
                  <th>Instance</th>
                </tr>
              </thead>
              <tbody>
                {r.events.map((e, i) => (
                  <tr key={`${e.at}-${e.instance_id ?? i}-${e.kind}`}>
                    <td>{relativeTime(e.at)}</td>
                    <td>
                      <span className={`badge badge-${e.kind === 'oom_kill' ? 'danger' : 'warning'}`}>{eventLabel(e)}</span>
                      {e.deployment_failed && <span className="badge badge-danger ml-2">deploy failed</span>}
                    </td>
                    <td>
                      {e.app_id ? (
                        <Link href={appDeploymentsHref(e.app_id)} className="cell-primary hover:underline">
                          {e.app_slug || e.app_id.slice(0, 8)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{e.plan || '—'}</td>
                    <td className="font-mono">{e.node_name ? <Link href={nodeHref(e.node_name)}>{e.node_name}</Link> : '—'}</td>
                    <td className="font-mono">{e.kind === 'oom_kill' && e.peak_mb ? `peak ${e.peak_mb} / ${e.plan_mb} MB` : e.ram_mb ? `${e.ram_mb} MB` : '—'}</td>
                    <td>{e.instance_id ? <Link href={instanceHref(e.instance_id)} className="font-mono hover:underline">{e.instance_id.slice(0, 8)}</Link> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function NodeRow({ n }: { n: ObsMemoryNode }) {
  const measuredPct = pctOf(n.measured_mb, n.ceiling_mb);
  const bookedPct = pctOf(n.booked_mb, n.ceiling_mb);
  return (
    <tr>
      <td>
        <Link href={nodeHref(n.name)} className="cell-primary font-mono hover:underline">
          {n.name}
        </Link>
        {!n.active && <span className="badge badge-neutral ml-2">inactive</span>}
      </td>
      <td>
        <span className={`badge badge-${nodeStateTone(n.state)}`}>{n.state}</span>
      </td>
      <td className="font-mono">{n.measured_mb != null ? `${formatMegabytes(n.measured_mb)} · ${measuredPct}%` : '—'}</td>
      <td className="font-mono">
        {formatMegabytes(n.booked_mb)} · {bookedPct}%
      </td>
      <td>
        {n.running} / {n.frozen}
      </td>
      <td>{n.evictions + n.frozen_parks}</td>
      <td>{n.oom_kills}</td>
      <td>{n.measured_at ? relativeTime(n.measured_at) : 'never'}</td>
    </tr>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">{children}</div>;
}
