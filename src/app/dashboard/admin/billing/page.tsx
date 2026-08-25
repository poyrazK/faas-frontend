'use client';

import React, { useState } from 'react';
import {
  listPaddleCatalog,
  syncPaddleCatalog,
  resetPaddleCatalog,
  getPaddleOveragePreflight,
  type BillingCatalogEntry,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

export default function BillingCatalogPage() {
  const { data, loading, error, reload } = useAsync(listPaddleCatalog);
  const preflightQuery = useAsync(getPaddleOveragePreflight, [], 30000);
  const [syncing, setSyncing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setActionFeedback(null);
    try {
      await syncPaddleCatalog();
      setActionFeedback('Billing catalog synced with provider.');
      reload();
    } catch (err) {
      setActionFeedback(`Sync error: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Are you sure you want to reset the price catalog cache?')) return;
    setResetting(true);
    setActionFeedback(null);
    try {
      await resetPaddleCatalog();
      setActionFeedback('Catalog cache reset.');
      reload();
    } catch (err) {
      setActionFeedback(`Reset error: ${(err as Error).message}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Billing Catalog Operations"
        subtitle="Operator billing surface for managing provider price catalog items, sync plans, and overage schema preflight"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="btn btn-primary btn-sm"
            >
              <Icon name="refresh" size={14} />
              {syncing ? 'Syncing…' : 'Sync Provider Catalog'}
            </button>

            <button
              onClick={handleReset}
              disabled={resetting}
              className="btn btn-secondary btn-sm"
            >
              <Icon name="trash" size={14} />
              {resetting ? 'Resetting…' : 'Reset Catalog'}
            </button>
          </div>
        }
      />

      {actionFeedback && (
        <div className="mb-4 rounded-lg bg-[var(--color-surface-subtle)] p-3 text-xs text-[var(--color-ink)]">
          {actionFeedback}
        </div>
      )}

      {/* Overage Preflight Probe */}
      <div className="mb-6">
        <SectionCard
          title={
            <div className="flex items-center justify-between">
              <span>Paddle Overage Dedupe Schema & Preflight</span>
              <button onClick={() => preflightQuery.reload()} className="btn btn-secondary btn-xs">
                <Icon name="refresh" size={12} />
                Probe Schema
              </button>
            </div>
          }
        >
          {preflightQuery.loading && !preflightQuery.data ? (
            <div className="p-4 text-xs text-[var(--color-ink-muted)]">Probing overage schema status…</div>
          ) : preflightQuery.error ? (
            <div className="p-4 text-xs text-[var(--color-danger)]">
              {preflightQuery.error.message || 'Overage preflight probe failed.'}
            </div>
          ) : preflightQuery.data ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-3">
                <div className="text-[var(--color-ink-muted)]">Dedupe Table</div>
                <div className="font-semibold mt-1">
                  {preflightQuery.data.table_exists ? (
                    <span className="badge badge-success">Table Initialized</span>
                  ) : (
                    <span className="badge badge-warning">Missing</span>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-3">
                <div className="text-[var(--color-ink-muted)]">Schema Columns</div>
                <div className="font-semibold mt-1 font-mono text-[11px]">
                  {preflightQuery.data.has_window_start && preflightQuery.data.has_state && preflightQuery.data.has_claimed_by
                    ? 'All Required Columns Present'
                    : 'Partial Migration'}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-3">
                <div className="text-[var(--color-ink-muted)]">Pending Overage Rows</div>
                <div className="font-bold font-mono text-sm mt-1 text-[var(--color-brand-bright)]">
                  {preflightQuery.data.pending_rows}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-3">
                <div className="text-[var(--color-ink-muted)]">Completed Dedupe Rows</div>
                <div className="font-bold font-mono text-sm mt-1">
                  {preflightQuery.data.completed_rows}
                </div>
              </div>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard title="Provider Price Catalog">
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            Loading Catalog…
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-[var(--color-danger)]">
            {error.message || 'Operator access required to view billing catalog.'}
          </div>
        ) : !data?.items || data.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            No catalog items found. Click &quot;Sync Provider Catalog&quot; to synchronize.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">Price ID / Reference</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Interval</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {data.items.map((item: BillingCatalogEntry) => (
                  <tr key={item.id} className="hover:bg-[var(--color-surface-subtle)]">
                    <td className="px-4 py-3 font-mono font-semibold">{item.id}</td>
                    <td className="px-4 py-3 font-mono">{item.kind}</td>
                    <td className="px-4 py-3 uppercase">
                      {item.plan ? (
                        <span className="badge badge-neutral">{item.plan}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold font-mono">
                      ${(item.price_cents / 100).toFixed(2)} {item.currency.toUpperCase()}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ink-muted)]">
                      {item.interval || 'one-time'}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ink-muted)]">
                      {relativeTime(item.created_at)}
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
