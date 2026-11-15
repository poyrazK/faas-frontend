'use client';

import React, { Suspense, use, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { getSupportTicket, isOverdue, listSupportMessages, markTicketRead, nextDue, type SupportMessage } from '@/lib/ops/supportInbox';
import { relativeTime } from '@/lib/format';
import { appDeploymentsHref, deploymentHref, opsHref } from '@/lib/routes';
import { SectionCard } from '@/components/ui/Panels';
import { Mono } from '@/components/ui/bits';
import { useKeyed } from '@/components/operator/tenant/shared';
import { Assignee, PriorityBadge, StatusBadge } from '@/components/operator/support/TicketBits';
import { TicketActions } from '@/components/operator/support/TicketActions';
import { TicketCustomerPanel } from '@/components/operator/support/TicketCustomerPanel';

/* One support ticket: the conversation with internal notes, the staff
   actions, and the account behind it. */
export default function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <Ticket ticketId={decodeURIComponent(id).trim()} />
    </Suspense>
  );
}

function Ticket({ ticketId }: { ticketId: string }) {
  const { account } = useAuth();
  const me = account?.id;
  const ticket = useKeyed(ticketId, getSupportTicket);
  const messages = useKeyed(ticketId, (id) => listSupportMessages(id));
  const reload = () => {
    ticket.reload();
    messages.reload();
  };
  const unread = ticket.data?.ticket.unread_count ?? 0;
  useEffect(() => {
    // Opening the ticket reads its notifications; a failure only leaves them unread.
    if (unread > 0) void markTicketRead(ticketId).catch(() => undefined);
  }, [ticketId, unread]);

  const t = ticket.data;
  if (ticket.error && !t) {
    const missing = ticket.error instanceof ApiError && ticket.error.status === 404;
    const forbidden = ticket.error instanceof ApiError && ticket.error.status === 403;
    return (
      <div>
        <BackLink />
        <h1 className="text-[22px] font-bold">Support ticket</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          {missing ? 'No ticket has this ID.' : forbidden ? 'You are not on the support roster.' : ticket.error.message}
        </p>
      </div>
    );
  }
  if (!t) {
    return (
      <div>
        <BackLink />
        <p className="text-sm text-[var(--color-ink-muted)]">Loading the ticket…</p>
      </div>
    );
  }
  const due = nextDue(t.episode, t.ticket.status);
  const ctx = t.ticket.context;
  return (
    <div>
      <BackLink />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight">{t.ticket.subject}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
            <StatusBadge status={t.ticket.status} />
            <PriorityBadge priority={t.priority} />
            <span>{t.ticket.category}</span>
            <span>· opened {relativeTime(t.ticket.created_at)}</span>
            <span>
              · <Assignee id={t.assignee_id} me={me} />
            </span>
            {due && (
              <span className={isOverdue(due.at) ? 'font-medium text-[var(--color-danger)]' : ''}>
                · {due.label} due {relativeTime(due.at)}
              </span>
            )}
            {t.episode.wait_since && <span>· waiting on the customer since {relativeTime(t.episode.wait_since)}</span>}
            {t.episode.resolution_breached && <span className="badge badge-danger">resolution SLA breached</span>}
          </div>
          {(ctx.app_id || ctx.deployment_id || ctx.request_id) && (
            <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
              {ctx.app_id && (
                <Link href={appDeploymentsHref(ctx.app_id)} className="underline">
                  App {ctx.app_id.slice(0, 8)}
                </Link>
              )}
              {ctx.deployment_id && (
                <Link href={deploymentHref(ctx.deployment_id)} className="underline">
                  Deployment {ctx.deployment_id.slice(0, 8)}
                </Link>
              )}
              {ctx.request_id && (
                <span>
                  Request <Mono>{ctx.request_id}</Mono>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mb-4">
        <TicketActions ticket={t} me={me} onDone={reload} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionCard title="Conversation">
            {messages.error && !messages.data ? (
              <p className="p-4 text-xs text-[var(--color-danger)]">{messages.error.message || 'Could not load messages.'}</p>
            ) : !messages.data ? (
              <p className="p-4 text-xs text-[var(--color-ink-muted)]">Loading messages…</p>
            ) : messages.data.length === 0 ? (
              <p className="p-4 text-xs text-[var(--color-ink-muted)]">No messages.</p>
            ) : (
              <ol className="space-y-3 p-4">
                {messages.data.map((m) => (
                  <Message key={m.id} m={m} />
                ))}
              </ol>
            )}
          </SectionCard>
        </div>
        <div className="lg:col-span-2">
          <TicketCustomerPanel ticketId={ticketId} />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href={opsHref('support')} className="mb-3 inline-block text-xs text-[var(--color-ink-muted)] hover:underline">
      ← Support inbox
    </Link>
  );
}

const AUTHOR_LABELS: Record<string, string> = { customer: 'Customer', staff: 'Support', note: 'Internal note' };

function Message({ m }: { m: SupportMessage }) {
  const tone =
    m.author === 'note'
      ? 'border-[var(--color-warning)] bg-[var(--color-warning-subtle)]'
      : m.author === 'staff'
        ? 'border-[var(--color-line)] bg-[var(--color-surface-subtle)] ml-8'
        : 'border-[var(--color-line)] mr-8';
  return (
    <li className={`rounded-lg border px-3 py-2 text-xs ${tone}`}>
      <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--color-ink-muted)]">
        <span className="font-medium">{AUTHOR_LABELS[m.author] ?? m.author}</span>
        <span title={m.created_at}>{relativeTime(m.created_at)}</span>
      </div>
      <div className={`whitespace-pre-wrap break-words ${m.redacted ? 'italic text-[var(--color-ink-muted)]' : ''}`}>{m.body}</div>
    </li>
  );
}
