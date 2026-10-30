'use client';

import React from 'react';
import { ApiError } from '@/lib/api';
import { useAsync, type AsyncState } from '@/lib/useAsync';
import { Icon } from '@/components/ui/Icons';

/**
 * useAsync for a view keyed by one ID (account, trace, wake). useAsync keeps
 * the previous result while the next one loads, so the result is tagged with
 * the key it was fetched for and anything fetched for another key is dropped:
 * a slow response for account A never renders under account B. A null key
 * fetches nothing.
 */
export function useKeyed<T>(
  key: string | null,
  fetcher: (key: string) => Promise<T>,
  pollMs?: number,
): Omit<AsyncState<T>, 'setData'> {
  const state = useAsync(
    async () => {
      if (key === null) return null;
      try {
        return { key, value: await fetcher(key) };
      } catch (err) {
        if (err && typeof err === 'object') errorKeys.set(err, key);
        throw err;
      }
    },
    [key],
    pollMs,
  );
  const current = state.data && state.data.key === key ? state.data.value : null;
  // useAsync does not clear `error` when the key changes; only show errors raised for this key.
  const error = key !== null && state.error && errorKeys.get(state.error) === key ? state.error : null;
  return {
    data: current,
    loading: key !== null && current === null && error === null,
    error,
    reload: state.reload,
    lastSuccessAt: current === null ? null : state.lastSuccessAt,
    stale: current !== null && error !== null,
  };
}

const errorKeys = new WeakMap<object, string>();

/** Compact section frame used by every tenant panel. */
export function PanelSection({
  title,
  actions,
  children,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-[var(--color-ink-soft)]">{title}</h4>
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" className="btn btn-ghost btn-xs" onClick={onClick} disabled={busy} title="Refresh">
      <Icon name="refresh" size={12} />
      {busy ? 'Loading…' : 'Refresh'}
    </button>
  );
}

export function Notice({ tone = 'muted', children }: { tone?: 'muted' | 'danger' | 'warning'; children: React.ReactNode }) {
  const cls =
    tone === 'danger'
      ? 'bg-[var(--color-danger-subtle)] text-[var(--color-danger)]'
      : tone === 'warning'
        ? 'bg-[var(--color-warning-subtle)] text-[var(--color-warning-bold)]'
        : 'bg-[var(--color-surface-subtle)] text-[var(--color-ink-muted)]';
  return (
    <div role={tone === 'muted' ? 'status' : 'alert'} className={`rounded-lg p-3 text-xs ${cls}`}>
      {children}
    </div>
  );
}

/** "Refresh failed … showing the last result" line for a view that still has data. */
export function StaleNotice({ error, label }: { error: Error | null; label: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 text-[11px] text-[var(--color-danger)]">
      Refresh of {label} failed: {error.message}. Showing the last successful result.
    </p>
  );
}

export function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--color-line)] p-2.5">
      <div className="text-[11px] text-[var(--color-ink-muted)]">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[10px] text-[var(--color-ink-muted)]">{sub}</div>}
    </div>
  );
}

/** Local date + time for an ISO timestamp, or "—". */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export const apiErrorCode = (err: unknown) => (err instanceof ApiError ? err.code : null);
export const apiErrorStatus = (err: unknown) => (err instanceof ApiError ? err.status : null);
