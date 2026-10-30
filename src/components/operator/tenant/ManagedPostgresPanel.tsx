'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCOUNTING_REASON_LABELS,
  formatByteSeconds,
  formatMillicents,
  formatUnitSeconds,
  getManagedPostgresAccounting,
  getManagedPostgresUsage,
  MANAGED_POSTGRES_UNAVAILABLE_CODES,
  type ManagedPostgresAccountingDiagnostic,
  type ManagedPostgresAccountingDiagnosticsResponse,
  type ManagedPostgresUsageOperatorResponse,
} from '@/lib/ops/metering';
import { formatBytes } from '@/lib/operator';
import { relativeTime } from '@/lib/format';
import { Mono } from '@/components/ui/bits';
import { Fact, Notice, PanelSection, RefreshButton, StaleNotice, apiErrorCode, formatDateTime, useKeyed } from './shared';

export interface ManagedPostgresSelection {
  database: ManagedPostgresAccountingDiagnostic;
  action: 'import' | 'reconcile';
  /** The usage policy window every imported window must span. */
  windowSeconds: number;
}

/**
 * Managed PostgreSQL usage against the account's effective ceilings, internal
 * cost line items, and per-database accounting diagnostics. Read-only; the
 * Metering page passes `onSelectDatabase` to start a repair from a row.
 */
export function ManagedPostgresPanel({
  accountId,
  onSelectDatabase,
}: {
  accountId: string;
  onSelectDatabase?: (selection: ManagedPostgresSelection) => void;
}) {
  const usage = useKeyed(accountId, getManagedPostgresUsage);
  const { view: diagnostics, load } = useAccountingPages(accountId);

  const unavailable = [usage.error, diagnostics?.error].find((err) =>
    MANAGED_POSTGRES_UNAVAILABLE_CODES.includes(apiErrorCode(err) ?? ''),
  );

  return (
    <PanelSection
      title="Managed PostgreSQL"
      actions={
        <RefreshButton
          onClick={() => {
            usage.reload();
            void load();
          }}
        />
      }
    >
      {unavailable && !usage.data && !diagnostics?.head ? (
        <Notice>
          {apiErrorCode(unavailable) === 'managed_postgres_plan_unknown'
            ? 'This account is on a plan Managed PostgreSQL does not know, so no usage can be computed.'
            : `Managed PostgreSQL is unavailable: ${unavailable instanceof Error ? unavailable.message : 'not configured or the provider is down'}.`}
        </Notice>
      ) : (
        <div className="space-y-3">
          {usage.error && !usage.data ? (
            <Notice tone="danger">Could not load managed PostgreSQL usage: {usage.error.message}</Notice>
          ) : !usage.data ? (
            <div className="text-xs text-[var(--color-ink-muted)]">Loading usage…</div>
          ) : (
            <UsageView usage={usage.data} />
          )}
          <StaleNotice error={usage.stale ? usage.error : null} label="managed PostgreSQL usage" />

          <DiagnosticsView
            diagnostics={diagnostics}
            onMore={(cursor) => void load(cursor)}
            onSelectDatabase={onSelectDatabase}
          />
        </div>
      )}
    </PanelSection>
  );
}

const GUARDRAIL_BADGE: Record<string, string> = {
  healthy: 'badge-success',
  reached: 'badge-danger',
  stale: 'badge-warning',
  disabled: 'badge-neutral',
};

function UsageView({ usage }: { usage: ManagedPostgresUsageOperatorResponse }) {
  const ceiling = (value: number, format: (n: number) => string) => (value > 0 ? format(value) : 'none');
  const meters: { label: string; used: string; limit: string }[] = [
    {
      label: 'Compute',
      used: formatUnitSeconds(usage.compute_unit_seconds),
      limit: ceiling(usage.max_monthly_compute_unit_seconds, formatUnitSeconds),
    },
    {
      label: 'Storage',
      used: formatByteSeconds(usage.storage_byte_seconds),
      limit: `${ceiling(usage.storage_byte_seconds_limit, formatByteSeconds)} (${formatByteSeconds(usage.storage_byte_seconds_remaining)} left)`,
    },
    {
      label: 'History',
      used: formatByteSeconds(usage.history_byte_seconds),
      limit: ceiling(usage.max_monthly_history_byte_seconds, formatByteSeconds),
    },
    { label: 'Egress', used: formatBytes(usage.egress_bytes), limit: ceiling(usage.max_monthly_egress_bytes, formatBytes) },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact
          label="Guardrail"
          value={<span className={`badge ${GUARDRAIL_BADGE[usage.guardrail_state] ?? 'badge-neutral'}`}>{usage.guardrail_state}</span>}
          sub={usage.policy_enabled ? 'Usage policy enforced' : 'Usage policy off'}
        />
        <Fact
          label="Databases"
          value={`${usage.ready_databases} ready / ${usage.database_limit}`}
          sub={`Storage cap ${formatBytes(usage.storage_limit_bytes)} each`}
        />
        <Fact
          label="Cost this period"
          value={<span title="Millicents in the billing currency">{formatMillicents(usage.cost_millicents)}</span>}
          sub={usage.max_monthly_cost_millicents > 0 ? `Ceiling ${formatMillicents(usage.max_monthly_cost_millicents)}` : 'No cost ceiling'}
        />
        <Fact
          label="Observed"
          value={usage.observed_at ? relativeTime(usage.observed_at) : 'Never'}
          sub={`${usage.fresh ? 'Fresh' : 'Stale'} · period from ${new Date(usage.period_start).toLocaleDateString()}`}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
        <table className="dtable text-xs">
          <thead>
            <tr>
              <th>Meter</th>
              <th>Used this period</th>
              <th>Effective ceiling</th>
            </tr>
          </thead>
          <tbody>
            {meters.map((m) => (
              <tr key={m.label}>
                <td className="cell-primary">{m.label}</td>
                <td className="font-mono">{m.used}</td>
                <td className="font-mono">{m.limit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {usage.line_items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>Line item</th>
                <th>Meter</th>
                <th>Quantity</th>
                <th title="Internal cost, millicents in the billing currency">Cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.line_items.map((item) => (
                <tr key={`${item.code}:${item.meter}`}>
                  <td className="font-mono">{item.code}</td>
                  <td>{item.meter}</td>
                  <td className="font-mono">
                    {item.quantity.toLocaleString()} {item.unit}
                  </td>
                  <td className="font-mono">{formatMillicents(item.cost_millicents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface AccountingPages {
  accountId: string;
  head?: ManagedPostgresAccountingDiagnosticsResponse;
  items: ManagedPostgresAccountingDiagnostic[];
  next?: string;
  error?: Error;
  loading: boolean;
}

/** Cursor-paged diagnostics; every response is checked against the account and request it was made for. */
function useAccountingPages(accountId: string) {
  const seq = useRef(0);
  const [state, setState] = useState<AccountingPages | null>(null);

  const load = useCallback(
    async (after?: string) => {
      const mine = ++seq.current;
      setState((prev) =>
        prev && prev.accountId === accountId ? { ...prev, loading: true } : { accountId, items: [], loading: true },
      );
      try {
        const page = await getManagedPostgresAccounting(accountId, after);
        if (mine !== seq.current) return;
        setState((prev) => ({
          accountId,
          head: page,
          items: after && prev?.accountId === accountId ? [...prev.items, ...page.items] : page.items,
          next: page.next_cursor,
          loading: false,
        }));
      } catch (err) {
        if (mine !== seq.current) return;
        setState((prev) =>
          prev && prev.accountId === accountId
            ? { ...prev, error: err as Error, loading: false }
            : { accountId, items: [], error: err as Error, loading: false },
        );
      }
    },
    [accountId],
  );

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return { view: state && state.accountId === accountId ? state : null, load };
}

function DiagnosticsView({
  diagnostics,
  onMore,
  onSelectDatabase,
}: {
  diagnostics: AccountingPages | null;
  onMore: (cursor: string) => void;
  onSelectDatabase?: (selection: ManagedPostgresSelection) => void;
}) {
  if (!diagnostics || (!diagnostics.head && !diagnostics.error)) {
    return <div className="text-xs text-[var(--color-ink-muted)]">Loading accounting diagnostics…</div>;
  }
  if (!diagnostics.head) {
    return <Notice tone="danger">Could not load accounting diagnostics: {diagnostics.error?.message}</Notice>;
  }
  const { head, items } = diagnostics;
  return (
    <div>
      <div className="mb-1 text-[11px] text-[var(--color-ink-muted)]">
        Accounting evidence evaluated {relativeTime(head.evaluated_at)} · collection window {head.window_seconds}s
        {head.policy_enabled ? '' : ' · usage policy off'}
      </div>
      {items.length === 0 ? (
        <Notice>No databases need usage accounting for this account.</Notice>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>Database</th>
                <th>State</th>
                <th>Accounting</th>
                <th>Collected until</th>
                {onSelectDatabase && <th />}
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.database_id}>
                  <td>
                    <div className="cell-primary">{d.name || '—'}</div>
                    <Mono>{d.database_id}</Mono>
                  </td>
                  <td>{d.state}</td>
                  <td>
                    {!d.accounting_required ? (
                      <span className="badge badge-neutral">Not required</span>
                    ) : d.blocking ? (
                      <span className="badge badge-danger">Blocking</span>
                    ) : (
                      <span className="badge badge-success">Covered</span>
                    )}
                    {d.reasons.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--color-ink-muted)]">
                        {d.reasons.map((reason) => (
                          <li key={reason}>{ACCOUNTING_REASON_LABELS[reason] ?? reason}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td title={d.observed_at ? `Observed ${formatDateTime(d.observed_at)}` : undefined}>
                    {d.collected_until ? formatDateTime(d.collected_until) : 'Nothing collected'}
                  </td>
                  {onSelectDatabase && (
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => onSelectDatabase({ database: d, action: 'import', windowSeconds: head.window_seconds })}
                        >
                          Import usage
                        </button>
                        {d.reasons.includes('legacy_identity_unknown') && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => onSelectDatabase({ database: d, action: 'reconcile', windowSeconds: head.window_seconds })}
                          >
                            Reconcile
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--color-ink-muted)]">
        <span>
          {items.length} database(s) loaded
          {diagnostics.error ? ` · last load failed: ${diagnostics.error.message}` : ''}
        </span>
        {diagnostics.next && (
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            disabled={diagnostics.loading}
            onClick={() => diagnostics.next && onMore(diagnostics.next)}
          >
            {diagnostics.loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}
