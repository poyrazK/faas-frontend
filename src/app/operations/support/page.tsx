'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import {
  isOverdue,
  listSupportTickets,
  nextDue,
  SUPPORT_SEARCH_MAX,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type StaffTicket,
} from '@/lib/ops/supportInbox';
import { useAsync } from '@/lib/useAsync';
import { relativeTime } from '@/lib/format';
import { supportTicketHref } from '@/lib/routes';
import { FilterSelect, PageHeader, SearchInput } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { Assignee, PriorityBadge, StatusBadge } from '@/components/operator/support/TicketBits';
import { rowOpener } from '@/components/ui/RowMenu';

/* ==========================================================================
   Support inbox: the tickets customers opened (and the ones support opened
   for stuck customers), newest first, with the SLA deadline that is due next.
   The same tickets as apid's /dashboard/admin/support; only operators on the
   support roster can read them.
   ========================================================================== */

export default function SupportInboxPage() {
  return (
    <Suspense>
      <SupportInbox />
    </Suspense>
  );
}

function SupportInbox() {
  const { account } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState('open');
  const [mine, setMine] = useState(false);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [extra, setExtra] = useState<{ items: StaffTicket[]; next?: string } | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const me = account?.id;
  const filters = { status: status === 'all' ? undefined : status, search, assigneeId: mine && me ? me : undefined };
  const { data, loading, error, reload } = useAsync(
    () => {
      setExtra(null);
      return listSupportTickets(filters);
    },
    [status, search, mine, me],
  );
  const items = [...(data?.items ?? []), ...(extra?.items ?? [])];
  const next = extra ? extra.next : data?.next_cursor;
  const loadMore = async () => {
    if (!next) return;
    setMoreLoading(true);
    try {
      const page = await listSupportTickets({ ...filters, cursor: next });
      setExtra((cur) => ({ items: [...(cur?.items ?? []), ...page.items], next: page.next_cursor }));
    } finally {
      setMoreLoading(false);
    }
  };
  const notStaff = error instanceof ApiError && error.status === 403;

  return (
    <div>
      <PageHeader
        title="Support inbox"
        subtitle="Customer tickets with their SLA clock. Open one to reply and see the account behind it."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              value={status}
              onChange={setStatus}
              options={[{ value: 'all', label: 'All statuses' }, ...TICKET_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] }))]}
            />
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} disabled={!me} />
              Assigned to me
            </label>
            <button onClick={reload} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />

      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft.trim().slice(0, SUPPORT_SEARCH_MAX));
        }}
      >
        <SearchInput value={draft} onChange={setDraft} placeholder="Search subjects and messages…" className="w-full sm:w-80" />
        <button type="submit" className="btn btn-secondary btn-sm">
          Search
        </button>
        {search && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setDraft('');
              setSearch('');
            }}
          >
            Clear
          </button>
        )}
      </form>

      <SectionCard>
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading tickets…</div>
        ) : notStaff ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            You are not on the support roster. A support manager adds staff in apid&apos;s support settings.
          </div>
        ) : error ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
            {error.message || 'Could not load tickets.'}
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">No tickets match.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assignee</th>
                  <th>Due next</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <TicketRow key={t.ticket.id} t={t} me={me} onOpen={() => router.push(supportTicketHref(t.ticket.id))} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-foot">
          <span>{items.length} shown</span>
          {next && (
            <button className="btn btn-secondary btn-xs" disabled={moreLoading} onClick={() => void loadMore()}>
              {moreLoading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function TicketRow({ t, me, onOpen }: { t: StaffTicket; me?: string; onOpen: () => void }) {
  const due = nextDue(t.episode, t.ticket.status);
  const overdue = due ? isOverdue(due.at) : false;
  return (
    <tr {...rowOpener(onOpen, `Open ticket ${t.ticket.subject}`)}>
      <td>
        <Link href={supportTicketHref(t.ticket.id)} className="cell-primary hover:underline">
          {t.ticket.subject}
        </Link>
        {!!t.ticket.unread_count && <span className="badge badge-info ml-2">{t.ticket.unread_count} new</span>}
        <div className="text-[11px] text-[var(--color-ink-muted)]">
          {t.ticket.category} · {t.episode.plan}
        </div>
      </td>
      <td className="nowrap">
        <StatusBadge status={t.ticket.status} />
      </td>
      <td className="nowrap">
        <PriorityBadge priority={t.priority} />
      </td>
      <td className="nowrap">
        <Assignee id={t.assignee_id} me={me} />
      </td>
      <td className="nowrap">
        {due ? (
          <span className={overdue ? 'font-medium text-[var(--color-danger)]' : ''} title={due.at}>
            {due.label} {overdue ? `overdue ${relativeTime(due.at)}` : relativeTime(due.at)}
          </span>
        ) : t.episode.wait_since ? (
          <span className="text-[var(--color-ink-muted)]">Paused, waiting on customer</span>
        ) : (
          <span className="text-[var(--color-ink-muted)]">—</span>
        )}
      </td>
      <td className="nowrap" title={t.ticket.updated_at}>
        {relativeTime(t.ticket.updated_at)}
      </td>
    </tr>
  );
}
