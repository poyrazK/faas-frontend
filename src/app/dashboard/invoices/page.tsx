'use client';

/* ==========================================================================
   Invoices — there's no billing-document endpoint, so no invoice can be
   listed or downloaded. What the API does expose is the monthly roll-up with
   overage math, so this page shows the real cost picture per month and is
   explicit that these are usage statements, not issued invoices.
   ========================================================================== */

import React, { useMemo } from 'react';
import Link from 'next/link';
import { getUsageSummary, type UsageSummary } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard, Unavailable } from '@/components/ui/Panels';
import { AsyncBoundary, SkeletonTable } from '@/components/ui/States';
import { euros } from '@/lib/format';

function recentMonths(count = 6): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Rolls up each recent month; a month with no data simply drops out. */
async function loadStatements(months: string[]): Promise<UsageSummary[]> {
  const results = await Promise.all(months.map((m) => getUsageSummary(m).catch(() => null)));
  return results.filter((r): r is UsageSummary => r !== null);
}

export default function InvoicesPage() {
  const months = useMemo(() => recentMonths(), []);
  const statements = useAsync(() => loadStatements(months), []);

  return (
    <div>
      <PageHeader title="Invoices" subtitle="Billing history for your account." />

      <Unavailable
        icon="invoices"
        title="Invoice documents aren't issued through the console"
        what="The control plane meters usage but doesn't generate downloadable invoices or expose a billing-document API, so there's nothing to list or download here yet."
        endpoint="invoice"
        alternative={{ href: '/dashboard/usage', label: 'View detailed usage' }}
      />

      <SectionCard className="mt-4" title="Monthly usage statements">
        <AsyncBoundary state={statements} skeleton={<SkeletonTable cols={4} rows={4} />}>
          {(list) => (
            <>
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>GB-hours used</th>
                    <th>Included</th>
                    <th>Overage</th>
                    <th>Overage cost</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.month}>
                      <td className="cell-primary">{s.month}</td>
                      <td>{s.used_gb_hours.toFixed(2)}</td>
                      <td>{s.included_gb_hours}</td>
                      <td>{s.overage_gb_hours.toFixed(2)}</td>
                      <td style={s.overage_cents > 0 ? { color: 'var(--color-warn)', fontWeight: 500 } : undefined}>
                        {euros(s.overage_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="table-foot">
                <span>
                  Usage roll-ups from the metering pipeline — not issued invoices.{' '}
                  <Link href="/dashboard/usage" style={{ color: 'var(--color-brand)' }}>
                    Per-workflow breakdown
                  </Link>
                </span>
              </div>
            </>
          )}
        </AsyncBoundary>
      </SectionCard>
    </div>
  );
}
