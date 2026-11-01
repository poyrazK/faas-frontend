'use client';

import React from 'react';
import { checkBadge, hostingSectionOff, type HostingDiagnosticCheck } from '@/lib/ops/hosting';
import type { AsyncState } from '@/lib/useAsync';
import { EmptyState } from '@/components/ui/States';
import type { IconName } from '@/components/ui/Icons';

/**
 * The states every hosting section shares: switched off on this control
 * plane (or not served by this apid), failed, loading, empty, or its rows, plus a note when a refresh
 * failed and the rows are the last good snapshot.
 */
export function QueryBody<T>({
  query,
  noun,
  icon,
  empty,
  isEmpty,
  children,
}: {
  query: Pick<AsyncState<T>, 'data' | 'error' | 'loading'>;
  /** "releases", for "Could not load releases" and "Loading releases…". */
  noun: string;
  icon: IconName;
  empty: { title: string; hint?: string };
  isEmpty: (data: T) => boolean;
  children: (data: T) => React.ReactNode;
}) {
  const { data, error, loading } = query;
  const off = hostingSectionOff(error);
  if (off) return <EmptyState icon={icon} title="Not available on this control plane" hint={off} />;
  if (error && data === null) {
    return (
      <div role="alert" className="p-6 text-center text-sm text-[var(--color-danger)]">
        Could not load {noun}: {error.message}
      </div>
    );
  }
  if (data === null) {
    return <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">{loading ? `Loading ${noun}…` : `No ${noun} loaded.`}</div>;
  }
  return (
    <>
      {isEmpty(data) ? <EmptyState icon={icon} title={empty.title} hint={empty.hint} /> : children(data)}
      {error && (
        <div role="alert" className="table-foot text-[var(--color-danger)]">
          Refresh failed: {error.message}. Showing the last successful snapshot.
        </div>
      )}
    </>
  );
}

const STEP_LABELS: Record<string, string> = {
  site: 'Site',
  run: 'CI run',
  release: 'Release',
  preview: 'Preview',
  publication: 'Publication',
  observation: 'Consistency',
  serving: 'Serving',
};

/** apid's diagnostic checks in order: what it found, and what to do about it. */
export function ChecksList({ checks }: { checks: HostingDiagnosticCheck[] }) {
  return (
    <ol className="divide-y divide-[var(--color-line)]">
      {checks.map((check, index) => {
        const badge = checkBadge(check.state);
        return (
          // Step and badge sit above the text on a phone, in their own columns from sm up.
          <li key={`${check.step}-${index}`} className="flex flex-col gap-1.5 px-5 py-3 text-xs sm:flex-row sm:gap-3">
            <span className="flex items-center gap-2 sm:contents">
              <span className="font-medium text-[var(--color-ink-soft)] sm:w-24 sm:shrink-0">{STEP_LABELS[check.step] ?? check.step}</span>
              <span className="sm:w-24 sm:shrink-0">
                <span className={`badge ${badge.tone}`}>{badge.label}</span>
              </span>
            </span>
            <span className="min-w-0">
              <span className="block text-[var(--color-ink)]">{check.summary}</span>
              <span className="mt-0.5 block text-[var(--color-ink-muted)]">{check.action}</span>
              <span className="mt-0.5 block font-mono text-[10px] text-[var(--color-ink-faint)]">{check.code}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
