'use client';

import React, { Suspense, use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getObsAppDetail, searchObsAuditLog, type ObsAppDetailResponse } from '@/lib/api';
import { DEFAULT_INCIDENT_FILTERS, listIncidents } from '@/lib/ops/incidents';
import { listOperatorDeployments, listOperatorJobRuns, deploymentStatusTone } from '@/lib/ops/workloads';
import {
  buildTimeline,
  groupByDay,
  TIMELINE_KIND_LABELS,
  type TimelineEntry,
  type TimelineKind,
  type TimelineSources,
} from '@/lib/ops/timeline';
import { formatCents, gbHours } from '@/lib/operator';
import { isAccountId, TENANT_TABS, tenantHref, type TenantTab } from '@/lib/routes';
import { relativeTime } from '@/lib/format';
import { Mono, CopyButton } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon, type IconName } from '@/components/ui/Icons';
import { useOperatorIntents } from '@/components/operator/OperatorIntents';
import {
  AbuseHoldPanel,
  AccountFlagsPanel,
  AppWorkload,
  initialActionAmount,
  ManagedPostgresPanel,
  TenantActionDialog,
  TenantFact,
  TenantStatusBadge,
  TenantTile,
  type TenantAction,
} from '@/components/operator/tenant';
import { useKeyed } from '@/components/operator/tenant/shared';
import { useTenant, type TenantData } from '@/components/operator/tenant/useTenant';

const TAB_LABELS: Record<TenantTab, { label: string; icon: IconName }> = {
  overview: { label: 'Overview', icon: 'overview' },
  apps: { label: 'Apps', icon: 'workflows' },
  deployments: { label: 'Deployments', icon: 'deployments' },
  jobs: { label: 'Job runs', icon: 'queues' },
  billing: { label: 'Usage & billing', icon: 'invoices' },
  flags: { label: 'Flags', icon: 'filter' },
  activity: { label: 'Activity', icon: 'clock' },
};

const isTab = (value: string | null): value is TenantTab => !!value && (TENANT_TABS as readonly string[]).includes(value);

/**
 * One customer, every operator capability: the page an operator lands on
 * from any account ID in the console. Each tab has its own URL so it can be
 * pasted into a ticket or an incident channel.
 */
export default function TenantWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <Workspace accountId={decodeURIComponent(id).trim()} />
    </Suspense>
  );
}

function Workspace({ accountId }: { accountId: string }) {
  const search = useSearchParams();
  const tabParam = search.get('tab');
  const tab: TenantTab = isTab(tabParam) ? tabParam : 'overview';
  const [includePii, setIncludePii] = useState(false);
  const tenant = useTenant(accountId, includePii);
  const { track } = useOperatorIntents();
  const [action, setAction] = useState<TenantAction | null>(null);
  const [amount, setAmount] = useState('');

  if (!isAccountId(accountId)) {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-lg font-semibold">Not an account ID</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          <Mono>{accountId}</Mono> is not a UUID. Search the tenant directory instead.
        </p>
        <Link href={`/tenants?q=${encodeURIComponent(accountId)}`} className="btn btn-secondary btn-sm mt-4">
          Search tenants
        </Link>
      </div>
    );
  }

  const data = tenant.data;
  const detail = data?.detail;
  const t360 = data?.tenant360;
  const currency = t360?.billing.invoices[0]?.currency;
  const accountLabel = detail?.account.email || accountId;
  const startAction = (next: TenantAction) => {
    setAmount(initialActionAmount(next));
    setAction(next);
  };
  const ctx: TabContext = { accountId, data, currency, startAction, includePii };

  return (
    <div>
      <div className="mb-2 text-xs">
        <Link href="/tenants" className="text-[var(--color-ink-muted)] hover:underline">
          ← Tenants
        </Link>
      </div>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {detail?.account.email || (includePii ? 'No email on file' : 'Customer account')}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
            <Mono>{accountId}</Mono>
            <CopyButton value={accountId} label="Copy ID" />
            {detail && (
              <>
                <span className="badge badge-neutral uppercase">{detail.account.plan}</span>
                <TenantStatusBadge status={detail.account.status} />
                <span className={`badge ${detail.account.mfa_enrolled ? 'badge-success' : 'badge-neutral'}`}>
                  MFA {detail.account.mfa_enrolled ? 'on' : 'off'}
                </span>
                {detail.account.org_slug && <span>org {detail.account.org_slug}</span>}
                <span>customer since {new Date(detail.account.created_at).toLocaleDateString()}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && (
            <span className="text-[11px] text-[var(--color-ink-muted)]" title={new Date(data.loadedAt).toLocaleString()}>
              Loaded {new Date(data.loadedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => setIncludePii(!includePii)}
            className={`btn btn-sm ${includePii ? 'btn-warning' : 'btn-secondary'}`}
            title="Showing the email records a pii.accessed audit event"
          >
            <Icon name="shield" size={14} />
            {includePii ? 'Email visible' : 'Show email'}
          </button>
          <button onClick={() => void tenant.reload()} className="btn btn-secondary btn-sm" disabled={tenant.loading}>
            <Icon name="refresh" size={14} />
            {tenant.loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      {detail && (
        <div className="mb-4 flex flex-wrap gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          {detail.account.status === 'suspended' ? (
            <button onClick={() => startAction({ type: 'restore' })} className="btn btn-secondary btn-sm">
              Restore account…
            </button>
          ) : (
            <button onClick={() => startAction({ type: 'suspend' })} className="btn btn-danger btn-sm">
              Suspend account…
            </button>
          )}
          <button onClick={() => startAction({ type: 'revoke-sessions' })} className="btn btn-secondary btn-sm">
            Revoke sessions…
          </button>
          <button onClick={() => startAction({ type: 'credit' })} className="btn btn-secondary btn-sm">
            <Icon name="plus" size={14} />
            Issue credit…
          </button>
          <button onClick={() => startAction({ type: 'reconcile' })} className="btn btn-secondary btn-sm">
            Reconcile usage…
          </button>
        </div>
      )}

      {data && data.errors.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg bg-[var(--color-danger-subtle)] p-3 text-xs text-[var(--color-danger)]">
          Some sections could not be loaded: {data.errors.map((e) => `${e.source}: ${e.message}`).join(' · ')}
        </div>
      )}

      <nav
        className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--color-line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Tenant sections"
      >
        {TENANT_TABS.map((key) => (
          <Link
            key={key}
            href={tenantHref(accountId, key)}
            scroll={false}
            aria-current={tab === key ? 'page' : undefined}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium ${
              tab === key
                ? 'border-[var(--color-brand)] text-[var(--color-ink)]'
                : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            <Icon name={TAB_LABELS[key].icon} size={14} />
            {TAB_LABELS[key].label}
          </Link>
        ))}
      </nav>

      {!data ? (
        <div className="card p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading customer…</div>
      ) : (
        <>
          {tab === 'overview' && <OverviewTab {...ctx} />}
          {tab === 'apps' && <AppsTab {...ctx} />}
          {tab === 'deployments' && <DeploymentsTab {...ctx} />}
          {tab === 'jobs' && <JobsTab {...ctx} />}
          {tab === 'billing' && <BillingTab {...ctx} />}
          {tab === 'flags' && <FlagsTab {...ctx} />}
          {tab === 'activity' && <ActivityTab {...ctx} />}
        </>
      )}

      {action && (
        <TenantActionDialog
          action={action}
          tenantId={accountId}
          accountLabel={accountLabel}
          currency={action.type === 'refund' ? action.invoice.currency : currency}
          amount={amount}
          setAmount={setAmount}
          onClose={() => setAction(null)}
          onDone={() => void tenant.reload()}
          trackColdBoot={(intentId, slug) => track({ intentId, kind: 'force_cold_boot', target: slug })}
        />
      )}
    </div>
  );
}

interface TabContext {
  accountId: string;
  data: TenantData | null;
  currency?: string;
  includePii: boolean;
  startAction: (action: TenantAction) => void;
}

/* ─────────────────────────────── Overview ──────────────────────────────── */

function OverviewTab({ accountId, data, currency }: TabContext) {
  const detail = data?.detail;
  const t360 = data?.tenant360;
  // Deployment and job lists are audited as operator views, so they load on
  // the tabs that show them and never poll.
  const attention = useKeyed(accountId, (id) => listOperatorDeployments({ accountId: id, limit: 10 }));
  const jobs = useKeyed(accountId, (id) => listOperatorJobRuns({ accountId: id, limit: 50 }));
  const incidents = useKeyed(accountId, () => listIncidents({ ...DEFAULT_INCIDENT_FILTERS, windowHours: 168, limit: 200 }));
  const myIncidents = incidents.data?.items.filter((item) => item.account_id === accountId) ?? [];
  const failed = attention.data?.deployments.filter((d) => d.status === 'failed') ?? [];
  const inFlight = attention.data?.deployments.filter((d) => d.status !== 'failed') ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TenantTile
          label="Apps"
          value={detail ? detail.apps.length : '—'}
          sub={detail ? `${detail.account.deployments_live_count} with a live deployment` : 'Account unavailable'}
        />
        <TenantTile
          label={`RAM usage · ${t360?.usage.month ?? 'this month'}`}
          value={t360 ? `${t360.usage.used_gb_hours.toFixed(1)} GB-h` : '—'}
          sub={t360 ? `of ${t360.usage.included_gb_hours} included` : 'Usage unavailable'}
        />
        <TenantTile
          label="Requests this month"
          value={t360 ? t360.usage.requests.toLocaleString() : '—'}
          sub={t360 ? `${t360.usage.cold_boots} cold boots` : 'Usage unavailable'}
        />
        <TenantTile
          label="Credits / overage"
          value={t360 ? formatCents(t360.billing.active_credits_cents, currency) : '—'}
          sub={t360 ? `${formatCents(t360.billing.current_month_overage_cents, currency)} overage this month` : 'Billing unavailable'}
        />
      </div>

      <SectionCard title="Needs attention">
        <div className="divide-y divide-[var(--color-line)] text-xs">
          <AttentionRow
            icon="deployments"
            label="Failed deployments"
            state={attention}
            count={failed.length}
            tone={failed.length ? 'danger' : 'ok'}
            href={tenantHref(accountId, 'deployments')}
            detail={failed[0] ? `${failed[0].app_slug}: ${failed[0].error_code ?? failed[0].status} (${relativeTime(failed[0].created_at)})` : undefined}
          />
          <AttentionRow
            icon="refresh"
            label="Deployments in flight"
            state={attention}
            count={inFlight.length}
            tone={inFlight.length ? 'warn' : 'ok'}
            href={tenantHref(accountId, 'deployments')}
          />
          <AttentionRow
            icon="queues"
            label="Active job runs"
            state={jobs}
            count={jobs.data?.runs.length ?? 0}
            tone={(jobs.data?.runs.some((r) => r.tasks_failed > 0) ? 'warn' : 'ok')}
            href={tenantHref(accountId, 'jobs')}
          />
          <AttentionRow
            icon="alerts"
            label="Incidents naming this account (7 days)"
            state={incidents}
            count={myIncidents.length}
            tone={myIncidents.length ? 'danger' : 'ok'}
            href="/incidents"
            detail={myIncidents[0]?.summary}
            note={incidents.data?.unavailable_sources.length ? `incomplete: ${incidents.data.unavailable_sources.join(', ')} unavailable` : undefined}
          />
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <AbuseHoldPanel accountId={accountId} />
        <SectionCard
          title="Latest activity"
          action={
            <Link href={tenantHref(accountId, 'activity')} className="btn btn-ghost btn-xs">
              Full timeline →
            </Link>
          }
        >
          <ActivityPreview accountId={accountId} data={data} />
        </SectionCard>
      </div>

      {detail && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-xs sm:grid-cols-4">
          <TenantFact label="API keys" value={`${detail.api_keys.active} active · ${detail.api_keys.revoked} revoked`} />
          <TenantFact label="Dashboard sessions" value={`${detail.sessions.active} active`} />
          <TenantFact label="Organizations" value={detail.orgs.map((o) => `${o.slug} (${o.role})`).join(', ') || 'none'} />
          <TenantFact label="Personal account" value={detail.account.is_personal ? 'yes' : 'no'} />
        </div>
      )}
    </div>
  );
}

function AttentionRow({
  icon,
  label,
  state,
  count,
  tone,
  href,
  detail,
  note,
}: {
  icon: IconName;
  label: string;
  state: { data: unknown; error: Error | null; loading: boolean };
  count: number;
  tone: 'ok' | 'warn' | 'danger';
  href: string;
  detail?: string;
  note?: string;
}) {
  const failed = !!state.error && !state.data;
  const badge = failed
    ? 'badge-neutral'
    : tone === 'danger'
      ? 'badge-danger'
      : tone === 'warn'
        ? 'badge-warning'
        : 'badge-success';
  return (
    <Link href={href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--color-surface-sunken)]">
      <span className="flex min-w-0 items-center gap-2">
        <Icon name={icon} size={14} className="shrink-0 text-[var(--color-ink-muted)]" />
        <span className="min-w-0">
          <span className="font-medium text-[var(--color-ink)]">{label}</span>
          {failed ? (
            <span className="block truncate text-[var(--color-danger)]">Unavailable: {state.error?.message}</span>
          ) : detail ? (
            <span className="block truncate text-[var(--color-ink-muted)]">{detail}</span>
          ) : null}
          {note && <span className="block truncate text-[var(--color-warning-bold)]">{note}</span>}
        </span>
      </span>
      <span className={`badge ${badge}`}>{failed ? 'unknown' : !state.data ? '…' : count}</span>
    </Link>
  );
}

function ActivityPreview({ accountId, data }: { accountId: string; data: TenantData | null }) {
  const entries = useMemo(
    () => buildTimeline(accountId, { accountEvents: data?.activity?.audit_events, invocations: data?.activity?.invocations }).slice(0, 8),
    [accountId, data],
  );
  if (!data?.activity) {
    return <div className="p-4 text-xs text-[var(--color-danger)]">Recent activity is unavailable.</div>;
  }
  if (entries.length === 0) return <div className="p-4 text-xs text-[var(--color-ink-muted)]">No recent activity.</div>;
  return <TimelineList entries={entries} compact />;
}

/* ──────────────────────────────── Apps ─────────────────────────────────── */

function AppsTab({ accountId, data, startAction }: TabContext) {
  const detail = data?.detail;
  const [open, setOpen] = useState<string | null>(null);
  const workload = useKeyed<ObsAppDetailResponse>(open, getObsAppDetail);

  if (!detail) return <Unavailable what="Apps" />;
  return (
    <div className="space-y-4">
      <SectionCard title={`Apps (${detail.apps.length})`}>
        {detail.apps.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">This customer has no apps.</div>
        ) : (
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>App</th>
                <th>Status</th>
                <th>Deployments</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {detail.apps.map((app) => (
                <tr key={app.id}>
                  <td className="cell-primary">{app.slug}</td>
                  <td>
                    <span className="badge badge-neutral">{app.status}</span>
                  </td>
                  <td>{app.deployments}</td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <button className="btn btn-secondary btn-xs" onClick={() => setOpen(open === app.id ? null : app.id)}>
                        {open === app.id ? 'Hide workload' : 'Workload'}
                      </button>
                      <Link
                        className="btn btn-secondary btn-xs"
                        href={`/deployments?${new URLSearchParams({ account: accountId, app: app.id, status: 'all' })}`}
                      >
                        Deployments
                      </Link>
                      <button className="btn btn-secondary btn-xs" onClick={() => startAction({ type: 'cold-boot', slug: app.slug })}>
                        Force cold boot…
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {open && (
        <SectionCard title={`Workload · ${detail.apps.find((a) => a.id === open)?.slug ?? open}`}>
          <div className="p-4 text-xs">
            {workload.error && !workload.data ? (
              <div role="alert" className="text-[var(--color-danger)]">
                Could not load the workload: {workload.error.message}
              </div>
            ) : !workload.data ? (
              <div className="text-[var(--color-ink-muted)]">Loading workload…</div>
            ) : (
              <AppWorkload detail={workload.data} />
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* ───────────────────────────── Deployments ─────────────────────────────── */

function DeploymentsTab({ accountId }: TabContext) {
  const list = useKeyed(accountId, (id) => listOperatorDeployments({ accountId: id, statuses: 'all', limit: 50 }));
  return (
    <SectionCard
      title="Recent deployments"
      action={
        <Link href={`/deployments?${new URLSearchParams({ account: accountId })}`} className="btn btn-secondary btn-xs">
          Open in Deployments
        </Link>
      }
    >
      {list.error && !list.data ? (
        <div role="alert" className="p-6 text-center text-xs text-[var(--color-danger)]">
          Could not load deployments: {list.error.message}
        </div>
      ) : !list.data ? (
        <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">Loading deployments…</div>
      ) : list.data.deployments.length === 0 ? (
        <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">No deployments.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>App</th>
                <th>Status</th>
                <th>Error</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.deployments.map((dep) => (
                <tr key={dep.id}>
                  <td className="cell-primary">{dep.app_slug}</td>
                  <td>
                    <span className={`badge ${deploymentStatusTone(dep.status)}`}>{dep.status}</span>
                  </td>
                  <td className="max-w-[28rem] truncate text-[var(--color-danger)]" title={dep.error}>
                    {dep.error_code ?? ''}
                  </td>
                  <td>{relativeTime(dep.created_at)}</td>
                  <td className="text-right">
                    <Link href={`/deployments?${new URLSearchParams({ deployment: dep.id })}`} className="btn btn-secondary btn-xs">
                      Inspect
                    </Link>
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

/* ──────────────────────────────── Jobs ─────────────────────────────────── */

function JobsTab({ accountId }: TabContext) {
  const runs = useKeyed(accountId, (id) => listOperatorJobRuns({ accountId: id, limit: 100 }));
  return (
    <SectionCard
      title="Active job runs"
      action={
        <Link href={`/jobs?${new URLSearchParams({ account: accountId })}`} className="btn btn-secondary btn-xs">
          Open in Job runs
        </Link>
      }
    >
      <p className="border-b border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-ink-muted)]">
        apid lists queued and running runs only; finished runs are not retained here.
      </p>
      {runs.error && !runs.data ? (
        <div role="alert" className="p-6 text-center text-xs text-[var(--color-danger)]">
          Could not load job runs: {runs.error.message}
        </div>
      ) : !runs.data ? (
        <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">Loading job runs…</div>
      ) : runs.data.runs.length === 0 ? (
        <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">No queued or running job runs.</div>
      ) : (
        <table className="dtable text-xs">
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Tasks</th>
              <th>Started</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.data.runs.map((run) => (
              <tr key={run.run_id}>
                <td className="cell-primary">{run.job_name}</td>
                <td>
                  <span className="badge badge-warning">{run.aggregate_status}</span>
                </td>
                <td>
                  {run.tasks_running} running · {run.tasks_succeeded} ok · {run.tasks_failed} failed / {run.tasks}
                </td>
                <td>{relativeTime(run.started_at ?? run.created_at)}</td>
                <td className="text-right">
                  <Link href={`/jobs?${new URLSearchParams({ run: run.run_id })}`} className="btn btn-secondary btn-xs">
                    Inspect
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────── Usage & billing ───────────────────────────── */

function BillingTab({ accountId, data, currency, startAction }: TabContext) {
  const t360 = data?.tenant360;
  return (
    <div className="space-y-5">
      {!t360 ? (
        <Unavailable what="Usage and billing" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TenantTile label="RAM usage" value={`${t360.usage.used_gb_hours.toFixed(2)} GB-h`} sub={`of ${t360.usage.included_gb_hours} included`} />
            <TenantTile
              label="Overage"
              value={`${t360.usage.overage_gb_hours.toFixed(2)} GB-h`}
              sub={`${formatCents(t360.usage.overage_cents, currency)} derived`}
            />
            <TenantTile
              label="Active credits"
              value={formatCents(t360.billing.active_credits_cents, currency)}
              sub={t360.billing.overage_cap_cents == null ? 'No overage cap' : `Cap ${formatCents(t360.billing.overage_cap_cents, currency)}`}
            />
            <TenantTile
              label="Egress / ingress"
              value={`${t360.usage.used_egress_gb.toFixed(2)} GB`}
              sub={`${t360.usage.used_ingress_gb.toFixed(2)} GB in · ${t360.usage.used_cpu_hours.toFixed(1)} CPU-h`}
            />
          </div>

          <SectionCard
            title={`Invoices`}
            action={
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-xs" onClick={() => startAction({ type: 'credit' })}>
                  Issue credit…
                </button>
                <button className="btn btn-secondary btn-xs" onClick={() => startAction({ type: 'reconcile' })}>
                  Reconcile usage…
                </button>
              </div>
            }
          >
            {t360.billing.invoices.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">No invoices yet.</div>
            ) : (
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {t360.billing.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="cell-primary font-mono">{invoice.number || invoice.id}</td>
                      <td>
                        {new Date(invoice.period_start).toLocaleDateString()} – {new Date(invoice.period_end).toLocaleDateString()}
                      </td>
                      <td>
                        <span className="badge badge-neutral">{invoice.status}</span>
                      </td>
                      <td>{formatCents(invoice.total_cents, invoice.currency)}</td>
                      <td>{formatCents(invoice.amount_paid_cents, invoice.currency)}</td>
                      <td className="text-right">
                        {['paid', 'partially_refunded'].includes(invoice.status.toLowerCase()) && (
                          <button className="btn btn-secondary btn-xs" onClick={() => startAction({ type: 'refund', invoice })}>
                            Refund…
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>

          {t360.usage.apps.length > 0 && (
            <SectionCard title={`Usage by app · ${t360.usage.month}`}>
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>App</th>
                    <th>GB-h</th>
                    <th>Requests</th>
                    <th>Egress</th>
                    <th>Cold boots</th>
                  </tr>
                </thead>
                <tbody>
                  {t360.usage.apps.map((app) => (
                    <tr key={app.app_id}>
                      <td className="cell-primary">{app.app_slug || app.app_id.slice(0, 12)}</td>
                      <td>{gbHours(app.mb_seconds).toFixed(2)}</td>
                      <td>{app.requests.toLocaleString()}</td>
                      <td>{((app.tx_bytes + app.net_tx_bytes) / 1024 ** 3).toFixed(3)} GB</td>
                      <td>{app.cold_boots}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          )}
        </>
      )}

      <ManagedPostgresPanel accountId={accountId} />
      <div className="text-xs text-[var(--color-ink-muted)]">
        Egress flows and managed Postgres repairs for this account:{' '}
        <Link className="underline" href={`/metering?${new URLSearchParams({ account: accountId })}`}>
          open Metering
        </Link>
        .
      </div>
    </div>
  );
}

/* ──────────────────────────────── Flags ────────────────────────────────── */

function FlagsTab({ accountId }: TabContext) {
  return (
    <div className="space-y-3">
      <AccountFlagsPanel accountId={accountId} />
      <p className="text-xs text-[var(--color-ink-muted)]">
        To test a flag at a different time or under one of the customer&apos;s orgs, use the{' '}
        <Link href="/flags" className="underline">
          decision explorer
        </Link>
        .
      </p>
    </div>
  );
}

/* ─────────────────────────────── Activity ──────────────────────────────── */

const ALL_KINDS: TimelineKind[] = ['operator', 'audit', 'deployment', 'incident', 'invocation'];

function ActivityTab({ accountId, data }: TabContext) {
  const operator = useKeyed(accountId, (id) => searchObsAuditLog({ target_account_id: id, operator_only: true, limit: 200 }));
  const deployments = useKeyed(accountId, (id) => listOperatorDeployments({ accountId: id, statuses: 'all', limit: 100 }));
  const incidents = useKeyed(accountId, () => listIncidents({ ...DEFAULT_INCIDENT_FILTERS, windowHours: 168, limit: 200 }));
  const [kinds, setKinds] = useState<Set<TimelineKind>>(new Set(ALL_KINDS));

  const sources: TimelineSources = {
    operatorActions: operator.data?.items,
    accountEvents: data?.activity?.audit_events,
    deployments: deployments.data?.deployments,
    incidents: incidents.data?.items,
    invocations: data?.activity?.invocations,
  };
  const entries = useMemo(
    () => buildTimeline(accountId, sources).filter((entry) => kinds.has(entry.kind)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountId, operator.data, deployments.data, incidents.data, data, kinds],
  );

  const missing = [
    operator.error && !operator.data ? `operator actions (${operator.error.message})` : null,
    deployments.error && !deployments.data ? `deployments (${deployments.error.message})` : null,
    incidents.error && !incidents.data ? `incidents (${incidents.error.message})` : null,
    !data?.activity ? 'account events and invocations' : null,
    incidents.data?.unavailable_sources.length ? `part of the incident inbox (${incidents.data.unavailable_sources.join(', ')})` : null,
  ].filter(Boolean);
  const loading = [operator, deployments, incidents].some((s) => s.loading && !s.data);

  return (
    <SectionCard
      title="Activity timeline"
      action={
        <div className="flex flex-wrap gap-1">
          {ALL_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={kinds.has(kind)}
              onClick={() =>
                setKinds((current) => {
                  const next = new Set(current);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  return next;
                })
              }
              className={`badge cursor-pointer ${kinds.has(kind) ? 'badge-brand' : 'badge-neutral opacity-60'}`}
            >
              {TIMELINE_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      }
    >
      {missing.length > 0 && (
        <div role="alert" className="border-b border-[var(--color-line)] bg-[var(--color-warning-subtle)] px-4 py-2 text-xs text-[var(--color-warning-bold)]">
          Incomplete — could not load {missing.join('; ')}.
        </div>
      )}
      <p className="border-b border-[var(--color-line)] px-4 py-2 text-[11px] text-[var(--color-ink-muted)]">
        Merged from operator actions on this account, the account&apos;s own events and invocations, its deployments, and
        incidents from the last 7 days that name it.
      </p>
      {loading && entries.length === 0 ? (
        <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">Loading activity…</div>
      ) : entries.length === 0 ? (
        <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">Nothing recorded for the selected kinds.</div>
      ) : (
        <div>
          {groupByDay(entries).map((group) => (
            <div key={group.day}>
              <div className="sticky top-14 z-10 bg-[var(--color-surface-sunken)] px-4 py-1.5 text-[11px] font-semibold text-[var(--color-ink-soft)]">
                {group.day}
              </div>
              <TimelineList entries={group.entries} />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

const KIND_ICON: Record<TimelineKind, IconName> = {
  operator: 'shield',
  audit: 'logs',
  deployment: 'deployments',
  incident: 'alerts',
  invocation: 'bolt',
};

const TONE_CLASS = {
  neutral: 'text-[var(--color-ink-muted)]',
  success: 'text-[var(--color-brand-bright)]',
  warning: 'text-[var(--color-warning)]',
  danger: 'text-[var(--color-danger)]',
} as const;

function TimelineList({ entries, compact = false }: { entries: TimelineEntry[]; compact?: boolean }) {
  return (
    <ol className="divide-y divide-[var(--color-line)]">
      {entries.map((entry) => {
        const body = (
          <div className="flex items-start gap-3 px-4 py-2.5 text-xs">
            <Icon name={KIND_ICON[entry.kind]} size={14} className={`mt-0.5 shrink-0 ${TONE_CLASS[entry.tone]}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-medium text-[var(--color-ink)]">{entry.title}</span>
                <span className="shrink-0 text-[11px] text-[var(--color-ink-muted)]" title={new Date(entry.at).toLocaleString()}>
                  {compact ? relativeTime(entry.at) : new Date(entry.at).toLocaleTimeString()}
                </span>
              </div>
              {!compact && (entry.detail || entry.actor) && (
                <div className="truncate text-[var(--color-ink-muted)]">
                  {[entry.actor, entry.detail].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          </div>
        );
        return (
          <li key={entry.key}>
            {entry.href ? (
              <Link href={entry.href} className="block hover:bg-[var(--color-surface-sunken)]">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Unavailable({ what }: { what: string }) {
  return (
    <div role="alert" className="card p-6 text-center text-xs text-[var(--color-danger)]">
      {what} could not be loaded for this account. Use Refresh to try again.
    </div>
  );
}
