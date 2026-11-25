'use client';

import React from 'react';
import Link from 'next/link';
import {
  diskStateLabel,
  diskStateTone,
  formatHoursToFull,
  getDiskPressure,
  roleLabel,
  type ObsDiskPressureReport,
} from '@/lib/ops/diskPressure';
import { formatBytes } from '@/lib/operator';
import { useAsync } from '@/lib/useAsync';
import { appDeploymentsHref, instanceHref, nodeHref, opsHref } from '@/lib/routes';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { EntityId } from '@/components/operator/EntityId';

/* ==========================================================================
   Disk pressure (apid ADR-20261124150000): every host filesystem graded
   with the disk alert thresholds, the jail tmpfs (RAM), journals, and the
   fullest guest disks.
   ========================================================================== */

export default function DiskPressurePage() {
  const report = useAsync(() => getDiskPressure(), []);
  const r = report.data;
  return (
    <div>
      <PageHeader
        title="Disk pressure"
        subtitle="Free space, inodes and fill rate of every host filesystem, graded like the disk alerts, plus the jail tmpfs, journals and the fullest guest disks."
        actions={
          <button onClick={report.reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />
      {report.loading && !r ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading disks…</div>
      ) : report.error && !r ? (
        <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
          {report.error.message || 'Could not load disk pressure.'}
        </div>
      ) : r ? (
        <Report r={r} />
      ) : null}
    </div>
  );
}

function SourceNote({ r }: { r: ObsDiskPressureReport }) {
  if (r.source === 'observed') return null;
  const text =
    r.source === 'not_configured'
      ? 'apid has no Prometheus configured, so there is no disk data.'
      : r.source === 'unavailable'
        ? 'Prometheus did not answer; no disk data could be read.'
        : `Some reads failed (${r.failed_queries.join(', ')}); their fields are empty.`;
  return (
    <div role="status" className="rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
      {text}
    </div>
  );
}

function Report({ r }: { r: ObsDiskPressureReport }) {
  const t = r.totals;
  const urgent = r.filesystems.filter((f) => f.state === 'critical' || f.state === 'filling');
  return (
    <div className="space-y-4">
      <SourceNote r={r} />
      {urgent.length > 0 && (
        <div role="alert" className="rounded-lg bg-[var(--color-danger-subtle)] p-3 text-sm text-[var(--color-danger)]">
          {urgent.length} filesystem{urgent.length === 1 ? ' needs' : 's need'} attention now:{' '}
          {urgent.map((f, i) => (
            <span key={f.node + f.mountpoint}>
              {i > 0 && ', '}
              <span className="font-mono">
                {f.node}:{f.mountpoint}
              </span>{' '}
              ({f.state === 'filling' ? `full in ${formatHoursToFull(f.hours_to_full)}` : `${f.free_percent ?? '?'}% free`})
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Nodes"
          value={t.nodes}
          sub={`${t.nodes_critical} critical · ${t.nodes_filling} filling · ${t.nodes_low} low · ${t.nodes_inodes_low} inodes low${t.nodes_unknown ? ` · ${t.nodes_unknown} no disk data` : ''}`}
        />
        <StatTile label="Filesystems" value={t.filesystems} sub={`low under ${r.low_free_percent}% free, critical under ${r.critical_free_percent}%`} />
        <StatTile label="Jail tmpfs in use" value={formatBytes(t.jail_tmpfs_used_bytes)} sub="RAM held until the node reboots" />
        <StatTile label="Guest disks" value={t.guests_full} sub={`full · ${t.guests_near_full} near full`} />
      </div>

      <SectionCard title="Nodes">
        {r.nodes.length === 0 ? (
          <Empty>No hosts reporting.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Role</th>
                  <th>State</th>
                  <th>Fullest mount</th>
                  <th>Jail tmpfs</th>
                  <th>Journal</th>
                  <th>Guests near full / full</th>
                </tr>
              </thead>
              <tbody>
                {r.nodes.map((n) => (
                  <tr key={n.node}>
                    <td>
                      {n.role === 'compute' ? (
                        <Link href={nodeHref(n.node)} className="cell-primary font-mono hover:underline">
                          {n.node}
                        </Link>
                      ) : (
                        <span className="cell-primary font-mono">{n.node}</span>
                      )}
                    </td>
                    <td>{roleLabel(n.role)}</td>
                    <td>
                      <span className={`badge badge-${diskStateTone(n.state)}`}>{diskStateLabel(n.state)}</span>
                    </td>
                    <td className="font-mono">{n.worst_mountpoint ? `${n.worst_mountpoint} · ${n.worst_free_percent}% free` : '—'}</td>
                    <td>{n.jail_tmpfs_used_bytes ? formatBytes(n.jail_tmpfs_used_bytes) : '—'}</td>
                    <td>{n.journal_bytes != null ? formatBytes(n.journal_bytes) : '—'}</td>
                    <td>
                      {n.guests_near_full} / {n.guests_full}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Filesystems">
        {r.filesystems.length === 0 ? (
          <Empty>No filesystems reporting.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Mount</th>
                  <th>State</th>
                  <th>Free</th>
                  <th>Size</th>
                  <th>Inodes free</th>
                  <th>Full in</th>
                </tr>
              </thead>
              <tbody>
                {r.filesystems.map((f) => (
                  <tr key={f.node + f.mountpoint + f.device}>
                    <td className="font-mono">{f.node}</td>
                    <td className="font-mono">
                      {f.mountpoint}
                      {f.jail_tmpfs && <span className="badge badge-neutral ml-2">tmpfs</span>}
                    </td>
                    <td>
                      <span className={`badge badge-${diskStateTone(f.state)}`}>{diskStateLabel(f.state)}</span>
                    </td>
                    <td className="font-mono">{f.avail_bytes != null && f.free_percent != null ? `${formatBytes(f.avail_bytes)} · ${f.free_percent}%` : '—'}</td>
                    <td className="font-mono">{formatBytes(f.size_bytes)}</td>
                    <td>{f.inodes_free_percent != null ? `${f.inodes_free_percent}%` : '—'}</td>
                    <td>{formatHoursToFull(f.hours_to_full)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-foot">
          {r.truncated ? 'Only the worst filesystems are listed. ' : ''}
          Fill rate is measured over the last {Math.round(r.growth_window_seconds / 3600)} h. Snapshot sizes are on{' '}
          <Link href={opsHref('snapshots')} className="underline">
            Snapshot health
          </Link>
          .
        </div>
      </SectionCard>

      <SectionCard title="Fullest guest disks">
        {r.guests.length === 0 ? (
          <Empty>No guest disk usage reported.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Instance</th>
                  <th>App</th>
                  <th>Account</th>
                  <th>Node</th>
                  <th>Used</th>
                </tr>
              </thead>
              <tbody>
                {r.guests.map((g) => (
                  <tr key={g.instance_id}>
                    <td>
                      <Link href={instanceHref(g.instance_id)} className="font-mono hover:underline">
                        {g.instance_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>
                      {g.app_id ? (
                        <Link href={appDeploymentsHref(g.app_id)} className="cell-primary hover:underline">
                          {g.app_slug || g.app_id.slice(0, 8)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{g.account_id ? <EntityId id={g.account_id} kind="account" /> : '—'}</td>
                    <td className="font-mono">{g.node || '—'}</td>
                    <td>
                      <span className={`badge badge-${g.used_percent >= 95 ? 'danger' : g.used_percent >= 85 ? 'warning' : 'neutral'}`}>
                        {g.used_percent}%
                      </span>
                      {g.capacity_bytes > 0 && (
                        <span className="ml-2 font-mono">
                          {formatBytes(g.used_bytes)} of {formatBytes(g.capacity_bytes)}
                        </span>
                      )}
                    </td>
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

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">{children}</div>;
}
