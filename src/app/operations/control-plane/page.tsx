'use client';

import React from 'react';
import Link from 'next/link';
import {
  CP_GROUPS,
  checksOf,
  cpGroupLabel,
  cpStateLabel,
  cpStateTone,
  formatSeconds,
  formatThreshold,
  getControlPlane,
  type ObsControlPlaneReport,
} from '@/lib/ops/controlPlane';
import { formatBytes } from '@/lib/operator';
import { useAsync } from '@/lib/useAsync';
import { nodeHref, opsHref } from '@/lib/routes';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';

/* ==========================================================================
   Control-plane health (apid ADR-20261126120000): Postgres, backups and WAL,
   delivery outboxes, daemon pools and pg_notify hubs, graded like the alerts.
   ========================================================================== */

export default function ControlPlanePage() {
  const report = useAsync(() => getControlPlane(), []);
  const r = report.data;
  return (
    <div>
      <PageHeader
        title="Control plane"
        subtitle="The control plane's Postgres, backups and WAL, delivery outboxes, and every daemon's database pool, graded like the alerts they mirror."
        actions={
          <button onClick={report.reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />
      {report.loading && !r ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading control plane…</div>
      ) : report.error && !r ? (
        <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
          {report.error.message || 'Could not load control-plane health.'}
        </div>
      ) : r ? (
        <Report r={r} />
      ) : null}
    </div>
  );
}

function SourceNote({ r }: { r: ObsControlPlaneReport }) {
  if (r.source === 'observed') return null;
  const text =
    r.source === 'not_configured'
      ? 'apid has no Prometheus configured, so there is no control-plane data.'
      : r.source === 'unavailable'
        ? 'Prometheus did not answer; no control-plane data could be read.'
        : `Some reads failed (${r.failed_queries.join(', ')}); their checks show as not reported.`;
  return (
    <div role="status" className="rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
      {text}
    </div>
  );
}

function Report({ r }: { r: ObsControlPlaneReport }) {
  const p = r.postgres;
  const urgent = r.checks.filter((c) => c.state === 'critical' || c.state === 'warning');
  const windowH = Math.round(r.window_seconds / 3600);
  return (
    <div className="space-y-4">
      <SourceNote r={r} />
      {urgent.length > 0 && (
        <div role="alert" className={`rounded-lg p-3 text-sm ${r.state === 'critical' ? 'bg-[var(--color-danger-subtle)] text-[var(--color-danger)]' : 'bg-[var(--color-warning-subtle)] text-[var(--color-warning-bold)]'}`}>
          {urgent.length} check{urgent.length === 1 ? ' needs' : 's need'} attention:{' '}
          {urgent.map((c, i) => (
            <span key={c.key}>
              {i > 0 && '; '}
              <strong>{c.label}</strong> ({c.detail})
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Checks"
          value={<span className={`badge badge-${cpStateTone(r.state)}`}>{cpStateLabel(r.state)}</span>}
          sub={`${r.totals.critical} critical · ${r.totals.warning} warning · ${r.totals.unknown} not reported of ${r.totals.checks}`}
        />
        <StatTile
          label="Postgres connections"
          value={p.client_connections != null && p.connection_capacity ? `${p.client_connections} / ${p.connection_capacity}` : '—'}
          sub={p.database_size_bytes != null ? `database ${formatBytes(p.database_size_bytes)}` : 'database size not reported'}
        />
        <StatTile
          label="Transactions"
          value={p.commits_per_second != null ? `${p.commits_per_second}/s` : '—'}
          sub={`${p.rollback_percent ?? '—'}% rolled back · cache hit ${p.cache_hit_percent ?? '—'}% (last ${windowH} h)`}
        />
        <StatTile
          label="Host"
          value={r.host.load1 != null ? `load ${r.host.load1}` : '—'}
          sub={
            r.host.mem_total_bytes != null && r.host.mem_available_bytes != null
              ? `${r.host.cpus ?? '?'} CPUs · ${formatBytes(r.host.mem_available_bytes)} of ${formatBytes(r.host.mem_total_bytes)} free`
              : 'not reported'
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {CP_GROUPS.map((g) => (
          <SectionCard key={g} title={cpGroupLabel(g)}>
            <table className="dtable text-xs">
              <tbody>
                {checksOf(r, g).map((c) => (
                  <tr key={c.key}>
                    <td className="cell-primary">{c.label}</td>
                    <td>
                      <span className={`badge badge-${cpStateTone(c.state)}`} title={c.alert ? `Mirrors ${c.alert}` : undefined}>
                        {cpStateLabel(c.state)}
                      </span>
                    </td>
                    <td>{c.detail}</td>
                    <td className="text-[var(--color-ink-muted)]">{formatThreshold(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g === 'postgres' && (
              <div className="table-foot">
                Longest query {formatSeconds(p.longest_query_seconds)} · temp files {p.temp_bytes != null ? formatBytes(p.temp_bytes) : '—'} in the last {windowH} h.
              </div>
            )}
          </SectionCard>
        ))}
      </div>

      <SectionCard title={`Slowest statements (last ${windowH} h)`}>
        {r.statements.length === 0 ? (
          <Empty>No statement timings reported.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Statement</th>
                  <th>Total time</th>
                  <th>Calls</th>
                  <th>Mean</th>
                </tr>
              </thead>
              <tbody>
                {r.statements.map((s) => (
                  <tr key={s.query_id}>
                    <td className="max-w-[48rem] truncate font-mono" title={s.query}>
                      {s.query || s.query_id}
                    </td>
                    <td>{s.exec_seconds} s</td>
                    <td>{s.calls ?? '—'}</td>
                    <td>{s.mean_ms != null ? `${s.mean_ms} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Database pools">
        {r.pools.length === 0 ? (
          <Empty>No pools reporting.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>Node</th>
                  <th>State</th>
                  <th>In use</th>
                  <th>Idle</th>
                  <th>Canceled acquires</th>
                  <th>Mean wait</th>
                </tr>
              </thead>
              <tbody>
                {r.pools.map((pool) => (
                  <tr key={pool.pool + pool.job + (pool.node ?? '')}>
                    <td className="cell-primary font-mono">{pool.pool}</td>
                    <td>{pool.node ? <Link href={nodeHref(pool.node)} className="font-mono hover:underline">{pool.node}</Link> : 'control plane'}</td>
                    <td>
                      <span className={`badge badge-${cpStateTone(pool.state)}`}>{cpStateLabel(pool.state)}</span>
                    </td>
                    <td>
                      {pool.acquired}
                      {pool.max != null && ` of ${pool.max}`}
                      {pool.utilization_percent != null && ` · ${pool.utilization_percent}%`}
                    </td>
                    <td>{pool.idle}</td>
                    <td>{pool.canceled_acquires}</td>
                    <td>{pool.mean_acquire_wait_ms != null ? `${pool.mean_acquire_wait_ms} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard title="Postgres backends">
          {r.backends.length === 0 ? (
            <Empty>No backends reported.</Empty>
          ) : (
            <table className="dtable text-xs">
              <tbody>
                {r.backends.map((b) => (
                  <tr key={b.application + b.state}>
                    <td className="font-mono">{b.application || '—'}</td>
                    <td>{b.state}</td>
                    <td>{b.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
        <SectionCard title="pg_notify listeners">
          {r.notify_hubs.length === 0 ? (
            <Empty>No listeners reported.</Empty>
          ) : (
            <table className="dtable text-xs">
              <tbody>
                {r.notify_hubs.map((h) => (
                  <tr key={h.hub + h.job + (h.node ?? '')}>
                    <td className="font-mono">
                      {h.hub}
                      {h.node && <span className="text-[var(--color-ink-muted)]"> @ {h.node}</span>}
                    </td>
                    <td>
                      <span className={`badge badge-${cpStateTone(h.state)}`}>{h.state === 'warning' ? 'Disconnected' : cpStateLabel(h.state)}</span>
                    </td>
                    <td>
                      {h.subscribers} subs · {h.reconnects} reconnects
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
        <SectionCard title="Control-plane targets">
          {r.targets.length === 0 ? (
            <Empty>No targets reported.</Empty>
          ) : (
            <table className="dtable text-xs">
              <tbody>
                {r.targets.map((t) => (
                  <tr key={t.job + t.instance}>
                    <td className="font-mono">{t.job}</td>
                    <td className="font-mono text-[var(--color-ink-muted)]">{t.instance}</td>
                    <td>
                      <span className={`badge badge-${t.up ? 'success' : 'danger'}`}>{t.up ? 'Up' : 'Down'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>
      <div className="text-xs text-[var(--color-ink-muted)]">
        Control-plane disks are on{' '}
        <Link href={opsHref('disk')} className="underline">
          Disk pressure
        </Link>
        ; firing alerts are on{' '}
        <Link href={opsHref('incidents')} className="underline">
          Incidents
        </Link>
        .
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">{children}</div>;
}
