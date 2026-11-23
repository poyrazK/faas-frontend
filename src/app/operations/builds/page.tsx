'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import {
  BUILD_QUEUE_WINDOWS,
  cacheHitRate,
  failureLabel,
  getBuildQueue,
  isBuildQueueWindow,
  slotSummary,
  waitTone,
  windowLabel,
  type ObsBuildQueueReport,
  type ObsBuildRow,
} from '@/lib/ops/buildQueue';
import { formatAgeSeconds } from '@/lib/ops/workloads';
import { formatBytes } from '@/lib/operator';
import { useAsync } from '@/lib/useAsync';
import { useUrlParams } from '@/lib/useUrlState';
import { relativeTime } from '@/lib/format';
import { appDeploymentsHref } from '@/lib/routes';
import { FilterSelect, PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { EntityId } from '@/components/operator/EntityId';

/* ==========================================================================
   Build queue (apid ADR-20261123163340): what is waiting and running now,
   how full each node's builder slots are, and how the window's builds went:
   durations, failures by cause and cache outcomes.
   ========================================================================== */

export default function BuildQueuePage() {
  return (
    <Suspense>
      <BuildQueue />
    </Suspense>
  );
}

function BuildQueue() {
  const [params, update] = useUrlParams();
  const raw = params.get('window');
  const win = isBuildQueueWindow(raw) ? raw : '24h';
  const report = useAsync(() => getBuildQueue(win), [win]);
  const r = report.data;
  return (
    <div>
      <PageHeader
        title="Build queue"
        subtitle="Builds waiting and running now, builder slot use per node, and how the window's builds went."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              value={win}
              onChange={(v) => update({ window: v === '24h' ? null : v })}
              options={BUILD_QUEUE_WINDOWS.map((w) => ({ value: w, label: `Last ${windowLabel(w)}` }))}
            />
            <button onClick={report.reload} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />
      {report.loading && !r ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading builds…</div>
      ) : report.error && !r ? (
        <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
          {report.error.message || 'Could not load the build queue.'}
        </div>
      ) : r ? (
        <Report r={r} />
      ) : null}
    </div>
  );
}

function Report({ r }: { r: ObsBuildQueueReport }) {
  const t = r.totals;
  const hit = cacheHitRate(t);
  return (
    <div className="space-y-4">
      {t.running_over_timeout > 0 && (
        <div role="alert" className="rounded-lg bg-[var(--color-danger-subtle)] p-3 text-sm text-[var(--color-danger)]">
          {t.running_over_timeout} build{t.running_over_timeout === 1 ? ' has' : 's have'} run past the {formatAgeSeconds(r.build_timeout_seconds)} build timeout. The
          stuck-build sweep on Emergency controls can reclaim {t.running_over_timeout === 1 ? 'it' : 'them'}.
        </div>
      )}
      {(r.active_truncated || r.finished_truncated) && (
        <div role="status" className="rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
          {r.active_truncated ? 'Too many active builds to read them all; the newest are left out. ' : ''}
          {r.finished_truncated ? 'Too many finished builds to read them all; the figures cover only the newest part of the window.' : ''}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Queued"
          value={t.queued}
          sub={`oldest ${t.queued ? formatAgeSeconds(t.oldest_wait_seconds) : '—'} · ${t.waiting_over_warn} over ${formatAgeSeconds(r.wait_warn_seconds)}${t.deferred ? ` · ${t.deferred} deferred` : ''}`}
        />
        <StatTile label="Running" value={t.running} sub={`${r.nodes.filter((n) => n.running_builds > 0).length} node(s) building`} />
        <StatTile
          label={`Finished, last ${windowLabel(win(r))}`}
          value={t.finished}
          sub={`${t.succeeded} ok · ${t.failed} failed · ${t.cancelled} cancelled`}
        />
        <StatTile
          label="Build time p50 / p95"
          value={t.finished ? `${formatAgeSeconds(t.duration_p50_seconds)} / ${formatAgeSeconds(t.duration_p95_seconds)}` : '—'}
          sub={`wait p95 ${formatAgeSeconds(t.wait_p95_seconds)} · cache hit ${hit == null ? '—' : `${Math.round(hit * 100)}%`}${t.preempted ? ` · ${t.preempted} preempted` : ''}`}
        />
      </div>

      <Slots r={r} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Failures by cause">
          {r.failures.length === 0 ? (
            <Empty>No failed builds in the window.</Empty>
          ) : (
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Cause</th>
                  <th>Builds</th>
                </tr>
              </thead>
              <tbody>
                {r.failures.map((f) => (
                  <tr key={f.class}>
                    <td className="cell-primary">{failureLabel(f.class)}</td>
                    <td>{f.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
        <SectionCard title="By kind">
          {r.kinds.length === 0 ? (
            <Empty>No builds.</Empty>
          ) : (
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Queued</th>
                  <th>Running</th>
                  <th>Finished</th>
                  <th>Failed</th>
                  <th>p95</th>
                </tr>
              </thead>
              <tbody>
                {r.kinds.map((k) => (
                  <tr key={k.kind}>
                    <td className="cell-primary font-mono">{k.kind}</td>
                    <td>{k.queued}</td>
                    <td>{k.running}</td>
                    <td>{k.finished}</td>
                    <td>{k.failed}</td>
                    <td className="font-mono">{k.finished ? formatAgeSeconds(k.duration_p95_seconds) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      <BuildTable title="Queued" rows={r.queued} r={r} empty="Nothing is waiting." mode="queued" />
      <BuildTable title="Running" rows={r.running} r={r} empty="Nothing is building." mode="running" />
      <BuildTable title="Slowest builds" rows={r.slowest} r={r} empty="No builds finished in the window." mode="finished" />
      <BuildTable title="Recent failures" rows={r.recent_failures} r={r} empty="No failed builds in the window." mode="finished" />
    </div>
  );
}

const win = (r: ObsBuildQueueReport) => {
  const w = `${Math.round(r.window_seconds / 3600)}h`;
  return isBuildQueueWindow(w) ? w : '24h';
};

function Slots({ r }: { r: ObsBuildQueueReport }) {
  return (
    <SectionCard title="Builder slots by node">
      {r.slots_state !== 'observed' && (
        <div role="status" className="border-b border-[var(--color-border)] p-3 text-xs text-[var(--color-ink-muted)]">
          {r.slots_state === 'unavailable' ? 'Prometheus did not answer, so slot use is missing;' : 'Prometheus is not configured, so slot use is missing;'} running builds come from the database.
        </div>
      )}
      {r.nodes.length === 0 ? (
        <Empty>No builder reported and nothing is building.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>Node</th>
                <th>Running</th>
                <th>Slots in use</th>
                <th>Limit</th>
                <th>Split</th>
              </tr>
            </thead>
            <tbody>
              {r.nodes.map((n) => (
                <tr key={n.node}>
                  <td className="cell-primary font-mono">{n.node}</td>
                  <td>{n.running_builds}</td>
                  <td>{n.observed ? n.in_use : '—'}</td>
                  <td>{n.observed ? n.limit : '—'}</td>
                  <td>
                    {n.observed && n.limit > 0 && n.in_use >= n.limit && <span className="badge badge-warning mr-2">full</span>}
                    {slotSummary(n)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function BuildTable({ title, rows, r, empty, mode }: { title: string; rows: ObsBuildRow[]; r: ObsBuildQueueReport; empty: string; mode: 'queued' | 'running' | 'finished' }) {
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
                <th>Kind</th>
                <th>{mode === 'queued' ? 'Waiting' : 'Waited'}</th>
                {mode !== 'queued' && <th>{mode === 'running' ? 'Running for' : 'Took'}</th>}
                {mode !== 'queued' && <th>{mode === 'running' ? 'Node' : 'Outcome'}</th>}
                <th>Source</th>
                <th>{mode === 'finished' ? 'Finished' : 'Enqueued'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.app_id ? (
                      <Link href={appDeploymentsHref(b.app_id)} className="cell-primary hover:underline">
                        {b.app_slug || b.app_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <EntityId id={b.deployment_id} kind="deployment" />
                    )}
                    {b.preemptions > 0 && <span className="badge badge-neutral ml-2">preempted ×{b.preemptions}</span>}
                    {b.coalesced && <span className="badge badge-neutral ml-2">coalesced</span>}
                  </td>
                  <td>{b.account_id ? <EntityId id={b.account_id} kind="account" /> : '—'}</td>
                  <td className="font-mono">{b.kind}</td>
                  <td>
                    {mode === 'queued' && b.not_before && new Date(b.not_before) > new Date(r.as_of) ? (
                      <span className="badge badge-neutral">deferred {relativeTime(b.not_before)}</span>
                    ) : (
                      <span className={`badge badge-${mode === 'queued' ? waitTone(b.wait_seconds, r.wait_warn_seconds) : 'neutral'} font-mono`}>{formatAgeSeconds(b.wait_seconds)}</span>
                    )}
                  </td>
                  {mode !== 'queued' && (
                    <td className="font-mono">
                      {mode === 'running' && b.duration_seconds > r.build_timeout_seconds ? (
                        <span className="badge badge-danger">{formatAgeSeconds(b.duration_seconds)}</span>
                      ) : (
                        formatAgeSeconds(b.duration_seconds)
                      )}
                    </td>
                  )}
                  {mode === 'running' && <td className="font-mono">{b.node || 'unrecorded'}</td>}
                  {mode === 'finished' && (
                    <td>
                      {b.status === 'failed' ? (
                        <span className="badge badge-danger">{failureLabel(b.failure_class ?? '')}</span>
                      ) : (
                        <span className="badge badge-success">{b.status}</span>
                      )}
                      {b.cache_status && <span className="ml-2 text-[var(--color-ink-muted)]">cache {b.cache_status}</span>}
                    </td>
                  )}
                  <td className="font-mono">{formatBytes(b.source_bytes)}</td>
                  <td>{relativeTime(mode === 'finished' && b.finished_at ? b.finished_at : b.enqueued_at)}</td>
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
