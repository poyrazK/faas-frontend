'use client';

import React, { useState } from 'react';
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
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, SearchInput, FilterSelect } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

export default function TenantsPage() {
  const [includePii, setIncludePii] = useState(false);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('all');

  // Tenant detail modal
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<ObsTenantDetailResponse | null>(null);
  const [tenant360Data, setTenant360Data] = useState<ObsTenant360Response | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activityData, setActivityData] = useState<ObsTenantActivityResponse | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [appDetail, setAppDetail] = useState<ObsAppDetailResponse | null>(null);
  const [appDetailLoading, setAppDetailLoading] = useState(false);

  // Credit issue modal
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [creditAmountUsd, setCreditAmountUsd] = useState('10.00');
  const [creditReason, setCreditReason] = useState('Operator promotional credit');
  const [creditSubmitting, setCreditSubmitting] = useState(false);
  const [creditFeedback, setCreditFeedback] = useState<string | null>(null);

  // Refund state
  const [refundInvoice, setRefundInvoice] = useState<ObsInvoiceSummary | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('Operator refund');
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [refundFeedback, setRefundFeedback] = useState<string | null>(null);

  // Reconcile state
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [reconcileFeedback, setReconcileFeedback] = useState<string | null>(null);
  const [tenantAction, setTenantAction] = useState<string | null>(null);
  const [tenantFeedback, setTenantFeedback] = useState<string | null>(null);

  // Cold boot state
  const [coldBootingSlug, setColdBootingSlug] = useState<string | null>(null);
  const [coldBootFeedback, setColdBootFeedback] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(
    () => listObsTenants(200, undefined, includePii),
    [includePii],
  );

  const openInspectDrawer = async (tenantId: string) => {
    setSelectedTenantId(tenantId);
    setDetailLoading(true);
    setDetailData(null);
    setTenant360Data(null);
    setActivityData(null);
    setSelectedAppId(null);
    setAppDetail(null);
    try {
      const [res, activity, tenant360] = await Promise.all([
        getObsTenantDetail(tenantId, includePii),
        getObsTenantActivity(tenantId),
        getObsTenant360(tenantId, undefined, includePii),
      ]);
      setDetailData(res);
      setActivityData(activity);
      setTenant360Data(tenant360);
    } catch {
      /* fetch failed */
    } finally {
      setDetailLoading(false);
    }
  };

  const openAppDetail = async (appId: string) => {
    setSelectedAppId(appId);
    setAppDetailLoading(true);
    setAppDetail(null);
    try {
      setAppDetail(await getObsAppDetail(appId));
    } catch {
      /* fetch failed */
    } finally {
      setAppDetailLoading(false);
    }
  };

  const handleIssueCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenantId) return;
    setCreditSubmitting(true);
    setCreditFeedback(null);
    try {
      const cents = Math.round(parseFloat(creditAmountUsd) * 100);
      const res = await issueAccountCredit(selectedTenantId, cents, creditReason);
      setCreditFeedback(`Issued $${(res.cents_remaining / 100).toFixed(2)} credit to account.`);
      setTimeout(() => {
        setCreditModalOpen(false);
        setCreditFeedback(null);
      }, 1500);
    } catch (err) {
      setCreditFeedback(`Error issuing credit: ${(err as Error).message}`);
    } finally {
      setCreditSubmitting(false);
    }
  };

  const openRefundModal = (invoice: ObsInvoiceSummary) => {
    const paidCents = invoice.amount_paid_cents > 0 ? invoice.amount_paid_cents : invoice.total_cents;
    setRefundInvoice(invoice);
    setRefundAmount((paidCents / 100).toFixed(2));
    setRefundReason('Operator refund');
    setRefundFeedback(null);
  };

  const handleRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenantId || !refundInvoice) return;
    const amount = Number(refundAmount);
    const amountCents = Math.round(amount * 100);
    const paidCents = refundInvoice.amount_paid_cents > 0 ? refundInvoice.amount_paid_cents : refundInvoice.total_cents;
    if (!Number.isFinite(amount) || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > paidCents) {
      setRefundFeedback(`Enter an amount between 0.01 and ${(paidCents / 100).toFixed(2)} ${refundInvoice.currency}.`);
      return;
    }
    if (refundReason.trim().length < 3) {
      setRefundFeedback('Refund reason must be at least 3 characters.');
      return;
    }
    if (!window.confirm(`Refund ${(amountCents / 100).toFixed(2)} ${refundInvoice.currency} for invoice ${refundInvoice.number || refundInvoice.id}? This sends a money-moving request to the billing provider.`)) return;
    setRefundSubmitting(true);
    setRefundFeedback(null);
    try {
      const result = await refundAccount(selectedTenantId, refundInvoice.id, amountCents, refundReason.trim());
      const feedback = `Refund accepted: ${(result.amount_cents / 100).toFixed(2)} ${result.currency} · ${result.provider_refund_id}.`;
      setTenantFeedback(feedback);
      setRefundInvoice(null);
      await openInspectDrawer(selectedTenantId);
    } catch (err) {
      setRefundFeedback(`Refund failed: ${(err as Error).message}`);
    } finally {
      setRefundSubmitting(false);
    }
  };

  const handleReconcile = async (tenantId: string) => {
    setReconcilingId(tenantId);
    setReconcileFeedback(null);
    try {
      await reconcileAccount(tenantId);
      setReconcileFeedback(`Billing reconciled for tenant ${tenantId}`);
      setTimeout(() => setReconcileFeedback(null), 3000);
    } catch (err) {
      setReconcileFeedback(`Reconcile error: ${(err as Error).message}`);
    } finally {
      setReconcilingId(null);
    }
  };

  const handleTenantAction = async (action: 'suspend' | 'restore' | 'revoke-sessions') => {
    if (!selectedTenantId) return;
    const warning = action === 'suspend'
      ? 'Suspend this tenant and revoke all of its active dashboard sessions?'
      : action === 'revoke-sessions'
      ? 'Revoke all active dashboard sessions for this tenant?'
      : 'Restore this tenant account?';
    if (!window.confirm(warning)) return;
    setTenantAction(action);
    setTenantFeedback(null);
    try {
      const result = action === 'suspend'
        ? await suspendObsAccount(selectedTenantId)
        : action === 'restore'
        ? await restoreObsAccount(selectedTenantId)
        : await revokeObsAccountSessions(selectedTenantId);
      await openInspectDrawer(selectedTenantId);
      setTenantFeedback(`${result.action} completed; ${result.revoked_sessions} session(s) revoked.`);
      reload();
    } catch (err) {
      setTenantFeedback(`Tenant operation failed: ${(err as Error).message}`);
    } finally {
      setTenantAction(null);
    }
  };

  const handleForceColdBootApp = async (slug: string) => {
    setColdBootingSlug(slug);
    setColdBootFeedback(null);
    try {
      await forceColdBootApp(slug, 'operator_tenant_inspect_force_cold_boot');
      setColdBootFeedback(`Force cold-boot intent enqueued for app ${slug}. Snapshots invalidated.`);
      setTimeout(() => setColdBootFeedback(null), 4000);
    } catch (err) {
      setColdBootFeedback(`Cold boot error: ${(err as Error).message}`);
    } finally {
      setColdBootingSlug(null);
    }
  };

  const filteredItems = (data?.items || []).filter((t: ObsTenantRow) => {
    const matchSearch =
      t.account_id.toLowerCase().includes(search.toLowerCase()) ||
      (t.email && t.email.toLowerCase().includes(search.toLowerCase())) ||
      (t.org_slug && t.org_slug.toLowerCase().includes(search.toLowerCase()));

    const matchPlan = planFilter === 'all' || t.plan === planFilter;
    return matchSearch && matchPlan;
  });

  return (
    <div>
      <PageHeader
        title="Tenant Directory"
        subtitle="Platform account management, tenant inspect, credit issuance, and billing reconciliation"
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIncludePii(!includePii)}
              className={`btn btn-sm ${includePii ? 'btn-danger' : 'btn-secondary'}`}
              title="Toggling PII emits a pii.accessed audit row"
            >
              <Icon name="shield" size={14} />
              {includePii ? 'PII Unlocked (Emails Visible)' : 'PII Redacted'}
            </button>
            <button onClick={reload} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />

      {includePii && (
        <div className="mb-4 rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
          <Icon name="shield" size={14} className="mr-1.5 inline" />
          <strong>PII Opt-in Active:</strong> Customer email addresses are unredacted. Access is audited backend-side per ADR-091.
        </div>
      )}

      {reconcileFeedback && (
        <div className="mb-4 rounded-lg bg-[var(--color-surface-subtle)] p-3 text-xs text-[var(--color-ink-muted)]">
          {reconcileFeedback}
        </div>
      )}

      {/* Filters & Search */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search Account ID, email, or org slug…"
          className="w-full sm:w-72"
        />
        <FilterSelect
          value={planFilter}
          onChange={setPlanFilter}
          options={[
            { value: 'all', label: 'All Plans' },
            { value: 'free', label: 'Free' },
            { value: 'hobby', label: 'Hobby' },
            { value: 'pro', label: 'Pro' },
            { value: 'scale', label: 'Scale' },
          ]}
        />
      </div>

      {/* Directory Table */}
      <SectionCard>
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading Tenants…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-[var(--color-danger)]">
            {error.message || 'Operator access required to list tenants.'}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">No tenants found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">Account ID / Org</th>
                  <th className="px-4 py-3">Email (PII)</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Apps / Live</th>
                  <th className="px-4 py-3">MFA</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {filteredItems.map((tenant) => (
                  <tr key={tenant.account_id} className="hover:bg-[var(--color-surface-subtle)]">
                    <td className="px-4 py-3 font-mono">
                      <div>
                        <Mono>{tenant.account_id.slice(0, 13)}…</Mono>
                      </div>
                      {tenant.org_slug && (
                        <div className="text-[11px] text-[var(--color-ink-muted)]">
                          org: {tenant.org_slug}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {tenant.email ? (
                        <span className="font-medium text-[var(--color-ink)]">{tenant.email}</span>
                      ) : (
                        <span className="text-[var(--color-ink-muted)] font-mono italic">[Redacted]</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge badge-neutral uppercase">{tenant.plan}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`badge ${
                          tenant.status === 'active'
                            ? 'badge-success'
                            : tenant.status === 'past_due'
                            ? 'badge-warning'
                            : 'badge-danger'
                        }`}
                      >
                        {tenant.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{tenant.apps_count}</span> apps ·{' '}
                      <span className="text-[var(--color-brand-bright)] font-semibold">
                        {tenant.deployments_live_count}
                      </span>{' '}
                      live
                    </td>
                    <td className="px-4 py-3">
                      {tenant.mfa_enrolled ? (
                        <span className="text-[var(--color-brand-bright)] font-medium">Enrolled</span>
                      ) : (
                        <span className="text-[var(--color-ink-muted)]">Off</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ink-muted)]">
                      {relativeTime(tenant.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => openInspectDrawer(tenant.account_id)}
                          className="btn btn-secondary btn-xs"
                        >
                          Inspect
                        </button>
                        <button
                          onClick={() => handleReconcile(tenant.account_id)}
                          disabled={reconcilingId === tenant.account_id}
                          className="btn btn-secondary btn-xs"
                          title="Reconcile usage & billing"
                        >
                          {reconcilingId === tenant.account_id ? 'Reconciling…' : 'Reconcile'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Tenant Inspect Drawer / Modal */}
      {selectedTenantId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6">
            <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-3">
              <div>
                <h3 className="text-lg font-bold">Tenant Detail Inspect</h3>
                <Mono className="text-xs">{selectedTenantId}</Mono>
              </div>
              <button onClick={() => setSelectedTenantId(null)} className="btn-icon">
                <Icon name="x" size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
                Loading tenant breakdown…
              </div>
            ) : detailData ? (
              <div className="mt-4 space-y-6 text-sm">
                {/* Account Details */}
                <div className="grid grid-cols-2 gap-4 rounded-lg bg-[var(--color-surface-subtle)] p-4 text-xs">
                  <div>
                    <span className="text-[var(--color-ink-muted)]">Plan:</span>{' '}
                    <strong className="uppercase">{detailData.account.plan}</strong>
                  </div>
                  <div>
                    <span className="text-[var(--color-ink-muted)]">Status:</span>{' '}
                    <strong>{detailData.account.status}</strong>
                  </div>
                  <div>
                    <span className="text-[var(--color-ink-muted)]">Email:</span>{' '}
                    <strong>{detailData.account.email || '[Redacted]'}</strong>
                  </div>
                  <div>
                    <span className="text-[var(--color-ink-muted)]">MFA:</span>{' '}
                    <strong>{detailData.account.mfa_enrolled ? 'Enrolled' : 'Off'}</strong>
                  </div>
                  <div>
                    <span className="text-[var(--color-ink-muted)]">Active API Keys:</span>{' '}
                    <strong>{detailData.api_keys.active}</strong> ({detailData.api_keys.revoked} revoked)
                  </div>
                  <div>
                    <span className="text-[var(--color-ink-muted)]">Active Sessions:</span>{' '}
                    <strong>{detailData.sessions.active}</strong>
                  </div>
                </div>

                {tenant360Data && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                        Tenant 360 · {tenant360Data.usage.month}
                      </h4>
                      <span className="text-[11px] text-[var(--color-ink-muted)]">
                        {tenant360Data.usage.requests.toLocaleString()} requests
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-lg border border-[var(--color-line)] p-3">
                        <div className="text-[11px] text-[var(--color-ink-muted)]">RAM usage</div>
                        <div className="mt-1 font-semibold">{tenant360Data.usage.used_gb_hours.toFixed(2)} GB-h</div>
                        <div className="text-[10px] text-[var(--color-ink-muted)]">of {tenant360Data.usage.included_gb_hours} included</div>
                      </div>
                      <div className="rounded-lg border border-[var(--color-line)] p-3">
                        <div className="text-[11px] text-[var(--color-ink-muted)]">Overage</div>
                        <div className="mt-1 font-semibold">{tenant360Data.usage.overage_gb_hours.toFixed(2)} GB-h</div>
                        <div className="text-[10px] text-[var(--color-ink-muted)]">€{(tenant360Data.usage.overage_cents / 100).toFixed(2)} derived</div>
                      </div>
                      <div className="rounded-lg border border-[var(--color-line)] p-3">
                        <div className="text-[11px] text-[var(--color-ink-muted)]">Active credits</div>
                        <div className="mt-1 font-semibold">€{(tenant360Data.billing.active_credits_cents / 100).toFixed(2)}</div>
                        <div className="text-[10px] text-[var(--color-ink-muted)]">
                          {tenant360Data.billing.overage_cap_cents == null ? 'No overage cap' : `Cap €${(tenant360Data.billing.overage_cap_cents / 100).toFixed(2)}`}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--color-line)] p-3">
                        <div className="text-[11px] text-[var(--color-ink-muted)]">Current overage</div>
                        <div className="mt-1 font-semibold">€{(tenant360Data.billing.current_month_overage_cents / 100).toFixed(2)}</div>
                        <div className="text-[10px] text-[var(--color-ink-muted)]">{tenant360Data.usage.cold_boots} cold boots · {tenant360Data.usage.apps.length} usage apps</div>
                      </div>
                    </div>
                    {tenant360Data.usage.apps.length > 0 && (
                      <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] text-[var(--color-ink-muted)]">
                            <tr><th className="px-3 py-2">App</th><th className="px-3 py-2">GB-h</th><th className="px-3 py-2">Requests</th><th className="px-3 py-2">Egress</th><th className="px-3 py-2">Cold boots</th></tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-line)]">
                            {tenant360Data.usage.apps.map((app) => (
                              <tr key={app.app_id}>
                                <td className="px-3 py-2 font-semibold">{app.app_slug || app.app_id.slice(0, 12)}</td>
                                <td className="px-3 py-2">{(app.mb_seconds / 3600000).toFixed(2)}</td>
                                <td className="px-3 py-2">{app.requests.toLocaleString()}</td>
                                <td className="px-3 py-2">{((app.tx_bytes + app.net_tx_bytes) / (1024 ** 3)).toFixed(3)} GB</td>
                                <td className="px-3 py-2">{app.cold_boots}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {tenant360Data.billing.invoices.length > 0 && (
                      <div>
                        <div className="mb-2 text-xs font-semibold text-[var(--color-ink-muted)]">Recent invoices</div>
                        <div className="divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)]">
                          {tenant360Data.billing.invoices.slice(0, 5).map((invoice) => (
                            <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
                              <div>
                                <span className="font-semibold">{invoice.number || invoice.id.slice(0, 12)}</span>
                                <span className="ml-2 text-[var(--color-ink-muted)]">{invoice.status} · {invoice.currency}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="font-semibold">{(invoice.total_cents / 100).toFixed(2)}</span>
                                {['paid', 'partially_refunded'].includes(invoice.status.toLowerCase()) && (
                                  <button type="button" className="btn btn-danger btn-xs" onClick={() => openRefundModal(invoice)}>
                                    Refund
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {tenantFeedback && (
                  <div className="rounded bg-[var(--color-surface-subtle)] p-3 text-xs text-[var(--color-ink-muted)]">
                    {tenantFeedback}
                  </div>
                )}

                {/* Operator Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-line)] p-4">
                  <div>
                    <div className="font-semibold text-xs">Tenant Operations</div>
                    <div className="text-xs text-[var(--color-ink-muted)]">
                      Lifecycle, session security, and billing actions are audited.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detailData.account.status === 'suspended' ? (
                      <button onClick={() => handleTenantAction('restore')} disabled={tenantAction !== null} className="btn btn-secondary btn-sm">
                        {tenantAction === 'restore' ? 'Restoring…' : 'Restore Account'}
                      </button>
                    ) : (
                      <button onClick={() => handleTenantAction('suspend')} disabled={tenantAction !== null} className="btn btn-danger btn-sm">
                        {tenantAction === 'suspend' ? 'Suspending…' : 'Suspend Account'}
                      </button>
                    )}
                    <button onClick={() => handleTenantAction('revoke-sessions')} disabled={tenantAction !== null} className="btn btn-secondary btn-sm">
                      {tenantAction === 'revoke-sessions' ? 'Revoking…' : 'Revoke Sessions'}
                    </button>
                    <button
                      onClick={() => {
                        setCreditModalOpen(true);
                        setCreditFeedback(null);
                      }}
                      className="btn btn-secondary btn-sm"
                    >
                      <Icon name="plus" size={14} />
                      Issue Credit
                    </button>
                  </div>
                </div>

                {/* Tenant Apps */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-semibold text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                      Deployed Applications ({detailData.apps.length})
                    </h4>
                  </div>

                  {coldBootFeedback && (
                    <div className="mb-2 rounded bg-[var(--color-surface-subtle)] p-2 text-xs text-[var(--color-brand-bright)]">
                      {coldBootFeedback}
                    </div>
                  )}

                  {detailData.apps.length === 0 ? (
                    <div className="text-xs text-[var(--color-ink-muted)]">No applications created.</div>
                  ) : (
                    <div className="divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)]">
                      {detailData.apps.map((app) => (
                        <div key={app.id} className="flex items-center justify-between p-3 text-xs">
                          <div>
                            <span className="font-semibold">{app.slug}</span>
                            <span className="ml-2 text-[var(--color-ink-muted)]">({app.deployments} builds)</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="badge badge-neutral">{app.status}</span>
                            <button
                              onClick={() => openAppDetail(app.id)}
                              className="btn btn-secondary btn-xs"
                            >
                              Inspect Workload
                            </button>
                            <button
                              onClick={() => handleForceColdBootApp(app.slug)}
                              disabled={coldBootingSlug === app.slug}
                              className="btn btn-secondary btn-xs"
                              title="Invalidate snapshots & force cold boot next wake"
                            >
                              {coldBootingSlug === app.slug ? 'Invalidating…' : 'Force Cold Boot'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Customer activity */}
                <div>
                  <h4 className="mb-2 font-semibold text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                    Recent Customer Activity
                  </h4>
                  {activityData && activityData.invocations.length === 0 && activityData.audit_events.length === 0 ? (
                    <div className="text-xs text-[var(--color-ink-muted)]">No invocation or audit activity recorded.</div>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-lg border border-[var(--color-line)]">
                        <div className="border-b border-[var(--color-line)] px-3 py-2 font-semibold">Invocations</div>
                        <div className="max-h-64 overflow-y-auto divide-y divide-[var(--color-line)]">
                          {(activityData?.invocations || []).map((invocation) => (
                            <div key={invocation.id} className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{invocation.app_slug || invocation.app_id.slice(0, 13) + '…'} · {invocation.method} {invocation.path}</span>
                                <span className={`badge ${invocation.state === 'completed' ? 'badge-success' : invocation.state === 'failed' ? 'badge-danger' : 'badge-neutral'}`}>{invocation.outcome || invocation.state}</span>
                              </div>
                              <div className="mt-1 text-[var(--color-ink-muted)]">{relativeTime(invocation.created_at)} · {invocation.source}{invocation.last_error ? ` · ${invocation.last_error}` : ''}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--color-line)]">
                        <div className="border-b border-[var(--color-line)] px-3 py-2 font-semibold">Audit trail</div>
                        <div className="max-h-64 overflow-y-auto divide-y divide-[var(--color-line)]">
                          {(activityData?.audit_events || []).map((event) => (
                            <div key={event.id} className="px-3 py-2">
                              <div className="font-medium">{event.kind}</div>
                              <div className="mt-1 text-[var(--color-ink-muted)]">{relativeTime(event.at)}{event.actor ? ` · ${event.actor}` : ''}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Selected app workload */}
                {selectedAppId && (
                  <div className="rounded-lg border border-[var(--color-brand-bright)]/30 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="font-semibold text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">App Workload Detail</h4>
                      <button onClick={() => setSelectedAppId(null)} className="btn btn-secondary btn-xs">Close</button>
                    </div>
                    {appDetailLoading ? <div className="py-4 text-center text-xs text-[var(--color-ink-muted)]">Loading workload…</div> : appDetail ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                          <div><span className="text-[var(--color-ink-muted)]">App</span><div className="font-semibold">{appDetail.app.slug}</div></div>
                          <div><span className="text-[var(--color-ink-muted)]">Runtime</span><div className="font-semibold">{appDetail.app.runtime}</div></div>
                          <div><span className="text-[var(--color-ink-muted)]">Concurrency</span><div className="font-semibold">{appDetail.app.max_concurrency}</div></div>
                          <div><span className="text-[var(--color-ink-muted)]">Instances</span><div className="font-semibold">{appDetail.instances.length}</div></div>
                        </div>
                        <div>
                          <div className="mb-2 font-semibold">Health ({appDetail.health.metrics.range})</div>
                          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                            <div className="rounded bg-[var(--color-surface-subtle)] p-2"><span className="text-[var(--color-ink-muted)]">Requests</span><div className="font-semibold">{appDetail.health.metrics.request_count}</div></div>
                            <div className="rounded bg-[var(--color-surface-subtle)] p-2"><span className="text-[var(--color-ink-muted)]">p95</span><div className="font-semibold">{appDetail.health.metrics.latency_p95_ms.toFixed(0)} ms</div></div>
                            <div className="rounded bg-[var(--color-surface-subtle)] p-2"><span className="text-[var(--color-ink-muted)]">Errors</span><div className="font-semibold">{appDetail.health.metrics.error_rate_pct.toFixed(2)}%</div></div>
                            <div className="rounded bg-[var(--color-surface-subtle)] p-2"><span className="text-[var(--color-ink-muted)]">Queue</span><div className="font-semibold">{appDetail.health.metrics.queue_depth ?? 0}</div></div>
                            <div className="rounded bg-[var(--color-surface-subtle)] p-2"><span className="text-[var(--color-ink-muted)]">Source</span><div className="truncate font-semibold" title={appDetail.health.metrics.source}>{appDetail.health.metrics.source === 'prometheus' ? 'Prometheus' : 'Degraded'}</div></div>
                          </div>
                          {appDetail.health.errors.length > 0 && (
                            <div className="mt-3 overflow-x-auto rounded border border-[var(--color-line)]"><table className="w-full text-left text-xs"><thead className="border-b border-[var(--color-line)]"><tr><th className="px-2 py-1.5">Error</th><th className="px-2 py-1.5">Route</th><th className="px-2 py-1.5">Requests</th><th className="px-2 py-1.5">Last seen</th></tr></thead><tbody className="divide-y divide-[var(--color-line)]">{appDetail.health.errors.map((error) => <tr key={error.fingerprint}><td className="px-2 py-1.5">{error.error_class} ({error.http_status})</td><td className="px-2 py-1.5">{error.route}</td><td className="px-2 py-1.5">{error.request_count}</td><td className="px-2 py-1.5">{relativeTime(error.last_seen_at)}</td></tr>)}</tbody></table></div>
                          )}
                        </div>
                        <div>
                          <div className="mb-1 font-semibold">Deployments ({appDetail.deployments.length})</div>
                          <div className="overflow-x-auto rounded border border-[var(--color-line)]"><table className="w-full text-left text-xs"><thead className="border-b border-[var(--color-line)]"><tr><th className="px-2 py-1.5">Created</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5">Source</th><th className="px-2 py-1.5">Error</th></tr></thead><tbody className="divide-y divide-[var(--color-line)]">{appDetail.deployments.map((deployment) => <tr key={deployment.id}><td className="px-2 py-1.5">{relativeTime(deployment.created_at)}</td><td className="px-2 py-1.5">{deployment.status}</td><td className="px-2 py-1.5">{deployment.source_url || deployment.commit_sha || deployment.kind}</td><td className="px-2 py-1.5 text-[var(--color-danger)]">{deployment.error_code || '—'}</td></tr>)}</tbody></table></div>
                        </div>
                        <div>
                          <div className="mb-1 font-semibold">Instances & recent invocations</div>
                          <div className="text-[var(--color-ink-muted)]">{appDetail.instances.filter((instance) => ['RUNNING', 'WAKING', 'COLD_BOOTING'].includes(instance.state)).length} live instance(s), {appDetail.invocations.length} recent invocation(s).</div>
                        </div>
                      </div>
                    ) : <div className="text-xs text-[var(--color-danger)]">Could not fetch app workload detail.</div>}
                  </div>
                )}

                {/* Tenant Organizations */}
                {detailData.orgs.length > 0 && (
                  <div>
                    <h4 className="mb-2 font-semibold text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                      Organizations ({detailData.orgs.length})
                    </h4>
                    <div className="divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)]">
                      {detailData.orgs.map((org) => (
                        <div key={org.id} className="flex items-center justify-between p-3 text-xs">
                          <span className="font-semibold">{org.slug}</span>
                          <span className="badge badge-neutral uppercase">{org.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-[var(--color-danger)]">
                Could not fetch details for tenant.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {refundInvoice && selectedTenantId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-md p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold">Refund invoice</h3>
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  {refundInvoice.number || refundInvoice.id} · {refundInvoice.currency}
                </p>
              </div>
              <button type="button" onClick={() => setRefundInvoice(null)} className="btn-icon" aria-label="Close refund dialog">
                <Icon name="x" size={18} />
              </button>
            </div>
            <form onSubmit={handleRefund} className="mt-5 space-y-4">
              <label className="block text-xs">
                <span className="font-semibold">Amount ({refundInvoice.currency})</span>
                <input
                  type="number"
                  min="0.01"
                  max={((refundInvoice.amount_paid_cents || refundInvoice.total_cents) / 100).toFixed(2)}
                  step="0.01"
                  required
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                  className="field field-sm mt-1 w-full font-mono"
                />
              </label>
              <label className="block text-xs">
                <span className="font-semibold">Reason</span>
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                  className="field mt-1 min-h-20 w-full"
                />
              </label>
              {refundFeedback && (
                <div className={`rounded p-3 text-xs ${refundFeedback.startsWith('Refund accepted') ? 'bg-[var(--color-surface-subtle)] text-[var(--color-brand-bright)]' : 'bg-[var(--color-danger-subtle)] text-[var(--color-danger)]'}`}>
                  {refundFeedback}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefundInvoice(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-danger btn-sm" disabled={refundSubmitting}>
                  {refundSubmitting ? 'Submitting…' : 'Confirm refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credit Issuance Modal */}
      {creditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-3">
              <h3 className="text-base font-bold">Issue Account Credit</h3>
              <button onClick={() => setCreditModalOpen(false)} className="btn-icon">
                <Icon name="x" size={16} />
              </button>
            </div>

            <form onSubmit={handleIssueCredit} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="mb-1 block font-medium">Credit Amount ($ USD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={creditAmountUsd}
                  onChange={(e) => setCreditAmountUsd(e.target.value)}
                  className="field field-sm w-full"
                  placeholder="10.00"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium">Reason / Reference</label>
                <input
                  type="text"
                  required
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  className="field field-sm w-full"
                  placeholder="Operator promo credit"
                />
              </div>

              {creditFeedback && (
                <div className="rounded p-2 text-xs bg-[var(--color-surface-subtle)] text-[var(--color-ink)]">
                  {creditFeedback}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreditModalOpen(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" disabled={creditSubmitting} className="btn btn-primary btn-sm">
                  {creditSubmitting ? 'Issuing…' : 'Confirm Issue Credit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
