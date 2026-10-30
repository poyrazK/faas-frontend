'use client';

/* Small presentational pieces shared by the Incidents and Telemetry pages. */

import React from 'react';
import { relativeTime } from '@/lib/format';
import { badgeClass, humanize, stateTone, type Tone } from '@/lib/ops/telemetry';

export function LoadingRow({ label }: { label: string }) {
  return <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">{label}…</div>;
}

export function ErrorRow({ message }: { message: string }) {
  return (
    <div role="alert" className="p-6 text-center text-xs text-[var(--color-danger)]">
      {message}
    </div>
  );
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">{children}</div>;
}

/** Shown under a card whose refresh failed while it still displays the last good snapshot. */
export function RefreshFailed({ error }: { error: Error }) {
  return (
    <div role="alert" className="table-foot text-[var(--color-danger)]">
      Refresh failed: {error.message}. Showing the last successful snapshot.
    </div>
  );
}

export function Notice({ tone = 'warning', children }: { tone?: 'warning' | 'danger' | 'info'; children: React.ReactNode }) {
  const palette =
    tone === 'danger'
      ? 'border-[#f5d5d5] bg-[var(--color-danger-subtle)] text-[var(--color-danger)]'
      : tone === 'info'
        ? 'border-[var(--color-line)] bg-[var(--color-surface-subtle)] text-[var(--color-ink-soft)]'
        : 'border-[#f2e2bd] bg-[var(--color-warning-subtle)] text-[var(--color-warning-bold)]';
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={`rounded-lg border p-3 text-xs ${palette}`}>
      {children}
    </div>
  );
}

/** Badge for one of the backend's closed state vocabularies, with its reason as a tooltip. */
export function StateBadge({ state, reason, tone }: { state: string | null | undefined; reason?: string; tone?: Tone }) {
  const label = state ? humanize(state) : 'unknown';
  return (
    <span className={badgeClass(tone ?? stateTone(state))} title={reason ? humanize(reason) : undefined}>
      {label}
    </span>
  );
}

export function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[var(--color-ink-muted)]">{label}</div>
      <div className="mt-1 break-words font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-[var(--color-ink-muted)]">{sub}</div>}
    </div>
  );
}

/** Relative time with the absolute timestamp on hover; a dash when absent. */
export function When({ at }: { at: string | null | undefined }) {
  if (!at) return <span className="text-[var(--color-ink-muted)]">—</span>;
  return <span title={new Date(at).toLocaleString()}>{relativeTime(at)}</span>;
}

/** The backend's closed limitation codes: what a response does not claim. */
export function Limitations({ items }: { items: string[] | null | undefined }) {
  if (!items?.length) return null;
  return (
    <details className="px-4 pb-4 text-xs text-[var(--color-ink-muted)]">
      <summary className="cursor-pointer select-none">What this does not prove ({items.length})</summary>
      <ul className="mt-2 list-disc space-y-0.5 pl-5">
        {items.map((item) => (
          <li key={item}>{humanize(item)}</li>
        ))}
      </ul>
    </details>
  );
}

/** Proportional bar for a coverage window: successful / failed / unknown observation time. */
export function CoverageBar({ success, failed, unknown }: { success: number; failed: number; unknown: number }) {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-subtle)]">
        <div style={{ width: pct(success), background: 'var(--color-brand-bright)' }} />
        <div style={{ width: pct(failed), background: 'var(--color-danger)' }} />
        <div style={{ width: pct(unknown), background: 'var(--color-warning)' }} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[var(--color-ink-muted)]">
        <span>{pct(success)} observed</span>
        <span>{pct(failed)} failed</span>
        <span>{pct(unknown)} unknown</span>
      </div>
    </div>
  );
}
