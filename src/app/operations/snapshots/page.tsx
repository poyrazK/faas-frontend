'use client';

import React from 'react';
import Link from 'next/link';
import {
  cpuLabel,
  footprintTone,
  formatMB,
  getSnapshotHealth,
  type ObsSnapshotGroup,
  type ObsSnapshotHealthReport,
  type ObsSnapshotRow,
} from '@/lib/ops/snapshotHealth';
import { useAsync } from '@/lib/useAsync';
import { relativeTime } from '@/lib/format';
import { appDeploymentsHref, deploymentHref } from '@/lib/routes';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { EntityId } from '@/components/operator/EntityId';

/* ==========================================================================
   Fleet snapshot health (apid ADR-20261122135018): the parked footprint
   against the 130 MB target, which snapshots make it up, what went stale and
   which live deployments cold boot because they have no usable snapshot.
   ========================================================================== */

export default function SnapshotHealthPage() {
  const report = useAsync(getSnapshotHealth, []);
  const r = report.data;
  return (
    <div>
      <PageHeader
        title="Snapshot health"
        subtitle="Parked footprint against the 130 MB target, the snapshots behind it, and the live deployments that cold boot because they have no snapshot."
        actions={
          <button onClick={report.reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />
      {report.loading && !r ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading snapshots…</div>
      ) : report.error && !r ? (
        <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
          {report.error.message || 'Could not load snapshot health.'}
        </div>
      ) : r ? (
        <Report r={r} />
      ) : null}
    </div>
  );
}

function Report({ r }: { r: ObsSnapshotHealthReport }) {
  const t = r.totals;
  const broken = r.unsnapshotted.filter((d) => !d.cold_bootable);
  return (
    <div className="space-y-4">
      {t.not_cold_bootable > 0 && (
        <div role="alert" className="rounded-lg bg-[var(--color-danger-subtle)] p-3 text-sm text-[var(--color-danger)]">
          {t.not_cold_bootable} live deployment{t.not_cold_bootable === 1 ? ' has' : 's have'} neither a usable snapshot nor a rootfs: their next wake fails (invariant 6.2-3).{' '}
          {broken.slice(0, 3).map((d, i) => (
            <span key={d.deployment_id}>
              {i > 0 && ', '}
              <Link href={deploymentHref(d.deployment_id)} className="font-medium underline">
                {d.app_slug || d.deployment_id.slice(0, 8)}
              </Link>
            </span>
          ))}
        </div>
      )}
      {r.truncated && (
        <div role="status" className="rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
          Too many snapshots to read them all; the smallest are left out of the figures, so the average reads high.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Fleet average footprint"
          value={t.live ? <Footprint bytes={t.avg_bytes} r={r} /> : '—'}
          sub={`target ${r.target_mb} MB · warn ${r.warn_mb} · page ${r.page_mb}`}
        />
        <StatTile label="p95 footprint" value={t.live ? formatMB(t.p95_bytes) : '—'} sub={`${t.over_warn} snapshot${t.over_warn === 1 ? '' : 's'} over ${r.warn_mb} MB`} />
        <StatTile label="Live snapshots" value={t.live} sub={`${formatMB(t.live_bytes)} parked · ${t.stale} stale · ${t.delete_pending} pending deletion`} />
        <StatTile
          label="Live without a snapshot"
          value={t.unsnapshotted}
          sub={t.unsnapshotted ? 'Every wake cold boots until one is taken.' : 'Every live deployment can restore.'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Groups title="By tier" rows={r.tiers} label={(k) => k} />
        <Groups title="By Firecracker version" rows={r.fc_versions} label={(k) => k} />
        <Groups title="By CPU template" rows={r.cpu_templates} label={cpuLabel} />
      </div>

      <SnapshotTable title="Largest live snapshots" rows={r.largest} r={r} empty="No live snapshots." />
      <SnapshotTable title="Recently stale" rows={r.recently_stale} r={r} empty="No stale snapshots." stale />

      <SectionCard title="Live deployments without a snapshot">
        {r.unsnapshotted.length === 0 ? (
          <Empty>Every live deployment has a usable snapshot.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Account</th>
                  <th>Deployment</th>
                  <th>Can cold boot</th>
                  <th>Last snapshot staled</th>
                  <th>Deployed</th>
                </tr>
              </thead>
              <tbody>
                {r.unsnapshotted.map((d) => (
                  <tr key={d.deployment_id}>
                    <td>
                      <Link href={appDeploymentsHref(d.app_id)} className="cell-primary hover:underline">
                        {d.app_slug || d.app_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{d.account_id ? <EntityId id={d.account_id} kind="account" /> : '—'}</td>
                    <td>
                      <EntityId id={d.deployment_id} kind="deployment" />
                    </td>
                    <td>
                      {d.cold_bootable ? <span className="badge badge-neutral">yes</span> : <span className="badge badge-danger">no rootfs</span>}
                    </td>
                    <td>{d.last_stale_at ? relativeTime(d.last_stale_at) : 'never snapshotted'}</td>
                    <td>{relativeTime(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {r.unsnapshotted_truncated && <div className="table-foot">Showing the first {r.unsnapshotted.length}; more exist.</div>}
      </SectionCard>
    </div>
  );
}

function Footprint({ bytes, r }: { bytes: number; r: ObsSnapshotHealthReport }) {
  return <span className={`badge badge-${footprintTone(bytes, r)} font-mono`}>{formatMB(bytes)}</span>;
}

function Groups({ title, rows, label }: { title: string; rows: ObsSnapshotGroup[]; label: (key: string) => string }) {
  return (
    <SectionCard title={title}>
      {rows.length === 0 ? (
        <Empty>No snapshots.</Empty>
      ) : (
        <table className="dtable text-xs">
          <thead>
            <tr>
              <th>{title.replace(/^By /, '')}</th>
              <th>Live</th>
              <th>Stale</th>
              <th>Avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key}>
                <td className="cell-primary font-mono">{label(g.key)}</td>
                <td>{g.live}</td>
                <td>{g.stale}</td>
                <td className="font-mono">{g.live ? formatMB(g.avg_bytes) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function SnapshotTable({ title, rows, r, empty, stale = false }: { title: string; rows: ObsSnapshotRow[]; r: ObsSnapshotHealthReport; empty: string; stale?: boolean }) {
  return (
    <SectionCard title={title}>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>App</th>
                <th>Account</th>
                <th>Footprint</th>
                <th>Snapshot</th>
                <th>Layer</th>
                <th>Tier</th>
                <th>Firecracker</th>
                <th>CPU</th>
                <th>{stale ? 'Staled' : 'Taken'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={appDeploymentsHref(s.app_id)} className="cell-primary hover:underline">
                      {s.app_slug || s.app_id.slice(0, 8)}
                    </Link>
                    {s.delete_pending && <span className="badge badge-neutral ml-2">deleting</span>}
                  </td>
                  <td>{s.account_id ? <EntityId id={s.account_id} kind="account" /> : '—'}</td>
                  <td>
                    <Footprint bytes={s.footprint_bytes} r={r} />
                  </td>
                  <td className="font-mono">{formatMB(s.snapshot_bytes)}</td>
                  <td className="font-mono">{formatMB(s.layer_bytes)}</td>
                  <td>{s.tier}</td>
                  <td className="font-mono">{s.fc_version || '—'}</td>
                  <td className="font-mono">{s.cpu_template || s.cpu_model ? cpuLabel(`${s.cpu_template ?? ''}/${s.cpu_model ?? ''}`) : 'unpinned'}</td>
                  <td>{relativeTime(stale && s.stale_at ? s.stale_at : s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">{children}</div>;
}
