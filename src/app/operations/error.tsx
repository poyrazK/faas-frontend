'use client';

/* ==========================================================================
   Operations-scoped boundary. Nested inside the operations shell, so the
   sidebar, step-up prompt and in-flight action tracker survive a page crash
   and the operator can keep working from another page.
   ========================================================================== */

import React, { useEffect } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icons';

export default function OperationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Operations page error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-danger-subtle)] text-[var(--color-danger)]">
        <Icon name="alerts" size={22} />
      </div>
      <h2 className="mt-4 text-lg font-bold">This page failed to render</h2>
      <p className="mt-2 max-w-md text-sm text-[var(--color-ink-muted)]">
        {error.message || 'An unexpected error occurred.'} Actions already submitted keep running; their status is under
        Emergency Controls.
      </p>
      {error.digest && <p className="mt-3 font-mono text-xs text-[var(--color-ink-faint)]">Reference: {error.digest}</p>}
      <div className="mt-6 flex gap-2">
        <button className="btn btn-primary btn-sm" onClick={reset}>
          <Icon name="refresh" size={14} />
          Try again
        </button>
        <Link href="/overview" className="btn btn-secondary btn-sm">
          Fleet overview
        </Link>
      </div>
    </div>
  );
}
