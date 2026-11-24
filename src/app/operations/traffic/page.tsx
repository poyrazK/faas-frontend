'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import {
  admissionOutcomeBad,
  admissionOutcomeLabel,
  errorRateTone,
  formatCount,
  formatPercent,
  getGatewayTraffic,
  isTrafficWindow,
  TRAFFIC_WINDOWS,
  trafficWindowLabel,
  type ObsGatewayTrafficReport,
  type ObsGatewayReasonCount,
  type TrafficWindow,
} from '@/lib/ops/gatewayTraffic';
import { useAsync } from '@/lib/useAsync';
import { useUrlParams } from '@/lib/useUrlState';
import { appDeploymentsHref, nodeHref, opsHref } from '@/lib/routes';
import { FilterSelect, PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { EntityId } from '@/components/operator/EntityId';

/* ==========================================================================
   Gateway traffic (apid ADR-20261124093000): what happened to requests —
   status codes, 5xx the platform produced, capacity refusals, wake queue
   outcomes and edge rejections, per node and for the most affected apps.
   ========================================================================== */

export default function GatewayTrafficPage() {
  return (
    <Suspense>
      <GatewayTraffic />
    </Suspense>
  );
}

function GatewayTraffic() {
  const [params, update] = useUrlParams();
  const raw = params.get('window');
  const win = isTrafficWindow(raw) ? raw : '1h';
  const report = useAsync(() => getGatewayTraffic(win), [win]);
  const r = report.data;
  return (
    <div>
      <PageHeader
        title="Gateway traffic"
        subtitle="What happened to requests: status codes, errors the platform produced, capacity refusals and wake queue outcomes, by node and app."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              value={win}
              onChange={(v) => update({ window: v === '1h' ? null : v })}
              options={TRAFFIC_WINDOWS.map((w) => ({ value: w, label: `Last ${trafficWindowLabel(w)}` }))}
            />
            <button onClick={report.reload} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />
      {report.loading && !r ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading traffic…</div>
      ) : report.error && !r ? (
        <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
          {report.error.message || 'Could not load gateway traffic.'}
        </div>
      ) : r ? (
        <Report r={r} win={win} />
      ) : null}
    </div>
  );
}

function SourceNote({ r }: { r: ObsGatewayTrafficReport }) {
  if (r.source === 'observed') return null;
  const text =
    r.source === 'not_configured'
      ? 'apid has no Prometheus configured, so there is no traffic data.'
      : r.source === 'unavailable'
        ? 'Prometheus did not answer; no traffic data could be read.'
        : `Some reads failed (${r.failed_queries.join(', ')}); their sections are empty.`;
  return (
    <div role="status" className="rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
      {text}
    </div>
  );
}

function Report({ r, win }: { r: ObsGatewayTrafficReport; win: TrafficWindow }) {
  const t = r.totals;
  const turnedAway = t.wake_app_queue_full + t.wake_gateway_queue_full + t.wake_queue_timeouts;
  return (
    <div className="space-y-4">
      <SourceNote r={r} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={`Requests, last ${trafficWindowLabel(win)}`}
          value={formatCount(t.requests)}
          sub={`${formatCount(t.status_5xx)} 5xx (${formatPercent(t.error_rate_percent)}) · ${formatCount(t.status_4xx)} 4xx`}
        />
        <StatTile
          label="Platform errors"
          value={formatCount(t.platform_errors)}
          sub={`${formatPercent(t.platform_error_rate_percent)} of requests · 502 ${formatCount(t.status_502)} · 503 ${formatCount(t.status_503)} · 504 ${formatCount(t.status_504)}`}
        />
        <StatTile
          label="Wake queue"
          value={formatCount(turnedAway)}
          sub={`turned away of ${formatCount(t.wakes_admitted + turnedAway)} wakes · ${formatCount(t.held_now)} held now`}
        />
        <StatTile label="Capacity refusals" value={formatCount(t.capacity_refusals)} sub={`429s for apps at capacity · ${formatCount(t.status_429)} 429s in all`} />
      </div>

      <SectionCard title="Nodes">
        {r.nodes.length === 0 ? (
          <Empty>No gateway traffic in the window.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Requests</th>
                  <th>5xx</th>
                  <th>Platform errors</th>
                  <th>Capacity refusals</th>
                  <th>Held now</th>
                  <th>Overload</th>
                </tr>
              </thead>
              <tbody>
                {r.nodes.map((n) => (
                  <tr key={n.node || '-'}>
                    <td>
                      {n.node ? (
                        <Link href={nodeHref(n.node)} className="cell-primary font-mono hover:underline">
                          {n.node}
                        </Link>
                      ) : (
                        <span className="text-[var(--color-ink-muted)]">no node label</span>
                      )}
                    </td>
                    <td>{formatCount(n.requests)}</td>
                    <td>
                      <span className={`badge badge-${errorRateTone(n.error_rate_percent)}`}>
                        {formatCount(n.status_5xx)} · {formatPercent(n.error_rate_percent)}
                      </span>
                    </td>
                    <td>{formatCount(n.platform_errors)}</td>
                    <td>{formatCount(n.capacity_refusals)}</td>
                    <td>{formatCount(n.held_now)}</td>
                    <td className="font-mono">{n.overload_level != null ? n.overload_level.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-foot">
          Wake times are on <Link href={opsHref('wakes')} className="underline">Wake latency</Link>.
        </div>
      </SectionCard>

      <SectionCard title="Most affected apps">
        {r.apps.length === 0 ? (
          <Empty>No app had errors, refusals or held requests.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Account</th>
                  <th>Plan</th>
                  <th>Requests</th>
                  <th>5xx</th>
                  <th>502 / 503 / 504</th>
                  <th>Platform errors</th>
                  <th>Refused</th>
                  <th>Held now</th>
                </tr>
              </thead>
              <tbody>
                {r.apps.map((a) => (
                  <tr key={a.app_id}>
                    <td>
                      {a.unknown_host ? (
                        <span className="text-[var(--color-ink-muted)]">unknown host</span>
                      ) : (
                        <Link href={appDeploymentsHref(a.app_id)} className="cell-primary hover:underline">
                          {a.app_slug || a.app_id.slice(0, 8)}
                        </Link>
                      )}
                    </td>
                    <td>{a.account_id ? <EntityId id={a.account_id} kind="account" /> : '—'}</td>
                    <td>{a.plan || '—'}</td>
                    <td>{a.requests ? formatCount(a.requests) : '—'}</td>
                    <td>
                      {a.status_5xx ? (
                        <span className={`badge badge-${errorRateTone(a.error_rate_percent)}`}>
                          {formatCount(a.status_5xx)}
                          {a.requests ? ` · ${formatPercent(a.error_rate_percent)}` : ''}
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="font-mono">
                      {a.status_502} / {a.status_503} / {a.status_504}
                    </td>
                    <td>{formatCount(a.platform_errors)}</td>
                    <td>{formatCount(a.capacity_refusals)}</td>
                    <td>{formatCount(a.held_now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Wake admission">
          {r.wake_admission.length === 0 ? (
            <Empty>No wakes in the window.</Empty>
          ) : (
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Outcome</th>
                  <th>Plan</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {r.wake_admission.map((w) => (
                  <tr key={w.outcome + w.plan}>
                    <td>
                      <span className={`badge badge-${admissionOutcomeBad(w.outcome) ? 'danger' : 'neutral'}`}>{admissionOutcomeLabel(w.outcome)}</span>
                    </td>
                    <td>{w.plan}</td>
                    <td>{formatCount(w.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="table-foot">{formatCount(t.admission_leaders_now)} app wakes waiting for a gateway-wide slot now.</div>
        </SectionCard>
        <SectionCard title="Status codes">
          {r.statuses.length === 0 ? (
            <Empty>No requests in the window.</Empty>
          ) : (
            <table className="dtable text-xs">
              <tbody>
                {r.statuses.map((s) => (
                  <tr key={s.code}>
                    <td className="font-mono">{s.code}</td>
                    <td>{formatCount(s.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard title="Edge gate rejections">
          {r.edge_rejections.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <table className="dtable text-xs">
              <tbody>
                {r.edge_rejections.map((e) => (
                  <tr key={e.kind + e.status}>
                    <td className="cell-primary">{e.kind}</td>
                    <td className="font-mono">{e.status}</td>
                    <td>{formatCount(e.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
        <ReasonCard title="Compute edge refusals" rows={r.edge_refusals} />
        <ReasonCard title="Retries given up" rows={r.retry_exhausted} />
      </div>
    </div>
  );
}

function ReasonCard({ title, rows }: { title: string; rows: ObsGatewayReasonCount[] }) {
  return (
    <SectionCard title={title}>
      {rows.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <table className="dtable text-xs">
          <tbody>
            {rows.map((x) => (
              <tr key={x.reason}>
                <td className="font-mono">{x.reason}</td>
                <td>{formatCount(x.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">{children}</div>;
}
