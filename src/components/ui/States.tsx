'use client';

import React from 'react';
import { ApiError } from '@/lib/api';
import { Icon, type IconName } from './Icons';

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
    <div className="space-y-3 p-5" aria-busy>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-4 flex-1 animate-pulse rounded"
              style={{ background: 'var(--color-surface-subtle)', opacity: 1 - r * 0.12 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Placeholder block for a loading chart or panel. */
export function SkeletonBlock({ height = 200 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-lg"
      style={{ height, background: 'var(--color-surface-subtle)' }}
      aria-busy
    />
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className="flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ background: 'var(--color-surface-subtle)', color: 'var(--color-ink-muted)' }}
      >
        <Icon name={icon} size={20} />
      </div>
      <h3 className="mt-3.5 text-base font-semibold" style={{ color: 'var(--color-ink)' }}>
        {title}
      </h3>
      {hint && (
        <p className="mt-1.5 max-w-sm text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          {hint}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const isApi = error instanceof ApiError;
  const title = isApi ? (error as ApiError).problem?.title || 'Something went wrong' : 'Something went wrong';
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ background: '#fdf1f1', color: 'var(--color-danger)' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <h3 className="text-base font-semibold" style={{ color: 'var(--color-ink)' }}>
        {title}
      </h3>
      <p className="mt-1.5 max-w-md text-sm" style={{ color: 'var(--color-ink-muted)' }}>
        {error.message}
      </p>
      {onRetry && (
        <button className="btn btn-secondary btn-sm mt-5" onClick={onRetry}>
          <Icon name="refresh" size={13} />
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
