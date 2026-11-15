'use client';

import React from 'react';
import Link from 'next/link';
import { getTicketCustomer } from '@/lib/ops/supportInbox';
import { kindLabel, RESTRICTION_LABELS } from '@/lib/ops/accountHealth';
import { relativeTime } from '@/lib/format';
import { tenantHref, traceHref } from '@/lib/routes';
import { SectionCard } from '@/components/ui/Panels';
import { Mono } from '@/components/ui/bits';
import { TenantLink } from '@/components/operator/TenantLink';
import { DiagnosisPanel } from '@/components/operator/tenant/DiagnosisPanel';
import { useKeyed } from '@/components/operator/tenant/shared';

/* The account behind a ticket (GET /v1/admin/support/tickets/{id}/customer,
   apid ADR-20261115120000): who it is, what their account health page showed
   when they wrote in, what changed since, and the live diagnosis. */
export function TicketCustomerPanel({ ticketId }: { ticketId: string }) {
  const { data, error } = useKeyed(ticketId, getTicketCustomer);
  if (error && !data) {
    return (
      <SectionCard title="Customer">
        <p className="p-4 text-xs text-[var(--color-danger)]">{error.message || 'Could not load the customer.'}</p>
      </SectionCard>
    );
  }
  if (!data) {
    return (
      <SectionCard title="Customer">
        <p className="p-4 text-xs text-[var(--color-ink-muted)]">Loading the customer…</p>
      </SectionCard>
    );
  }
  if (data.unavailable || !data.account_id) {
    return (
      <SectionCard title="Customer">
        <p className="p-4 text-xs text-[var(--color-ink-muted)]">The account behind this ticket could not be loaded.</p>
      </SectionCard>
    );
  }
  const snap = data.snapshot;
  return (
    <div className="space-y-4">
      <SectionCard
        title="Customer"
        action={
          <Link href={tenantHref(data.account_id)} className="btn btn-ghost btn-xs">
            Open account →
          </Link>
        }
      >
        <div className="space-y-3 px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <TenantLink accountId={data.account_id} short />
            {data.plan && <span className="badge badge-neutral uppercase">{data.plan}</span>}
            {data.status && <span className={`badge ${data.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{data.status.replace('_', ' ')}</span>}
            <span className="text-[var(--color-ink-muted)]">
              {data.apps} app{data.apps === 1 ? '' : 's'}
              {data.org_slug ? ` · org ${data.org_slug}` : ''}
            </span>
          </div>

          {(data.lifted?.length || data.added?.length) && (
            <div className="space-y-1">
              {!!data.lifted?.length && (
                <p>
                  Lifted since they wrote in:{' '}
                  {data.lifted.map((k) => (
                    <span key={k} className="badge badge-success mr-1">
                      {kindLabel(RESTRICTION_LABELS, k)}
                    </span>
                  ))}
                </p>
              )}
              {!!data.added?.length && (
                <p>
                  New since they wrote in:{' '}
                  {data.added.map((k) => (
                    <span key={k} className="badge badge-danger mr-1">
                      {kindLabel(RESTRICTION_LABELS, k)}
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}

          <div>
            <h3 className="mb-1 font-medium">When they wrote in</h3>
            {!snap ? (
              <p className="text-[var(--color-ink-muted)]">No snapshot (tickets support opened, or opened before snapshots, have none).</p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[var(--color-ink-muted)]">
                  {relativeTime(snap.captured_at)} · {snap.plan} · {snap.status.replace('_', ' ')} ·{' '}
                  {snap.health.attention === 0
                    ? 'their page said nothing needed attention'
                    : `their page showed ${snap.health.attention} thing${snap.health.attention === 1 ? '' : 's'} needing attention`}
                </p>
                {[...snap.health.restrictions.map((r) => ({ key: `r-${r.kind}`, title: r.title })),
                  ...(snap.health.signals ?? []).map((s) => ({ key: `s-${s.kind}-${s.subject}`, title: s.title }))].map((item) => (
                  <div key={item.key} className="rounded border border-[var(--color-line)] px-2 py-1">
                    {item.title}
                  </div>
                ))}
                {snap.request_id && (
                  <p>
                    Request <Mono>{snap.request_id}</Mono>:{' '}
                    {snap.request ? (
                      <>
                        refused with <Mono>{snap.request.code}</Mono> on <Mono>{snap.request.route}</Mono> {relativeTime(snap.request.occurred_at)}
                        {snap.request.trace_id && (
                          <>
                            {' '}
                            <Link href={traceHref(snap.request.trace_id)} className="underline">
                              trace
                            </Link>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="text-[var(--color-ink-muted)]">no recorded refusal matched it.</span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </SectionCard>
      <DiagnosisPanel diagnosis={data.diagnosis} />
    </div>
  );
}
