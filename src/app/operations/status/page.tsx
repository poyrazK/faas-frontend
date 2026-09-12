'use client';

import React from 'react';
import { ApiError, listAdminStatusEvents, type AdminStatusEvent } from '@/lib/api';
import { isTerminalState } from '@/lib/status-events';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState } from '@/components/ui/States';
import { relativeTime } from '@/lib/format';

/**
 * Status-page authoring.
 *
 * Its own section rather than a tab under Incident Center: that page is
 * internal telemetry, and publishing to customers is a different act with a
 * different audience. Everything written here is public the moment it is sent,
 * and the API has no edit or delete — so this page renders no affordance that
 * suggests otherwise.
 */

function EventRow({ event }: { event: AdminStatusEvent }) {
  const open = !isTerminalState(event.state);
  const latest = event.updates[event.updates.length - 1];
  return (
    <li className="flex flex-col gap-2 border-b border-[var(--color-line)] py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase text-[var(--color-ink-muted)]">{event.kind}</span>
        <span className="flex-1 text-sm">{event.title}</span>
        <Mono>{event.state}</Mono>
        <span className="text-xs text-[var(--color-ink-muted)]">
          {relativeTime(event.updated_at)}
        </span>
        {/* The real page, after the fact. A content preview cannot show layout
            — the public list hides a resolved event's message entirely — so the
            way to see the truth is to look at it. */}
        <a
          href={`https://gregale.dev/status/incidents/${event.public_id}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline"
        >
          view on status page
        </a>
      </div>
      {latest && <p className="text-xs text-[var(--color-ink-muted)]">{latest.message}</p>}
      {open && <p className="text-xs text-[var(--color-ink-muted)]">Open — post an update below.</p>}
    </li>
  );
}

export default function StatusPage() {
  const events = useAsync(listAdminStatusEvents, []);
  // 403 is not a failure to report: it is a fact about this session. Saying
  // "something went wrong" to someone who simply lacks operator scope sends
  // them debugging a working system.
  const forbidden = events.error instanceof ApiError && events.error.status === 403;

  if (forbidden) {
    return (
      <div>
        <PageHeader title="Status Page" />
        <SectionCard>
          <EmptyState
            title="Operator access required"
            hint="Publishing to the status page needs an operator session."
          />
        </SectionCard>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Status Page"
        subtitle="Publish incidents and schedule maintenance. Everything here is public immediately."
      />
      <SectionCard title="Published events">
        <AsyncBoundary
          state={events}
          isEmpty={(rows) => rows.length === 0}
          empty={<EmptyState title="Nothing published" hint="The status page is clear." />}
        >
          {(rows) => (
            <ul className="flex flex-col">
              {rows.map((event) => (
                <EventRow key={event.public_id} event={event} />
              ))}
            </ul>
          )}
        </AsyncBoundary>
      </SectionCard>
    </div>
  );
}
