'use client';

/* ==========================================================================
   Route-level error boundary. Without this, a throw anywhere in a page
   unmounts the whole tree and the customer gets a blank white screen with no
   way back. Next calls `reset()` to re-render the segment, so a transient
   failure is recoverable without a full reload.
   ========================================================================== */

import React, { useEffect } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icons';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack in production
    // builds, so it needs to reach the console even though the message is
    // redacted.
    console.error('Unhandled error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-5" style={{ background: 'var(--color-surface-subtle)' }}>
      <div className="card w-full max-w-md p-8 text-center">
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ background: '#fdf1f1', color: 'var(--color-danger)' }}
        >
          <Icon name="alerts" size={22} />
        </div>
        <h1 className="mt-4 text-xl font-bold">Something broke on this page</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          The rest of the console is unaffected. Retrying re-renders just this page.
        </p>
        {error.digest && (
          <p className="mono mt-3 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button className="btn btn-primary" onClick={reset}>
            <Icon name="refresh" size={14} /> Try again
          </button>
          <Link href="/dashboard" className="btn btn-secondary">
            Back to overview
          </Link>
        </div>
      </div>
    </div>
  );
}
