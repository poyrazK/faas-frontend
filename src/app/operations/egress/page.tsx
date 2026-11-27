'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import {
  abuseSignalTotal,
  denialClassDetail,
  denialClassLabel,
  denialClassSevere,
  EGRESS_DEFAULT_WINDOW,
  EGRESS_WINDOWS,
  egressWindowLabel,
  flowLogHref,
  getEgress,
  isEgressWindow,
  type EgressWindow,
  type ObsEgressCount,
  type ObsEgressReport,
} from '@/lib/ops/egress';
import { formatCount } from '@/lib/ops/gatewayTraffic';
import { useAsync } from '@/lib/useAsync';
import { useUrlParams } from '@/lib/useUrlState';
import { appDeploymentsHref, nodeHref, tenantHref } from '@/lib/routes';
import { FilterSelect, PageHeader } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { EntityId } from '@/components/operator/EntityId';

/* ==========================================================================
   Egress denials (apid ADR-20261127100000): tenant egress the platform
   dropped, by class, node and app; new destinations; and the abuse signals
   (recycles, holds, CPU, blocked DNS, image scans, host denylist drops).
   ========================================================================== */

export default function EgressPage() {
  return (
    <Suspense>
      <Egress />
    </Suspense>
  );
}

function Egress() {
  const [params, update] = useUrlParams();
  const raw = params.get('window');
  const win = isEgressWindow(raw) ? raw : EGRESS_DEFAULT_WINDOW;
  const report = useAsync(() => getEgress(win), [win]);
  const r = report.data;
  return (
    <div>
      <PageHeader
        title="Egress denials"
        subtitle="Outbound tenant traffic the platform dropped, which apps it came from, and every abuse signal in the window."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              value={win}
              onChange={(v) => update({ window: v === EGRESS_DEFAULT_WINDOW ? null : v })}
              options={EGRESS_WINDOWS.map((w) => ({ value: w, label: `Last ${egressWindowLabel(w)}` }))}
            />
            <button onClick={report.reload} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />
      {report.loading && !r ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading egress…</div>
      ) : report.error && !r ? (
        <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
          {report.error.message || 'Could not load egress denials.'}
        </div>
      ) : r ? (
        <Report r={r} win={win} />
      ) : null}
    </div>
  );
}

function SourceNote({ r }: { r: ObsEgressReport }) {
  if (r.source === 'observed') return null;
  const text =
    r.source === 'not_configured'
      ? 'apid has no Prometheus configured, so there is no egress data.'
      : r.source === 'unavailable'
        ? 'Prometheus did not answer; no egress data could be read.'
        : `Some reads failed (${r.failed_queries.join(', ')}); their sections are empty.`;
  return (
    <div role="status" className="rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
      {text}
    </div>
  );
}

function ClassBadge({ c, count }: { c: string; count?: number }) {
  return (
    <span className={`badge badge-${denialClassSevere(c) ? 'danger' : 'neutral'}`} title={denialClassDetail(c)}>
      {denialClassLabel(c)}
      {count != null ? ` ${formatCount(count)}` : ''}
    </span>
  );
}

function AppLink({ id, slug }: { id: string; slug?: string }) {
  return (
    <Link href={appDeploymentsHref(id)} className="cell-primary hover:underline">
      {slug || id.slice(0, 8)}
    </Link>
  );
}

function Report({ r, win }: { r: ObsEgressReport; win: EgressWindow }) {
  const t = r.totals;
  const signals = abuseSignalTotal(t);
  return (
    <div className="space-y-4">
      <SourceNote r={r} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={`Denied, last ${egressWindowLabel(win)}`}
          value={formatCount(t.denied)}
          sub={`${formatCount(t.denied_last_hour)} in the last hour · ${formatCount(t.apps_denied)} apps`}
        />
        <StatTile label="New destinations" value={formatCount(t.new_destinations)} sub="first contact with an address" />
        <StatTile
          label="Abuse signals"
          value={formatCount(signals)}
          sub={`${formatCount(t.abuse_recycles)} recycles · ${formatCount(t.abuse_holds)} holds · ${formatCount(t.cpu_abuse_signals)} CPU`}
        />
        <StatTile
          label="Flow log rows"
          value={t.flow_log_rows != null ? formatCount(t.flow_log_rows) : '—'}
          sub="search one account's flows on Metering"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Denials by class">
          {r.classes.length === 0 ? (
            <Empty>No egress was denied in the window.</Empty>
          ) : (
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Denied</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {r.classes.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <ClassBadge c={c.key} />
                    </td>
                    <td>{formatCount(c.count)}</td>
                    <td className="text-[var(--color-ink-muted)]">{denialClassDetail(c.key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
        <SectionCard title="Denials by node">
          {r.nodes.length === 0 ? (
            <Empty>No egress was denied in the window.</Empty>
          ) : (
            <table className="dtable text-xs">
              <tbody>
                {r.nodes.map((n) => (
                  <tr key={n.key}>
                    <td>
                      <Link href={nodeHref(n.key)} className="cell-primary font-mono hover:underline">
                        {n.key}
                      </Link>
                    </td>
                    <td>{formatCount(n.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Apps">
        {r.apps.length === 0 ? (
          <Empty>No app was denied, reached new destinations or was recycled.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Account</th>
                  <th>Denied</th>
                  <th>Classes</th>
                  <th>New destinations</th>
                  <th>Abuse recycles</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.apps.map((a) => (
                  <tr key={a.app_id}>
                    <td>
                      <AppLink id={a.app_id} slug={a.app_slug} />
                    </td>
                    <td>{a.account_id ? <EntityId id={a.account_id} kind="account" /> : '—'}</td>
                    <td>{formatCount(a.denied)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {a.classes.map((c) => (
                          <ClassBadge key={c.key} c={c.key} count={c.count} />
                        ))}
                      </div>
                    </td>
                    <td>{formatCount(a.new_destinations)}</td>
                    <td>{a.abuse_recycles ? <span className="badge badge-danger">{formatCount(a.abuse_recycles)}</span> : '0'}</td>
                    <td>
                      {a.account_id && (
                        <Link href={flowLogHref(a.account_id)} className="underline">
                          Flow log
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-foot">Recycled apps first, then by denials. Destinations themselves are only in the flow log.</div>
      </SectionCard>

      <SectionCard title="Egress abuse recycles">
        {r.recycles.length === 0 ? (
          <Empty>schedd recycled no instance for egress abuse.</Empty>
        ) : (
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>App</th>
                <th>Account</th>
                <th>Reason</th>
                <th>Recycles</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.recycles.map((x) => (
                <tr key={x.app_id + x.reason}>
                  <td>
                    <AppLink id={x.app_id} slug={x.app_slug} />
                  </td>
                  <td>{x.account_id ? <EntityId id={x.account_id} kind="account" /> : '—'}</td>
                  <td className="font-mono">{x.reason}</td>
                  <td>{formatCount(x.count)}</td>
                  <td>
                    {x.account_id && (
                      <Link href={tenantHref(x.account_id)} className="underline">
                        Abuse hold
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CountCard title="Account abuse holds" rows={r.holds} empty="No account was held." />
        <SectionCard title="CPU abuse signals">
          {r.cpu_signals.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <table className="dtable text-xs">
              <tbody>
                {r.cpu_signals.map((x) => (
                  <tr key={x.plan + x.action}>
                    <td>{x.plan}</td>
                    <td className="font-mono">{x.action}</td>
                    <td>{formatCount(x.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
        <CountCard title="Blocked DNS lookups" rows={r.dns_blocked} empty="The guest resolver blocked nothing." />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Image scan findings">
          {r.scan_findings.length === 0 ? (
            <Empty>No image scan findings.</Empty>
          ) : (
            <table className="dtable text-xs">
              <tbody>
                {r.scan_findings.map((x) => (
                  <tr key={x.category + x.action}>
                    <td className="cell-primary">{x.category}</td>
                    <td>
                      <span className={`badge badge-${x.action === 'block' ? 'danger' : 'warning'}`}>{x.action}</span>
                    </td>
                    <td>{formatCount(x.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
        <SectionCard title="Host denylist drops">
          {r.denylist.length === 0 ? (
            <Empty>Nothing hit the host denylist.</Empty>
          ) : (
            <table className="dtable text-xs">
              <tbody>
                {r.denylist.map((x) => (
                  <tr key={x.source + x.cidr}>
                    <td className="font-mono">{x.cidr}</td>
                    <td>{x.source === 'image_pull' ? 'image pull' : 'tenant traffic'}</td>
                    <td>{formatCount(x.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function CountCard({ title, rows, empty }: { title: string; rows: ObsEgressCount[]; empty: string }) {
  return (
    <SectionCard title={title}>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <table className="dtable text-xs">
          <tbody>
            {rows.map((x) => (
              <tr key={x.key}>
                <td className="font-mono">{x.key}</td>
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
