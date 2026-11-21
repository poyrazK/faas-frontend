'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import {
  coldBootPct,
  formatMs,
  getWakeLatency,
  isWakeWindow,
  latencyTone,
  methodLabel,
  phaseLabel,
  restoresWithinTargetPct,
  WAKE_WINDOWS,
  type ObsWakeLatencyReport,
  type ObsWakeReasonCount,
} from '@/lib/ops/wakeLatency';
import { listComputeNodes } from '@/lib/ops/nodes';
import { useAsync } from '@/lib/useAsync';
import { useUrlParams } from '@/lib/useUrlState';
import { relativeTime } from '@/lib/format';
import { appDeploymentsHref, wakeHref } from '@/lib/routes';
import { FilterSelect, PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { EntityId } from '@/components/operator/EntityId';

/* ==========================================================================
   Fleet wake latency (apid ADR-20261121200409): how fast wakes were against
   the 350 ms restore target, which phase was slow, why wakes cold booted and
   which apps keep doing it. Filters live in the URL.
   ========================================================================== */

export default function WakeLatencyPage() {
  return (
    <Suspense>
      <WakeLatency />
    </Suspense>
  );
}

function WakeLatency() {
  const [params, update] = useUrlParams();
  const rawWindow = params.get('window');
  const win = isWakeWindow(rawWindow) ? rawWindow : '1h';
  const node = params.get('node') ?? '';
  const appId = params.get('app_id') ?? '';
  const nodes = useAsync(() => listComputeNodes(true), []);
  const report = useAsync(() => getWakeLatency({ window: win, node, appId }), [win, node, appId]);
  const r = report.data;

  return (
    <div>
      <PageHeader
        title="Wake latency"
        subtitle="Every wake in the window against the restore target: the slow ones, the phase that was slow, and the apps that keep cold booting."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              value={win}
              onChange={(v) => update({ window: v === '1h' ? null : v })}
              options={WAKE_WINDOWS.map((w) => ({ value: w, label: `Last ${w}` }))}
            />
            <FilterSelect
              value={node}
              onChange={(v) => update({ node: v || null })}
              options={[{ value: '', label: 'All nodes' }, ...(nodes.data ?? []).map((n) => ({ value: n.name, label: n.name }))]}
            />
            <button onClick={report.reload} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />

      {appId && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--color-ink-muted)]">Only app</span>
          <EntityId id={appId} kind="app" />
          <button className="btn btn-ghost btn-xs" onClick={() => update({ app_id: null })}>
            Clear
          </button>
        </div>
      )}

      {report.loading && !r ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading wakes…</div>
      ) : report.error && !r ? (
        <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
          {report.error.message || 'Could not load wake latency.'}
        </div>
      ) : r ? (
        <Report r={r} onApp={(id) => update({ app_id: id })} />
      ) : null}
    </div>
  );
}

function Report({ r, onApp }: { r: ObsWakeLatencyReport; onApp: (id: string) => void }) {
  const restore = r.methods.find((m) => m.method === 'restore');
  const within = restoresWithinTargetPct(r.totals);
  const cold = coldBootPct(r.totals);
  return (
    <div className="space-y-4">
      {!!r.truncated?.length && (
        <div role="status" className="rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
          Too many events to read them all ({r.truncated.join(', ')}); the figures cover only the newest part of the window.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Restore p95"
          value={restore ? <Ms ms={restore.p95_ms} target={r.target_ms} /> : '—'}
          sub={restore ? `p50 ${formatMs(restore.p50_ms)} · p99 ${formatMs(restore.p99_ms)} · target ${r.target_ms} ms` : 'No restores in the window.'}
        />
        <StatTile
          label="Restores within target"
          value={within === null ? '—' : `${within}%`}
          sub={`${r.totals.restores_over_target} of ${r.totals.restores} over ${r.target_ms} ms`}
        />
        <StatTile
          label="Cold boots"
          value={cold === null ? '—' : `${cold}%`}
          sub={`${r.totals.cold_boots} of ${r.totals.wakes} wakes · ${r.totals.fallbacks} restore fallback${r.totals.fallbacks === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Failed wakes"
          value={r.totals.failures}
          sub={`${r.totals.thaws} thaw${r.totals.thaws === 1 ? '' : 's'} · ${r.totals.platform_refreshes} snapshot refresh${r.totals.platform_refreshes === 1 ? '' : 'es'} not counted`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="By method">
          {r.methods.length === 0 ? (
            <Empty>No wakes in the window.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Wakes</th>
                    <th>p50</th>
                    <th>p95</th>
                    <th>p99</th>
                    <th>Max</th>
                  </tr>
                </thead>
                <tbody>
                  {r.methods.map((m) => (
                    <tr key={m.method}>
                      <td className="cell-primary">{methodLabel(m.method)}</td>
                      <td>{m.count}</td>
                      <td className="font-mono">{formatMs(m.p50_ms)}</td>
                      <td>{m.method === 'restore' ? <Ms ms={m.p95_ms} target={r.target_ms} /> : <span className="font-mono">{formatMs(m.p95_ms)}</span>}</td>
                      <td className="font-mono">{formatMs(m.p99_ms)}</td>
                      <td className="font-mono">{formatMs(m.max_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="By node">
          {r.nodes.length === 0 ? (
            <Empty>No wakes in the window.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Restores</th>
                    <th>Restore p95</th>
                    <th>Over target</th>
                    <th>Cold boots</th>
                    <th>Fallbacks</th>
                    <th>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {r.nodes.map((n) => (
                    <tr key={n.node_id || 'unknown'}>
                      <td>{n.node_name ? <EntityId id={n.node_name} kind="node" /> : n.node_id ? <span className="font-mono">{n.node_id.slice(0, 8)}</span> : '—'}</td>
                      <td>{n.restores}</td>
                      <td>{n.restores ? <Ms ms={n.restore_p95_ms} target={r.target_ms} /> : '—'}</td>
                      <td>{n.restores_over_target}</td>
                      <td>{n.cold_boots}</td>
                      <td>{n.fallbacks}</td>
                      <td>{n.failures}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Slowest wakes">
        {r.slowest.length === 0 ? (
          <Empty>No wakes in the window.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Wake</th>
                  <th>App</th>
                  <th>Node</th>
                  <th>Method</th>
                  <th>Took</th>
                  <th>Slowest phase</th>
                  <th>Why cold</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {r.slowest.map((w) => (
                  <tr key={`${w.wake_id}/${w.instance_id ?? ''}`}>
                    <td>
                      <Link href={wakeHref(w.wake_id)} className="font-mono hover:underline" aria-label={`Wake ${w.wake_id} timeline`}>
                        {w.wake_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>
                      <Link href={appDeploymentsHref(w.app_id)} className="cell-primary hover:underline">
                        {w.app_slug || w.app_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{w.node_name ? <EntityId id={w.node_name} kind="node" /> : '—'}</td>
                    <td>{methodLabel(w.method)}</td>
                    <td>
                      <Ms ms={w.duration_ms} target={r.target_ms} />
                    </td>
                    <td>{w.slow_phase ? `${phaseName(w.slow_phase)} · ${formatMs(w.slow_phase_ms ?? 0)}` : '—'}</td>
                    <td>{w.fallback_reason ? `restore failed (${w.fallback_reason})` : w.cold_reason || '—'}</td>
                    <td>{relativeTime(w.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Slowest phases (p95)">
          {r.phases.length === 0 ? (
            <Empty>No phase timings in the window.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Samples</th>
                    <th>p50</th>
                    <th>p95</th>
                    <th>Max</th>
                  </tr>
                </thead>
                <tbody>
                  {r.phases.slice(0, 15).map((p) => (
                    <tr key={`${p.method}/${p.phase}`}>
                      <td>
                        <span className="text-[var(--color-ink-muted)]">{methodLabel(p.method)} · </span>
                        <span className="cell-primary">{phaseLabel(p.phase)}</span>
                      </td>
                      <td>{p.samples}</td>
                      <td className="font-mono">{formatMs(p.p50_ms)}</td>
                      <td className="font-mono">{formatMs(p.p95_ms)}</td>
                      <td className="font-mono">{formatMs(p.max_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <div className="space-y-4">
          <Reasons title="Why wakes cold booted" rows={r.cold_reasons} empty="No cold boots in the window." />
          <Reasons title="Why wakes failed" rows={r.failure_reasons} empty="No failed wakes in the window." />
        </div>
      </div>

      <SectionCard title="Apps that keep cold booting">
        {r.cold_boot_apps.length === 0 ? (
          <Empty>No app cold booted in the window.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Account</th>
                  <th>Cold boots</th>
                  <th>Of wakes</th>
                  <th>Fallbacks</th>
                  <th>Main reason</th>
                  <th>p95</th>
                  <th>
                    <span className="sr-only">Filter</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.cold_boot_apps.map((a) => (
                  <tr key={a.app_id}>
                    <td>
                      <Link href={appDeploymentsHref(a.app_id)} className="cell-primary hover:underline">
                        {a.app_slug || a.app_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{a.account_id ? <EntityId id={a.account_id} kind="account" /> : '—'}</td>
                    <td>{a.cold_boots}</td>
                    <td>{a.wakes}</td>
                    <td>{a.fallbacks}</td>
                    <td>{a.top_cold_reason || '—'}</td>
                    <td className="font-mono">{formatMs(a.p95_ms)}</td>
                    <td>
                      <button className="btn btn-ghost btn-xs" onClick={() => onApp(a.app_id)}>
                        Only this app
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      <p className="text-xs text-[var(--color-ink-muted)]">
        Since {relativeTime(r.since)} · a wake&apos;s time is schedd&apos;s boot window (boot started → running); a thaw&apos;s is schedd&apos;s thaw total.
      </p>
    </div>
  );
}

const phaseName = (slow: string) => {
  const [method, phase] = slow.split('/');
  return phase ? `${methodLabel(method)} · ${phaseLabel(phase)}` : phaseLabel(slow);
};

function Ms({ ms, target }: { ms: number; target: number }) {
  return <span className={`badge badge-${latencyTone(ms, target)} font-mono`}>{formatMs(ms)}</span>;
}

function Reasons({ title, rows, empty }: { title: string; rows: ObsWakeReasonCount[]; empty: string }) {
  return (
    <SectionCard title={title}>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] text-xs">
          {rows.map((row) => (
            <li key={row.reason} className="flex items-center justify-between px-4 py-2">
              <span className="font-mono">{row.reason}</span>
              <span>{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">{children}</div>;
}
