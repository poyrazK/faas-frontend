'use client';

/* ==========================================================================
   Dashboard-scoped boundary. Nested inside the console layout, so the sidebar
   and top bar survive — only the failing page is replaced. That matters more
   than it sounds: the customer keeps their navigation and can move to another
   page instead of being stranded.
   ========================================================================== */

import React, { useEffect } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icons';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard page error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-xl"
        style={{ background: '#fdf1f1', color: 'var(--color-danger)' }}
      >
        <Icon name="alerts" size={22} />
      </div>
      <h2 className="mt-4 text-lg font-bold">This page failed to render</h2>
      <p className="mt-2 max-w-md text-sm" style={{ color: 'var(--color-ink-muted)' }}>
        {error.message || 'An unexpected error occurred.'}
      </p>
      {error.digest && (
        <p className="mono mt-3 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        <button className="btn btn-primary" onClick={reset}>
          <Icon name="refresh" size={14} /> Try again
        </button>
        <Link href="/dashboard" className="btn btn-secondary">
          Back to overview
        </Link>
      </div>
    </div>
  );
}
