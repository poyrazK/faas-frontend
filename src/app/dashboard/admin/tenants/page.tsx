'use client';

import React, { useState } from 'react';
import {
  listObsTenants,
  getObsTenantDetail,
  issueAccountCredit,
  reconcileAccount,
  forceColdBootApp,
  type ObsTenantRow,
  type ObsTenantDetailResponse,
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
  const [detailLoading, setDetailLoading] = useState(false);

  // Credit issue modal
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [creditAmountUsd, setCreditAmountUsd] = useState('10.00');
  const [creditReason, setCreditReason] = useState('Operator promotional credit');
  const [creditSubmitting, setCreditSubmitting] = useState(false);
  const [creditFeedback, setCreditFeedback] = useState<string | null>(null);

  // Reconcile state
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [reconcileFeedback, setReconcileFeedback] = useState<string | null>(null);

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
    try {
      const res = await getObsTenantDetail(tenantId, includePii);
      setDetailData(res);
    } catch {
      /* fetch failed */
    } finally {
      setDetailLoading(false);
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

                {/* Operator Actions */}
                <div className="flex items-center justify-between rounded-lg border border-[var(--color-line)] p-4">
                  <div>
                    <div className="font-semibold text-xs">Issue Account Credit</div>
                    <div className="text-xs text-[var(--color-ink-muted)]">
                      Apply promotional or refund credits to tenant account balance.
                    </div>
                  </div>
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
