'use client';

import React, { useState } from 'react';
import {
  ApiError,
  createAdminStatusEvent,
  getPublicStatusSnapshot,
  listAdminStatusEvents,
  type AdminStatusEvent,
} from '@/lib/api';
import {
  defaultStateFor,
  emptyDraft,
  isTerminalState,
  resolveComponentNames,
  validateDraft,
  type StatusComponent,
  type StatusDraft,
  type StatusEventKind,
} from '@/lib/status-events';
import { useToast } from '@/components/ui/Toast';
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

const COMPONENTS: { id: StatusComponent; fallback: string }[] = [
  { id: 'api_console', fallback: 'API & Console' },
  { id: 'deployments', fallback: 'Deployments' },
  { id: 'app_execution', fallback: 'App execution' },
  { id: 'networking', fallback: 'Networking' },
  { id: 'observability', fallback: 'Observability' },
];

function Composer({ onPublished }: { onPublished: () => void }) {
  const toast = useToast();
  const snapshot = useAsync(getPublicStatusSnapshot, []);
  const [draft, setDraft] = useState<StatusDraft>(() => emptyDraft('incident'));
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const errors = validateDraft(draft);
  const names = resolveComponentNames(draft.components, snapshot.data?.components ?? []);

  async function publish() {
    setSubmitting(true);
    try {
      await createAdminStatusEvent({
        kind: draft.kind,
        title: draft.title.trim(),
        components: draft.components,
        message: draft.message.trim(),
        ...(draft.impact ? { impact: draft.impact } : {}),
        ...(draft.state ? { state: draft.state } : {}),
        ...(draft.scheduledStartAt
          ? { scheduled_start_at: new Date(draft.scheduledStartAt).toISOString() }
          : {}),
        ...(draft.scheduledEndAt
          ? { scheduled_end_at: new Date(draft.scheduledEndAt).toISOString() }
          : {}),
      });
      toast.success('Published to the status page.');
      // Clear only on success. A form still holding text that is already
      // public invites a double publish; a form emptied after a failure
      // loses a message written mid-incident.
      setDraft(emptyDraft(draft.kind));
      setPreviewing(false);
      onPublished();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publishing failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (previewing) {
    return (
      <SectionCard title="What customers will read">
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-xs uppercase text-[var(--color-ink-muted)]">{draft.kind}</p>
          <p className="font-medium">{draft.title}</p>
          <p className="text-xs text-[var(--color-ink-muted)]">
            Affected: {names.join(', ') || '—'}
          </p>
          <p>{draft.message}</p>
          {snapshot.error && (
            <p className="text-xs text-[var(--color-ink-muted)]">
              Component names could not be loaded; ids are shown instead.
            </p>
          )}
          <p className="text-xs text-[var(--color-ink-muted)]">
            This is a content preview, not the page&apos;s layout. Publishing is immediate and
            cannot be edited or deleted — corrections are posted as a further update.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={submitting} onClick={publish}>
              {submitting ? 'Publishing…' : 'Publish now'}
            </button>
            <button type="button" disabled={submitting} onClick={() => setPreviewing(false)}>
              Back to edit
            </button>
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Publish an event">
      <div className="flex flex-col gap-3 text-sm">
        <select
          value={draft.kind}
          onChange={(e) => {
            const kind = e.currentTarget.value as StatusEventKind;
            setDraft({ ...draft, kind, state: defaultStateFor(kind) });
          }}
        >
          <option value="incident">Incident</option>
          <option value="maintenance">Maintenance</option>
        </select>

        <input
          value={draft.title}
          placeholder="Title"
          onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
        />
        {errors.title && <p className="text-xs text-[var(--color-danger)]">{errors.title}</p>}

        <fieldset className="flex flex-wrap gap-3">
          {COMPONENTS.map(({ id, fallback }) => (
            <label key={id} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={draft.components.includes(id)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    components: e.currentTarget.checked
                      ? [...draft.components, id]
                      : draft.components.filter((c) => c !== id),
                  })
                }
              />
              {snapshot.data?.components.find((c) => c.id === id)?.name ?? fallback}
            </label>
          ))}
        </fieldset>
        {errors.components && (
          <p className="text-xs text-[var(--color-danger)]">{errors.components}</p>
        )}

        {draft.kind === 'maintenance' && (
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs">
              Starts
              <input
                type="datetime-local"
                value={draft.scheduledStartAt ?? ''}
                onChange={(e) => setDraft({ ...draft, scheduledStartAt: e.currentTarget.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Ends
              <input
                type="datetime-local"
                value={draft.scheduledEndAt ?? ''}
                onChange={(e) => setDraft({ ...draft, scheduledEndAt: e.currentTarget.value })}
              />
            </label>
          </div>
        )}
        {errors.scheduledStartAt && (
          <p className="text-xs text-[var(--color-danger)]">{errors.scheduledStartAt}</p>
        )}

        <textarea
          value={draft.message}
          placeholder="What customers should know"
          rows={4}
          onChange={(e) => setDraft({ ...draft, message: e.currentTarget.value })}
        />
        {errors.message && <p className="text-xs text-[var(--color-danger)]">{errors.message}</p>}

        <button
          type="button"
          disabled={Object.keys(errors).length > 0}
          onClick={() => setPreviewing(true)}
        >
          Preview
        </button>
      </div>
    </SectionCard>
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
      <Composer onPublished={events.reload} />
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
