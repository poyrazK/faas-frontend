'use client';

/* ==========================================================================
   Invoices — real billing documents from /v1/invoices (#259).

   One contract detail shapes the UI: the hosted PDF URL is provider-scoped
   and deliberately not on the wire. `pdf_available` is the only PDF surface
   the API exposes, so a downloadable invoice sends the customer to the
   Stripe/Paddle portal rather than to a link we could fabricate here.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { listInvoices, getUsageSummary, type Invoice } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, FilterSelect, Mono } from '@/components/ui/bits';
import { StatTile, SectionCard, TableFooter } from '@/components/ui/Panels';
import { usePage } from '@/lib/usePaged';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

const STATUS_BADGE: Record<Invoice['status'], string> = {
  paid: 'badge-brand',
  open: 'badge-info',
  draft: 'badge-muted',
  uncollectible: 'badge-danger',
  void: 'badge-muted',
};

/** Money is integer cents in the invoice's own currency. */
function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function period(inv: Invoice): string {
  const fmt = (s: string) => new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(inv.period_start)} – ${fmt(inv.period_end)}`;
}

export default function InvoicesPage() {
  const [status, setStatus] = useState('all');
  const invoices = useAsync(() => listInvoices(50), []);
  const summary = useAsync(() => getUsageSummary(), []);

  const items = useMemo(() => invoices.data?.items ?? [], [invoices.data]);
  const filtered = items.filter((i) => status === 'all' || i.status === status);

  const pg = usePage(filtered, 15);

  const paidTotal = items.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount_paid_cents, 0);
  const outstanding = items.filter((i) => i.status === 'open').reduce((s, i) => s + (i.total_cents - i.amount_paid_cents), 0);
  const currency = items[0]?.currency ?? 'eur';

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Billing history for your account."
        actions={
          <>
            <FilterSelect
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'paid', label: 'Paid' },
                { value: 'open', label: 'Open' },
                { value: 'draft', label: 'Draft' },
                { value: 'uncollectible', label: 'Uncollectible' },
                { value: 'void', label: 'Void' },
              ]}
            />
            <Link href="/dashboard/usage" className="btn btn-secondary">
              <Icon name="usage" size={14} /> View usage
            </Link>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Invoices" value={items.length} sub={items.length ? `newest ${relativeTime(items[0].created_at)}` : undefined} />
        <StatTile label="Paid to date" value={money(paidTotal, currency)} />
        <StatTile
          label="Outstanding"
          value={money(outstanding, currency)}
          color="var(--color-chart-alt)"
          sub={summary.data ? `${summary.data.used_gb_hours.toFixed(2)} GB-h this month` : undefined}
        />
      </div>

      <SectionCard title="Billing history">
        <AsyncBoundary
          state={invoices}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={5} rows={4} />}
          empty={
            status !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No invoice has that status." />
            ) : (
              <EmptyState
                icon="invoices"
                title="No invoices yet"
                hint="Invoices appear here once your first billing period closes. Usage in the current period is on the Usage page."
                action={<Link href="/dashboard/usage" className="btn btn-secondary">View current usage</Link>}
              />
            )
          }
        >
          {() => (
            <>
              <div className="overflow-x-auto">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Period</th>
                      <th>Status</th>
                      <th>Subtotal</th>
                      <th>Tax</th>
                      <th>Total</th>
                      <th>Issued</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pg.items.map((inv) => (
                      <tr key={inv.id}>
                        <td className="cell-primary">
                          {inv.number ? inv.number : <Mono>{inv.provider_invoice_id.slice(0, 16)}</Mono>}
                          <div className="mt-0.5 text-xs capitalize" style={{ color: 'var(--color-ink-muted)' }}>
                            via {inv.provider}
                          </div>
                        </td>
                        <td>{period(inv)}</td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[inv.status]}`}>{inv.status}</span>
                        </td>
                        <td>{money(inv.subtotal_cents, inv.currency)}</td>
                        <td>{inv.tax_cents > 0 ? money(inv.tax_cents, inv.currency) : '—'}</td>
                        <td className="font-medium" style={{ color: 'var(--color-ink)' }}>
                          {money(inv.total_cents, inv.currency)}
                          {inv.status === 'open' && inv.amount_paid_cents > 0 && (
                            <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                              {money(inv.amount_paid_cents, inv.currency)} paid
                            </div>
                          )}
                        </td>
                        <td>{relativeTime(inv.created_at)}</td>
                        <td className="text-right">
                          {inv.pdf_available ? (
                            <span className="badge badge-muted" title="Download the PDF from your billing provider's portal">
                              <Icon name="invoices" size={11} /> PDF ready
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-ink-faint)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TableFooter
                from={pg.from}
                to={pg.to}
                total={pg.total}
                noun="invoices"
                page={pg.page}
                pageCount={pg.pageCount}
                onPage={pg.setPage}
              />
            </>
          )}
        </AsyncBoundary>
      </SectionCard>

      <p className="mt-4 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
        Invoice PDFs are hosted by your billing provider and are downloaded from their portal, not from this console —
        the API exposes only whether a PDF has been generated. Amounts are shown in each invoice&apos;s own currency.
      </p>
    </div>
  );
}
