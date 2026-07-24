'use client';

import React from 'react';
import { ApiError } from '@/lib/api';

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      style={{ color: 'var(--color-brand)' }}
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Skeleton rows for table loading. */
export function SkeletonTable({ cols = 4, rows = 4 }: { cols?: number; rows?: number }) {
  return (
    <div className="p-4 space-y-3" aria-busy>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-4 flex-1 rounded animate-pulse"
              style={{ background: 'var(--color-surface-subtle)', opacity: 1 - r * 0.12 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon = '📦',
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="text-base font-semibold" style={{ color: 'var(--color-ink)' }}>{title}</h3>
      {hint && <p className="mt-1.5 text-sm max-w-sm" style={{ color: 'var(--color-ink-muted)' }}>{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const isApi = error instanceof ApiError;
  const title = isApi ? (error as ApiError).problem?.title || 'Something went wrong' : 'Something went wrong';
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center mb-3"
        style={{ background: '#fef2f2', color: 'var(--color-danger)' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <h3 className="text-base font-semibold" style={{ color: 'var(--color-ink)' }}>{title}</h3>
      <p className="mt-1.5 text-sm max-w-md" style={{ color: 'var(--color-ink-muted)' }}>{error.message}</p>
      {onRetry && (
        <button className="btn btn-secondary btn-sm mt-5" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Convenience wrapper: renders the right state for an async slice and only
 * calls `children` once data is present.
 */
export function AsyncBoundary<T>({
  state,
  skeleton,
  empty,
  isEmpty,
  children,
}: {
  state: { data: T | null; loading: boolean; error: Error | null; reload: () => void };
  skeleton?: React.ReactNode;
  empty?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => React.ReactNode;
}) {
  if (state.loading && state.data === null) return <>{skeleton ?? <SkeletonTable />}</>;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data === null) return <>{skeleton ?? <SkeletonTable />}</>;
  if (empty && isEmpty && isEmpty(state.data)) return <>{empty}</>;
  return <>{children(state.data)}</>;
}
