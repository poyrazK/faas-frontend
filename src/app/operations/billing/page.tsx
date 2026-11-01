'use client';

import React, { useState } from 'react';
import {
  ApiError,
  listPaddleCatalog,
  syncPaddleCatalog,
  resetPaddleCatalog,
  getPaddleOveragePreflight,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { isRealTimestamp } from '@/lib/operator';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';

export default function BillingCatalogPage() {
  const catalog = useAsync(listPaddleCatalog);
  const preflight = useAsync(getPaddleOveragePreflight, [], 30000);
  const [pending, setPending] = useState<'sync' | 'reset' | null>(null);

  const data = catalog.data;
  const unsupported = catalog.error instanceof ApiError && catalog.error.status === 501;
  const p = preflight.data;
  const schemaComplete = !!p && p.table_exists && p.has_window_start && p.has_state && p.has_claimed_at && p.has_claimed_by;

  return (
    <div>
      <PageHeader
        title="Billing catalog"
        subtitle="The provider products and prices the platform bills against."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setPending('sync')} disabled={unsupported} className="btn btn-primary btn-sm">
              <Icon name="refresh" size={14} />
              Sync from provider…
            </button>
            <button onClick={() => setPending('reset')} disabled={unsupported} className="btn btn-secondary btn-sm">
              <Icon name="trash" size={14} />
              Reset cache…
            </button>
          </div>
        }
      />

      <div className="mb-6">
        <SectionCard
          title="Overage dedupe preflight"
          action={
            <button onClick={() => preflight.reload()} className="btn btn-secondary btn-xs">
              <Icon name="refresh" size={12} />
              Re-check
            </button>
          }
        >
          {preflight.error && !p ? (
            <div role="alert" className="p-4 text-xs text-[var(--color-danger)]">
              Preflight failed: {preflight.error.message}
            </div>
          ) : !p ? (
            <div className="p-4 text-xs text-[var(--color-ink-muted)]">Checking the overage schema…</div>
          ) : (
            <div className="grid gap-3 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Dedupe table">
                <span className={`badge ${p.table_exists ? 'badge-success' : 'badge-warning'}`}>
                  {p.table_exists ? 'Present' : 'Missing'}
                </span>
              </Tile>
              <Tile label="Schema">
                <span className={`badge ${schemaComplete ? 'badge-success' : 'badge-warning'}`}>
                  {schemaComplete ? 'All columns present' : 'Migration incomplete'}
                </span>
              </Tile>
              <Tile label="Pending overage rows">
                <span className="font-mono text-sm font-bold">{p.pending_rows}</span>
              </Tile>
              <Tile label="Completed rows">
                <span className="font-mono text-sm font-bold">{p.completed_rows}</span>
              </Tile>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Provider catalog"
        action={
          data ? (
            <span className="text-xs text-[var(--color-ink-muted)]">
              {data.provider} · {isRealTimestamp(data.synced_at) ? `synced ${relativeTime(data.synced_at)}` : 'never synced'}
            </span>
          ) : undefined
        }
      >
        {unsupported ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            The active billing provider does not expose a catalog.
          </div>
        ) : catalog.error && !data ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
            Could not load the catalog: {catalog.error.message}
          </div>
        ) : !data ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading catalog…</div>
        ) : data.entries.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            No catalog entries yet. Sync from the provider to hydrate it.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Kind</th>
                  <th>Provider handle</th>
                  <th>Synced</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={`${entry.plan}:${entry.kind}:${entry.handle}`}>
                    <td>
                      <span className="badge badge-neutral uppercase">{entry.plan}</span>
                    </td>
                    <td className="font-mono">{entry.kind}</td>
                    <td className="cell-primary font-mono">{entry.handle}</td>
                    <td>{isRealTimestamp(entry.synced_at) ? relativeTime(entry.synced_at) : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {pending && (
        <OperatorActionDialog
          open
          title={pending === 'sync' ? 'Sync catalog from provider' : 'Reset catalog cache'}
          tone={pending === 'reset' ? 'danger' : 'warning'}
          reason="none"
          confirmText={pending === 'reset' ? 'reset' : undefined}
          submitLabel={pending === 'sync' ? 'Sync now' : 'Reset cache'}
          fingerprint={pending}
          impact={
            pending === 'sync'
              ? 'Re-reads product and price handles from the billing provider. New checkouts and invoices use the result.'
              : 'Clears every cached handle. Checkouts fail until the next successful sync, so only do this right before syncing.'
          }
          onClose={() => setPending(null)}
          onSubmit={async ({ idempotencyKey }) => {
            if (pending === 'sync') {
              const res = await syncPaddleCatalog({ idempotencyKey });
              catalog.reload();
              return `Catalog synced: ${res.entries.length} entr${res.entries.length === 1 ? 'y' : 'ies'}.`;
            }
            await resetPaddleCatalog({ idempotencyKey });
            catalog.reload();
            return 'Catalog cache cleared.';
          }}
        />
      )}
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-3">
      <div className="text-[var(--color-ink-muted)]">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
