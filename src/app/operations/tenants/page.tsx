'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  listObsTenants,
  getObsTenantDetail,
  getObsTenant360,
  getObsTenantActivity,
  getObsAppDetail,
  suspendObsAccount,
  restoreObsAccount,
  revokeObsAccountSessions,
  issueAccountCredit,
  refundAccount,
  reconcileAccount,
  forceColdBootApp,
  type ObsTenantRow,
  type ObsTenantDetailResponse,
  type ObsTenant360Response,
  type ObsTenantActivityResponse,
  type ObsAppDetailResponse,
  type ObsInvoiceSummary,
} from '@/lib/api';
import { formatCents, parseMoneyAmount, REASON_SUGGESTIONS } from '@/lib/operator';
import { PageHeader, Mono, SearchInput, FilterSelect } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { useOperatorIntents } from '@/components/operator/OperatorIntents';
import { AbuseHoldPanel, AccountFlagsPanel, ManagedPostgresPanel } from '@/components/operator/tenant';

const PAGE_SIZE = 100;

type TenantAction =
  | { type: 'suspend' | 'restore' | 'revoke-sessions' | 'credit' | 'reconcile' }
  | { type: 'refund'; invoice: ObsInvoiceSummary }
  | { type: 'cold-boot'; slug: string };

interface Inspection {
  tenantId: string;
  detail?: ObsTenantDetailResponse;
  tenant360?: ObsTenant360Response;
  activity?: ObsTenantActivityResponse;
  errors: string[];
}

export default function TenantsPage() {
  return (
    <Suspense>
      <TenantsDirectory />
    </Suspense>
  );
}

function TenantsDirectory() {
  const params = useSearchParams();
  const [includePii, setIncludePii] = useState(false);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const jumpQuery = params.get('q');

  // The header search navigates here with ?q=; follow later jumps too.
  useEffect(() => {
    if (jumpQuery !== null) queueMicrotask(() => setSearch(jumpQuery));
  }, [jumpQuery]);
  const [planFilter, setPlanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Directory: server-side plan/status filters, cursor pages appended on demand.
  const [rows, setRows] = useState<ObsTenantRow[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listNonce, setListNonce] = useState(0);
  const listSeq = useRef(0);

  const filters = {
    plan: planFilter === 'all' ? undefined : planFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
  };

  const loadPage = async (cursor: string | undefined, append: boolean) => {
    const seq = ++listSeq.current;
    setListLoading(true);
    setListError(null);
    try {
      const res = await listObsTenants(PAGE_SIZE, cursor, includePii, filters);
      if (seq !== listSeq.current) return;
      setRows((current) => (append ? [...current, ...res.items] : res.items));
      setNextCursor(res.next_cursor);
    } catch (err) {
      if (seq === listSeq.current) setListError((err as Error).message);
    } finally {
      if (seq === listSeq.current) setListLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => void loadPage(undefined, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includePii, planFilter, statusFilter, listNonce]);

  // Inspect panel: every response is checked against the tenant it was requested for.
  const inspectSeq = useRef(0);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [appDetail, setAppDetail] = useState<{ appId: string; data?: ObsAppDetailResponse; error?: string } | null>(null);
  const [action, setAction] = useState<TenantAction | null>(null);
  const [amount, setAmount] = useState('');
  const { track } = useOperatorIntents();

  const inspect = async (tenantId: string) => {
    const seq = ++inspectSeq.current;
    setInspectId(tenantId);
    setInspection(null);
    setAppDetail(null);
    const [detail, activity, tenant360] = await Promise.allSettled([
      getObsTenantDetail(tenantId, includePii),
      getObsTenantActivity(tenantId),
      getObsTenant360(tenantId, undefined, includePii),
    ]);
    if (seq !== inspectSeq.current) return;
    const errors: string[] = [];
    if (detail.status === 'rejected') errors.push(`Account: ${(detail.reason as Error).message}`);
    if (activity.status === 'rejected') errors.push(`Activity: ${(activity.reason as Error).message}`);
    if (tenant360.status === 'rejected') errors.push(`Usage & billing: ${(tenant360.reason as Error).message}`);
    setInspection({
      tenantId,
      detail: detail.status === 'fulfilled' ? detail.value : undefined,
      activity: activity.status === 'fulfilled' ? activity.value : undefined,
      tenant360: tenant360.status === 'fulfilled' ? tenant360.value : undefined,
      errors,
    });
  };

  // An exact account ID from the header search opens the tenant directly,
  // even when it is not on the loaded directory page.
  useEffect(() => {
    if (jumpQuery && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jumpQuery.trim())) {
      queueMicrotask(() => void inspect(jumpQuery.trim()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpQuery]);

  const openApp = async (appId: string) => {
    const seq = inspectSeq.current;
    setAppDetail({ appId });
    try {
      const data = await getObsAppDetail(appId);
      if (seq === inspectSeq.current) setAppDetail({ appId, data });
    } catch (err) {
      if (seq === inspectSeq.current) setAppDetail({ appId, error: (err as Error).message });
    }
  };

  const startAction = (next: TenantAction) => {
    setAmount(next.type === 'refund' ? ((next.invoice.amount_paid_cents || next.invoice.total_cents) / 100).toFixed(2) : '');
    setAction(next);
  };

  const view = inspection && inspection.tenantId === inspectId ? inspection : null;
  const detail = view?.detail;
  const t360 = view?.tenant360;
  const currency = t360?.billing.invoices[0]?.currency;
  const accountLabel = detail?.account.email || inspectId || '';

  const query = search.trim().toLowerCase();
  const visibleRows = query
    ? rows.filter(
        (t) =>
          t.account_id.toLowerCase().includes(query) ||
          t.email?.toLowerCase().includes(query) ||
          t.org_slug?.toLowerCase().includes(query),
      )
    : rows;

  return (
    <div>
      <PageHeader
        title="Tenants"
        subtitle="Find a customer account, inspect its apps, usage and billing, and act on it. Every action is audited."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIncludePii(!includePii)}
              className={`btn btn-sm ${includePii ? 'btn-warning' : 'btn-secondary'}`}
              title="Showing emails records a pii.accessed audit event"
            >
              <Icon name="shield" size={14} />
              {includePii ? 'Emails visible' : 'Emails hidden'}
            </button>
            <button onClick={() => setListNonce((n) => n + 1)} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />

      {includePii && (
        <div className="mb-4 rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
          <Icon name="shield" size={14} className="mr-1.5 inline" />
          Customer emails are visible. Each load is recorded as PII access in the audit log.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter loaded tenants by ID, email or org…"
          className="w-full sm:w-80"
        />
        <FilterSelect
          value={planFilter}
          onChange={setPlanFilter}
          options={[
            { value: 'all', label: 'All plans' },
            { value: 'free', label: 'Free' },
            { value: 'hobby', label: 'Hobby' },
            { value: 'pro', label: 'Pro' },
            { value: 'scale', label: 'Scale' },
          ]}
        />
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'past_due', label: 'Past due' },
            { value: 'suspended', label: 'Suspended' },
            { value: 'deleted_pending', label: 'Deletion pending' },
          ]}
        />
      </div>

      <SectionCard>
        {listError && rows.length === 0 ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
            Could not load tenants: {listError}
          </div>
        ) : listLoading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading tenants…</div>
        ) : visibleRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            {query && nextCursor ? 'No match among loaded tenants — load more to keep searching.' : 'No tenants match.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Email</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Apps / live</th>
                  <th>MFA</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((tenant) => (
                  <tr key={tenant.account_id}>
                    <td className="font-mono">
                      <Mono>{tenant.account_id.slice(0, 13)}…</Mono>
                      {tenant.org_slug && (
                        <div className="text-[11px] text-[var(--color-ink-muted)]">org: {tenant.org_slug}</div>
                      )}
                    </td>
                    <td>
                      {tenant.email ? (
                        <span className="cell-primary">{tenant.email}</span>
                      ) : (
                        <span className="italic text-[var(--color-ink-muted)]">hidden</span>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-neutral uppercase">{tenant.plan}</span>
                    </td>
                    <td>
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td>
                      <span className="font-semibold">{tenant.apps_count}</span> apps ·{' '}
                      <span className="font-semibold text-[var(--color-brand-bright)]">{tenant.deployments_live_count}</span> live
                    </td>
                    <td>{tenant.mfa_enrolled ? 'Enrolled' : <span className="text-[var(--color-ink-muted)]">Off</span>}</td>
                    <td>{relativeTime(tenant.created_at)}</td>
                    <td className="text-right">
                      <button onClick={() => inspect(tenant.account_id)} className="btn btn-secondary btn-xs">
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-foot">
          <span>
            {rows.length} loaded{query ? ` · ${visibleRows.length} match the filter` : ''}
            {listError && rows.length > 0 ? ` · last load failed: ${listError}` : ''}
          </span>
          {nextCursor && (
            <button
              className="btn btn-secondary btn-xs"
              disabled={listLoading}
              onClick={() => void loadPage(nextCursor, true)}
            >
              {listLoading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </SectionCard>

      <Modal open={inspectId !== null} onClose={() => setInspectId(null)} title={`Tenant ${accountLabel}`} width={900}>
        {!view ? (
          <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">Loading tenant…</div>
        ) : (
          <div className="space-y-6 text-sm">
            {view.errors.length > 0 && (
              <div role="alert" className="rounded-lg bg-[var(--color-danger-subtle)] p-3 text-xs text-[var(--color-danger)]">
                Some sections could not be loaded: {view.errors.join(' · ')}
              </div>
            )}

            {detail && (
              <>
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-surface-subtle)] p-4 text-xs sm:grid-cols-3">
                  <Fact label="Account ID" value={<Mono>{detail.account.account_id}</Mono>} />
                  <Fact label="Plan" value={<span className="uppercase">{detail.account.plan}</span>} />
                  <Fact label="Status" value={<StatusBadge status={detail.account.status} />} />
                  <Fact label="Email" value={detail.account.email || 'hidden'} />
                  <Fact label="MFA" value={detail.account.mfa_enrolled ? 'Enrolled' : 'Off'} />
                  <Fact
                    label="API keys / sessions"
                    value={`${detail.api_keys.active} keys (${detail.api_keys.revoked} revoked) · ${detail.sessions.active} sessions`}
                  />
                </div>

                <div className="flex flex-wrap gap-2 rounded-lg border border-[var(--color-line)] p-3">
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
                  <span className="mx-1 hidden w-px self-stretch bg-[var(--color-line)] sm:block" />
                  <Link href={`/deployments?account=${encodeURIComponent(detail.account.account_id)}`} className="btn btn-ghost btn-sm">
                    <Icon name="deployments" size={14} />
                    Deployments
                  </Link>
                  <Link href={`/jobs?account=${encodeURIComponent(detail.account.account_id)}`} className="btn btn-ghost btn-sm">
                    <Icon name="queues" size={14} />
                    Job runs
                  </Link>
                </div>
              </>
            )}

            {t360 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-[var(--color-ink-soft)]">Usage & billing · {t360.usage.month}</h4>
                  <span className="text-[11px] text-[var(--color-ink-muted)]">
                    {t360.usage.requests.toLocaleString()} requests · {t360.usage.cold_boots} cold boots
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Tile
                    label="RAM usage"
                    value={`${t360.usage.used_gb_hours.toFixed(2)} GB-h`}
                    sub={`of ${t360.usage.included_gb_hours} included`}
                  />
                  <Tile
                    label="Overage"
                    value={`${t360.usage.overage_gb_hours.toFixed(2)} GB-h`}
                    sub={`${formatCents(t360.usage.overage_cents, currency)} derived`}
                  />
                  <Tile
                    label="Active credits"
                    value={formatCents(t360.billing.active_credits_cents, currency)}
                    sub={
                      t360.billing.overage_cap_cents == null
                        ? 'No overage cap'
                        : `Cap ${formatCents(t360.billing.overage_cap_cents, currency)}`
                    }
                  />
                  <Tile
                    label="Overage this month"
                    value={formatCents(t360.billing.current_month_overage_cents, currency)}
                    sub={`${t360.usage.apps.length} app(s) with usage`}
                  />
                </div>
                {t360.billing.invoices.length > 0 && (
                  <div className="divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)]">
                    {t360.billing.invoices.slice(0, 6).map((invoice) => (
                      <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
                        <div>
                          <span className="font-semibold">{invoice.number || invoice.id.slice(0, 12)}</span>
                          <span className="ml-2 text-[var(--color-ink-muted)]">
                            {invoice.status} · {new Date(invoice.period_start).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold">{formatCents(invoice.total_cents, invoice.currency)}</span>
                          {['paid', 'partially_refunded'].includes(invoice.status.toLowerCase()) && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs"
                              onClick={() => startAction({ type: 'refund', invoice })}
                            >
                              Refund…
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {inspectId && (
              <div className="grid gap-4 lg:grid-cols-2">
                <AbuseHoldPanel accountId={inspectId} />
                <AccountFlagsPanel accountId={inspectId} />
              </div>
            )}

            {detail && (
              <section>
                <h4 className="mb-2 text-xs font-semibold text-[var(--color-ink-soft)]">Apps ({detail.apps.length})</h4>
                {detail.apps.length === 0 ? (
                  <div className="text-xs text-[var(--color-ink-muted)]">No apps.</div>
                ) : (
                  <div className="divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)]">
                    {detail.apps.map((app) => (
                      <div key={app.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                        <div>
                          <span className="font-semibold">{app.slug}</span>
                          <span className="ml-2 text-[var(--color-ink-muted)]">{app.deployments} deployments</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="badge badge-neutral">{app.status}</span>
                          <button onClick={() => openApp(app.id)} className="btn btn-secondary btn-xs">
                            Workload
                          </button>
                          <Link
                            href={`/deployments?account=${encodeURIComponent(detail.account.account_id)}&app=${encodeURIComponent(app.id)}&status=all`}
                            className="btn btn-secondary btn-xs"
                          >
                            Deployments
                          </Link>
                          <button
                            onClick={() => startAction({ type: 'cold-boot', slug: app.slug })}
                            className="btn btn-secondary btn-xs"
                          >
                            Force cold boot…
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {appDetail && (
              <section className="rounded-lg border border-[var(--color-brand-line)] p-4 text-xs">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="font-semibold text-[var(--color-ink-soft)]">App workload</h4>
                  <button onClick={() => setAppDetail(null)} className="btn btn-ghost btn-xs">
                    Close
                  </button>
                </div>
                {appDetail.error ? (
                  <div role="alert" className="text-[var(--color-danger)]">
                    Could not load app workload: {appDetail.error}
                  </div>
                ) : !appDetail.data ? (
                  <div className="text-[var(--color-ink-muted)]">Loading workload…</div>
                ) : (
                  <AppWorkload detail={appDetail.data} />
                )}
              </section>
            )}

            {inspectId && <ManagedPostgresPanel accountId={inspectId} />}

            {view.activity && (
              <section>
                <h4 className="mb-2 text-xs font-semibold text-[var(--color-ink-soft)]">Recent activity</h4>
                {view.activity.invocations.length === 0 && view.activity.audit_events.length === 0 ? (
                  <div className="text-xs text-[var(--color-ink-muted)]">No invocations or audit events recorded.</div>
                ) : (
                  <div className="grid gap-4 text-xs lg:grid-cols-2">
                    <div className="rounded-lg border border-[var(--color-line)]">
                      <div className="border-b border-[var(--color-line)] px-3 py-2 font-semibold">Invocations</div>
                      <div className="max-h-64 divide-y divide-[var(--color-line)] overflow-y-auto">
                        {view.activity.invocations.map((invocation) => (
                          <div key={invocation.id} className="px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">
                                {invocation.app_slug || `${invocation.app_id.slice(0, 8)}…`} · {invocation.method} {invocation.path}
                              </span>
                              <span
                                className={`badge ${invocation.state === 'completed' ? 'badge-success' : invocation.state === 'failed' ? 'badge-danger' : 'badge-neutral'}`}
                              >
                                {invocation.outcome || invocation.state}
                              </span>
                            </div>
                            <div className="mt-1 text-[var(--color-ink-muted)]">
                              {relativeTime(invocation.created_at)} · {invocation.source}
                              {invocation.last_error ? ` · ${invocation.last_error}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[var(--color-line)]">
                      <div className="border-b border-[var(--color-line)] px-3 py-2 font-semibold">Audit trail</div>
                      <div className="max-h-64 divide-y divide-[var(--color-line)] overflow-y-auto">
                        {view.activity.audit_events.map((event) => (
                          <div key={event.id} className="px-3 py-2">
                            <div className="font-medium">{event.kind}</div>
                            <div className="mt-1 text-[var(--color-ink-muted)]">
                              {relativeTime(event.at)}
                              {event.actor ? ` · ${event.actor}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {detail && detail.orgs.length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-semibold text-[var(--color-ink-soft)]">Organizations ({detail.orgs.length})</h4>
                <div className="divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)]">
                  {detail.orgs.map((org) => (
                    <div key={org.id} className="flex items-center justify-between p-3 text-xs">
                      <span className="font-semibold">{org.slug}</span>
                      <span className="badge badge-neutral uppercase">{org.role}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </Modal>

      {action && inspectId && (
        <TenantActionDialog
          action={action}
          tenantId={inspectId}
          accountLabel={accountLabel}
          currency={action.type === 'refund' ? action.invoice.currency : currency}
          amount={amount}
          setAmount={setAmount}
          onClose={() => setAction(null)}
          onDone={() => {
            void inspect(inspectId);
            setListNonce((n) => n + 1);
          }}
          trackColdBoot={(intentId, slug) => track({ intentId, kind: 'force_cold_boot', target: slug })}
        />
      )}
    </div>
  );
}

function TenantActionDialog({
  action,
  tenantId,
  accountLabel,
  currency,
  amount,
  setAmount,
  onClose,
  onDone,
  trackColdBoot,
}: {
  action: TenantAction;
  tenantId: string;
  accountLabel: string;
  currency?: string;
  amount: string;
  setAmount: (value: string) => void;
  onClose: () => void;
  onDone: () => void;
  trackColdBoot: (intentId: string, slug: string) => void;
}) {
  const cents = parseMoneyAmount(amount);
  const refundCap = action.type === 'refund' ? action.invoice.amount_paid_cents || action.invoice.total_cents : 0;
  const money = (value: number) => formatCents(value, currency);

  const common = { open: true, onClose };
  switch (action.type) {
    case 'suspend':
      return (
        <OperatorActionDialog
          {...common}
          title="Suspend account"
          tone="danger"
          reason="code"
          reasonSuggestions={REASON_SUGGESTIONS.account}
          confirmText={accountLabel}
          submitLabel="Suspend"
          fingerprint={`suspend|${tenantId}`}
          impact="Blocks sign-in and API access, revokes every dashboard session, and stops the account's apps from waking. Restorable."
          onSubmit={async ({ reason, idempotencyKey }) => {
            const res = await suspendObsAccount(tenantId, reason, { idempotencyKey });
            onDone();
            return `Account suspended; ${res.revoked_sessions} session(s) revoked.`;
          }}
        />
      );
    case 'restore':
      return (
        <OperatorActionDialog
          {...common}
          title="Restore account"
          reason="code"
          reasonSuggestions={REASON_SUGGESTIONS.account}
          submitLabel="Restore"
          fingerprint={`restore|${tenantId}`}
          impact="Re-enables sign-in, API access and app wakes for this account."
          onSubmit={async ({ reason, idempotencyKey }) => {
            await restoreObsAccount(tenantId, reason, { idempotencyKey });
            onDone();
            return 'Account restored.';
          }}
        />
      );
    case 'revoke-sessions':
      return (
        <OperatorActionDialog
          {...common}
          title="Revoke all sessions"
          tone="warning"
          reason="code"
          reasonSuggestions={REASON_SUGGESTIONS.account}
          submitLabel="Revoke sessions"
          fingerprint={`revoke|${tenantId}`}
          impact="Signs the customer out of every dashboard session. API keys keep working."
          onSubmit={async ({ reason, idempotencyKey }) => {
            const res = await revokeObsAccountSessions(tenantId, reason, { idempotencyKey });
            onDone();
            return `${res.revoked_sessions} session(s) revoked.`;
          }}
        />
      );
    case 'credit':
      return (
        <OperatorActionDialog
          {...common}
          title="Issue credit"
          tone="warning"
          reason="text"
          submitLabel={cents ? `Issue ${money(cents)}` : 'Issue credit'}
          canSubmit={cents !== null}
          fingerprint={`credit|${tenantId}|${cents}`}
          impact="Adds a credit the billing provider applies to this account's next invoices."
          onSubmit={async ({ reason, idempotencyKey }) => {
            if (cents === null) throw new Error('Enter an amount.');
            const res = await issueAccountCredit(tenantId, cents, reason, { idempotencyKey });
            onDone();
            return `Credit issued: ${money(cents)} (balance ${money(res.cents_remaining)}).`;
          }}
        >
          <AmountField amount={amount} setAmount={setAmount} currency={currency} invalid={amount !== '' && cents === null} />
        </OperatorActionDialog>
      );
    case 'refund':
      return (
        <OperatorActionDialog
          {...common}
          title={`Refund invoice ${action.invoice.number || action.invoice.id}`}
          tone="danger"
          reason="text"
          confirmText={action.invoice.number || action.invoice.id}
          submitLabel={cents ? `Refund ${money(cents)}` : 'Refund'}
          canSubmit={cents !== null && cents <= refundCap}
          fingerprint={`refund|${tenantId}|${action.invoice.id}|${cents}`}
          impact={
            <span>
              Sends a refund to the billing provider. This moves money and cannot be undone. Paid on this invoice:{' '}
              <strong>{money(refundCap)}</strong>; the provider rejects amounts above what is still refundable.
            </span>
          }
          onSubmit={async ({ reason, idempotencyKey }) => {
            if (cents === null) throw new Error('Enter an amount.');
            const res = await refundAccount(tenantId, action.invoice.id, cents, reason, { idempotencyKey });
            onDone();
            return `Refund ${res.status}: ${formatCents(res.amount_cents, res.currency)} (${res.provider_refund_id}).`;
          }}
        >
          <AmountField
            amount={amount}
            setAmount={setAmount}
            currency={currency}
            invalid={amount !== '' && (cents === null || cents > refundCap)}
            hint={`Up to ${money(refundCap)}`}
          />
        </OperatorActionDialog>
      );
    case 'reconcile':
      return (
        <OperatorActionDialog
          {...common}
          title="Reconcile usage"
          reason="none"
          submitLabel="Reconcile"
          fingerprint={`reconcile|${tenantId}`}
          impact="Recomputes this account's metered usage for the current billing period from raw meter rows."
          onSubmit={async ({ idempotencyKey }) => {
            const res = await reconcileAccount(tenantId, { idempotencyKey });
            onDone();
            return `Reconciled ${(res.mb_seconds / 3_600_000).toFixed(2)} GB-h for ${new Date(res.start).toLocaleDateString()} – ${new Date(res.end).toLocaleDateString()}.`;
          }}
        />
      );
    case 'cold-boot':
      return (
        <OperatorActionDialog
          {...common}
          title={`Force cold boot: ${action.slug}`}
          tone="warning"
          reason="code"
          reasonSuggestions={REASON_SUGGESTIONS.instance}
          submitLabel="Force cold boot"
          fingerprint={`cold-boot|${action.slug}`}
          impact="Marks this app's warm and init snapshots stale; every next wake cold boots. Use after a bad snapshot."
          onSubmit={async ({ reason, idempotencyKey }) => {
            const res = await forceColdBootApp(action.slug, reason, { idempotencyKey });
            trackColdBoot(res.intent_id, action.slug);
            return `Cold boot queued for ${action.slug}; follow it under Emergency Controls.`;
          }}
        />
      );
  }
}

function AmountField({
  amount,
  setAmount,
  currency,
  invalid,
  hint,
}: {
  amount: string;
  setAmount: (value: string) => void;
  currency?: string;
  invalid: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="label">Amount{currency ? ` (${currency.toUpperCase()})` : ''}</span>
      <input
        className="field field-sm font-mono"
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="10.00"
        autoComplete="off"
      />
      <span className={`mt-1 block text-xs ${invalid ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]'}`}>
        {invalid ? 'Enter a positive amount with at most two decimals' + (hint ? ` (${hint.toLowerCase()})` : '') + '.' : hint}
      </span>
    </label>
  );
}

function AppWorkload({ detail }: { detail: ObsAppDetailResponse }) {
  const m = detail.health.metrics;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="App" value={detail.app.slug} />
        <Fact label="Runtime" value={detail.app.runtime} />
        <Fact label="Max concurrency" value={detail.app.max_concurrency} />
        <Fact label="Instances" value={detail.instances.length} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label={`Requests (${m.range})`} value={m.request_count} />
        <Tile label="p95" value={`${m.latency_p95_ms.toFixed(0)} ms`} />
        <Tile label="Errors" value={`${m.error_rate_pct.toFixed(2)}%`} />
        <Tile label="Queue" value={m.queue_depth ?? 0} />
        <Tile label="Metrics source" value={m.source === 'prometheus' ? 'Prometheus' : 'Degraded'} />
      </div>
      {detail.health.errors.length > 0 && (
        <div className="overflow-x-auto rounded border border-[var(--color-line)]">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>Error</th>
                <th>Route</th>
                <th>Requests</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {detail.health.errors.map((error) => (
                <tr key={error.fingerprint}>
                  <td>
                    {error.error_class} ({error.http_status})
                  </td>
                  <td>{error.route}</td>
                  <td>{error.request_count}</td>
                  <td>{relativeTime(error.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="overflow-x-auto rounded border border-[var(--color-line)]">
        <table className="dtable text-xs">
          <thead>
            <tr>
              <th>Deployed</th>
              <th>Status</th>
              <th>Source</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {detail.deployments.map((deployment) => (
              <tr key={deployment.id}>
                <td>{relativeTime(deployment.created_at)}</td>
                <td>{deployment.status}</td>
                <td className="font-mono">{deployment.source_url || deployment.commit_sha || deployment.kind}</td>
                <td className="text-[var(--color-danger)]">{deployment.error_code || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'active' ? 'badge-success' : status === 'past_due' ? 'badge-warning' : 'badge-danger';
  return <span className={`badge ${tone}`}>{status.replace('_', ' ')}</span>;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[var(--color-ink-muted)]">{label}</div>
      <div className="mt-0.5 truncate font-semibold">{value}</div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] p-3">
      <div className="text-[11px] text-[var(--color-ink-muted)]">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-[var(--color-ink-muted)]">{sub}</div>}
    </div>
  );
}
