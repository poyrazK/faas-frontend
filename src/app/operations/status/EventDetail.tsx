'use client';

import React, { useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  appendAdminStatusUpdate,
  editAdminStatusEventTitle,
  editAdminStatusUpdateMessage,
  type AdminStatusEventUpdateRequest,
  type PublicStatusEvent,
  type StatusImpact,
  type StatusLifecycle,
} from '@/lib/ops/status';
import {
  componentNames,
  humanizeState,
  IMPACT_LABELS,
  INCIDENT_IMPACTS,
  isTerminalState,
  MESSAGE_MAX,
  messageError,
  nextStates,
  PREVIEW_ID,
  previewMessageEdit,
  previewTitle,
  previewUpdated,
  statusPermalink,
  STATUS_COMPONENTS,
  TITLE_MAX,
  titleError,
  toUpdateRequest,
  validateUpdate,
  type UpdateDraft,
} from '@/lib/ops/status-events';
import { relativeTime } from '@/lib/format';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { StatusPreview } from './StatusPreview';

type Correction = { type: 'title'; text: string } | { type: 'message'; updateId: string; text: string };

export function stateBadgeClass(event: PublicStatusEvent): string {
  if (isTerminalState(event.state)) return 'badge-neutral';
  if (event.kind === 'maintenance') return event.state === 'in_progress' ? 'badge-warning' : 'badge-info';
  return event.impact === 'major_outage' ? 'badge-danger' : 'badge-warning';
}

export function EventDetail({
  event,
  live,
  draft,
  setDraft,
  onWritten,
  onStale,
  onClose,
}: {
  event: PublicStatusEvent;
  live: readonly { id: string; name: string }[];
  draft: UpdateDraft;
  setDraft: (draft: UpdateDraft | null) => void;
  /** The event apid returned; the page merges it into the list. */
  onWritten: (event: PublicStatusEvent) => void;
  /** A write was refused because the event moved on; refetch. */
  onStale: () => void;
  onClose: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState<{ body: AdminStatusEventUpdateRequest; preview: PublicStatusEvent } | null>(null);
  const [correction, setCorrection] = useState<Correction | null>(null);

  const closed = isTerminalState(event.state);
  const states = nextStates(event.kind, event.state);
  const errors = validateUpdate(event, draft);
  const valid = Object.keys(errors).length === 0;
  const patch = (next: Partial<UpdateDraft>) => setDraft({ ...draft, ...next });
  const show = (field: keyof typeof errors) =>
    touched && errors[field] ? <p className="mt-1 text-xs text-[var(--color-danger)]">{errors[field]}</p> : null;

  const rethrow = (err: unknown): never => {
    if (err instanceof ApiError && (err.status === 409 || err.status === 404)) onStale();
    throw err;
  };

  const correctionError = correction ? (correction.type === 'title' ? titleError(correction.text) : messageError(correction.text)) : undefined;
  const correctionOriginal =
    correction?.type === 'title' ? event.title : correction ? event.updates.find((update) => update.id === correction.updateId)?.message ?? '' : '';
  const correctionChanged = correction ? correction.text.trim() !== correctionOriginal : false;

  return (
    <SectionCard
      title={
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-neutral">{event.kind === 'incident' ? 'Incident' : 'Maintenance'}</span>
          <h2 className="card-title">{event.title}</h2>
          <span className={`badge ${stateBadgeClass(event)}`}>{humanizeState(event.state)}</span>
          {event.edited_at && <span className="badge badge-neutral">edited</span>}
        </div>
      }
      className="mb-6"
      action={
        <div className="flex flex-wrap gap-2">
          <a href={statusPermalink(event.id)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            <Icon name="external" size={13} />
            View on status page
          </a>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCorrection({ type: 'title', text: event.title })}>
            Correct title…
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="grid gap-6 p-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5 text-sm">
          <div className="grid gap-3 text-xs sm:grid-cols-4">
            <Fact label="Impact" value={IMPACT_LABELS[event.impact] ?? event.impact} />
            <Fact label="Components" value={componentNames(event.components, live).join(', ')} />
            <Fact
              label={event.kind === 'maintenance' ? 'Window' : 'Started'}
              value={
                event.kind === 'maintenance'
                  ? `${event.scheduled_start_at ? new Date(event.scheduled_start_at).toLocaleString() : '—'} → ${
                      event.scheduled_end_at ? new Date(event.scheduled_end_at).toLocaleString() : '—'
                    }`
                  : event.starts_at
                    ? new Date(event.starts_at).toLocaleString()
                    : '—'
              }
            />
            <Fact label={event.resolved_at ? 'Closed' : 'Updated'} value={relativeTime(event.resolved_at ?? event.updated_at)} />
          </div>

          <div>
            <div className="label">Published timeline</div>
            <ol className="space-y-2">
              {[...event.updates]
                .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at))
                .map((update) => (
                  <li key={update.id} className="rounded-lg border border-[var(--color-line)] p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{humanizeState(update.state)}</strong>
                      <span className="text-[var(--color-ink-muted)]">
                        {new Date(update.posted_at).toLocaleString()}
                        {update.edited_at ? ` · edited ${relativeTime(update.edited_at)}` : ''}
                      </span>
                      {update.impact && <span className="badge badge-neutral">impact → {IMPACT_LABELS[update.impact] ?? update.impact}</span>}
                      {update.components?.length ? (
                        <span className="badge badge-neutral">components → {componentNames(update.components, live).join(', ')}</span>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs ml-auto"
                        onClick={() => setCorrection({ type: 'message', updateId: update.id, text: update.message })}
                      >
                        Correct…
                      </button>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{update.message}</p>
                  </li>
                ))}
            </ol>
          </div>

          {closed ? (
            <p className="rounded-lg bg-[var(--color-surface-subtle)] p-3 text-xs text-[var(--color-ink-muted)]">
              This event is closed ({humanizeState(event.state)}). Closed events cannot be reopened or updated; publish a new event if the
              problem returns. Titles and messages can still be corrected.
            </p>
          ) : (
            <div className="space-y-3 rounded-lg border border-[var(--color-line)] p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Post an update</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">New state</span>
                  <select className="field field-sm" value={draft.state} onChange={(e) => patch({ state: e.target.value as StatusLifecycle })}>
                    {states.map((state) => (
                      <option key={state} value={state}>
                        {humanizeState(state)}
                        {state === event.state ? ' (no change)' : isTerminalState(state) ? ' — closes the event' : ''}
                      </option>
                    ))}
                  </select>
                  {show('state')}
                </label>
                {event.kind === 'incident' && (
                  <label className="block">
                    <span className="label">Impact</span>
                    <select className="field field-sm" value={draft.impact} onChange={(e) => patch({ impact: e.target.value as StatusImpact })}>
                      {INCIDENT_IMPACTS.map((impact) => (
                        <option key={impact} value={impact}>
                          {IMPACT_LABELS[impact]}
                          {impact === event.impact ? ' (current)' : ''}
                        </option>
                      ))}
                    </select>
                    {show('impact')}
                  </label>
                )}
              </div>
              {draft.state === 'cancelled' && (
                <p className="text-xs text-[var(--color-warning-bold)]">
                  Cancelling closes this maintenance on the status page. It stays visible by its permalink.
                </p>
              )}
              <fieldset>
                <legend className="label">Affected components</legend>
                <div className="flex flex-wrap gap-3">
                  {STATUS_COMPONENTS.map(({ id, name }) => (
                    <label key={id} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={draft.components.includes(id)}
                        onChange={(e) =>
                          patch({ components: e.target.checked ? [...draft.components, id] : draft.components.filter((c) => c !== id) })
                        }
                      />
                      {live.find((component) => component.id === id)?.name ?? name}
                    </label>
                  ))}
                </div>
                {show('components')}
              </fieldset>
              <label className="block">
                <span className="label">
                  Message ({[...draft.message.trim()].length}/{MESSAGE_MAX})
                </span>
                <textarea
                  className="field field-sm"
                  rows={4}
                  value={draft.message}
                  placeholder="What changed since the last update."
                  onChange={(e) => patch({ message: e.target.value })}
                />
                {show('message')}
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setTouched(true);
                    if (!valid) return;
                    const body = toUpdateRequest(event, draft);
                    setConfirmUpdate({ body, preview: previewUpdated(event, body) });
                  }}
                >
                  Preview & publish…
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="label">What customers see now</div>
          <StatusPreview event={event} live={live} />
        </div>
      </div>

      {confirmUpdate && (
        <OperatorActionDialog
          open
          title={isTerminalState(confirmUpdate.body.state) ? `Close: ${event.title}` : `Update: ${event.title}`}
          tone={isTerminalState(confirmUpdate.body.state) || confirmUpdate.preview.impact === 'major_outage' ? 'danger' : 'warning'}
          reason="none"
          confirmText="publish"
          submitLabel={isTerminalState(confirmUpdate.body.state) ? 'Publish and close' : 'Publish update'}
          fingerprint={`status-update|${event.id}|${JSON.stringify(confirmUpdate.body)}`}
          impact={
            <div className="space-y-3">
              <p className="text-xs">
                Appends to the public timeline at once
                {isTerminalState(confirmUpdate.body.state) ? ' and closes the event; a closed event cannot be reopened' : ''}. The new entry
                is highlighted.
              </p>
              <StatusPreview event={confirmUpdate.preview} live={live} highlightUpdateId={PREVIEW_ID} />
            </div>
          }
          onClose={() => setConfirmUpdate(null)}
          onSubmit={async ({ idempotencyKey }) => {
            try {
              const updated = await appendAdminStatusUpdate(event.id, confirmUpdate.body, { idempotencyKey });
              setDraft(null);
              setTouched(false);
              onWritten(updated);
              return isTerminalState(updated.state) ? `"${updated.title}" is closed.` : `Update published to "${updated.title}".`;
            } catch (err) {
              return rethrow(err);
            }
          }}
        />
      )}

      {correction && (
        <OperatorActionDialog
          open
          title={correction.type === 'title' ? 'Correct the published title' : 'Correct a published message'}
          tone="warning"
          reason="none"
          confirmText="publish"
          submitLabel="Publish correction"
          canSubmit={!correctionError && correctionChanged}
          fingerprint={`status-correct|${event.id}|${correction.type === 'message' ? correction.updateId : 'title'}|${correction.text.trim()}`}
          impact={
            <div className="space-y-3">
              <p className="text-xs">
                Replaces the text customers read; the {correction.type === 'title' ? 'event' : 'entry'} is marked edited and keeps its
                place in the timeline.
              </p>
              <StatusPreview
                event={
                  correction.type === 'title'
                    ? previewTitle(event, correction.text)
                    : previewMessageEdit(event, correction.updateId, correction.text)
                }
                live={live}
                highlightUpdateId={correction.type === 'message' ? correction.updateId : undefined}
              />
            </div>
          }
          onClose={() => setCorrection(null)}
          onSubmit={async ({ idempotencyKey }) => {
            try {
              const updated =
                correction.type === 'title'
                  ? await editAdminStatusEventTitle(event.id, correction.text.trim(), { idempotencyKey })
                  : await editAdminStatusUpdateMessage(event.id, correction.updateId, correction.text.trim(), { idempotencyKey });
              onWritten(updated);
              return 'Correction published.';
            } catch (err) {
              return rethrow(err);
            }
          }}
        >
          <label className="block">
            <span className="label">
              {correction.type === 'title'
                ? `Title (${[...correction.text.trim()].length}/${TITLE_MAX})`
                : `Message (${[...correction.text.trim()].length}/${MESSAGE_MAX})`}
            </span>
            {correction.type === 'title' ? (
              <input
                className="field field-sm"
                value={correction.text}
                onChange={(e) => setCorrection({ ...correction, text: e.target.value })}
              />
            ) : (
              <textarea
                className="field field-sm"
                rows={4}
                value={correction.text}
                onChange={(e) => setCorrection({ ...correction, text: e.target.value })}
              />
            )}
            {correctionError && <p className="mt-1 text-xs text-[var(--color-danger)]">{correctionError}</p>}
          </label>
        </OperatorActionDialog>
      )}
    </SectionCard>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[var(--color-ink-muted)]">{label}</div>
      <div>{value}</div>
    </div>
  );
}
