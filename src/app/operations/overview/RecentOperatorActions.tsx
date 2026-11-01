'use client';

import React from 'react';
import Link from 'next/link';
import { searchObsAuditLog } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { relativeTime } from '@/lib/format';
import { SectionCard } from '@/components/ui/Panels';
import { EmptyRow, ErrorRow, LoadingRow, RefreshFailed } from '../incidents/parts';

/** The last operator actions across the platform, newest first. */
export function RecentOperatorActions() {
  const audit = useAsync(() => searchObsAuditLog({ limit: 8, operator_only: true }), [], 30000);
  return (
    <SectionCard
      title="Recent operator actions"
      action={
        <Link href="/audit-log?operator=1" className="btn btn-ghost btn-xs">
          Audit trail
        </Link>
      }
    >
      {audit.error && !audit.data ? (
        <ErrorRow message={`Could not load operator audit: ${audit.error.message}`} />
      ) : audit.loading && !audit.data ? (
        <LoadingRow label="Loading operator audit" />
      ) : !audit.data?.items.length ? (
        <EmptyRow>No operator actions in the audit window.</EmptyRow>
      ) : (
        <div className="divide-y divide-[var(--color-line)]">
          {audit.data.items.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-xs">
              <div className="min-w-0">
                <div className="truncate font-mono font-semibold">{row.kind}</div>
                <div className="truncate text-[var(--color-ink-muted)]">
                  {row.actor || 'system'}
                  {row.account_email ? ` · ${row.account_email}` : ''}
                </div>
              </div>
              <span className="shrink-0 text-[var(--color-ink-muted)]">{relativeTime(row.received_at)}</span>
            </div>
          ))}
        </div>
      )}
      {audit.error && audit.data && <RefreshFailed error={audit.error} />}
    </SectionCard>
  );
}
