'use client';

import React, { useState } from 'react';
import { createAdminStatusEvent, type IncidentImpact, type PublicStatusEvent, type StatusLifecycle } from '@/lib/ops/status';
import {
  humanizeState,
  IMPACT_LABELS,
  INCIDENT_IMPACTS,
  INCIDENT_OPEN_STATES,
  MESSAGE_MAX,
  previewCreated,
  STATUS_COMPONENTS,
  switchDraftKind,
  TITLE_MAX,
  toCreateRequest,
  validateDraft,
  type StatusDraft,
} from '@/lib/ops/status-events';
import { SectionCard } from '@/components/ui/Panels';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { StatusPreview } from './StatusPreview';

const utcHint = (local?: string) => {
  if (!local) return null;
  const ms = Date.parse(local);
  return Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC` : null;
};

/**
 * Publishes an incident or schedules maintenance. The draft survives a failed
 * publish (it was written mid-incident) and is cleared only on success, so a
 * form still holding already-public text cannot invite a double publish.
 */
export function StatusComposer({
  draft,
  setDraft,
  live,
  onPublished,
  onClose,
}: {
  draft: StatusDraft;
  setDraft: (draft: StatusDraft | null) => void;
  live: readonly { id: string; name: string }[];
  onPublished: (event: PublicStatusEvent) => void;
  onClose: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState<{ body: ReturnType<typeof toCreateRequest>; preview: PublicStatusEvent } | null>(null);
  const errors = validateDraft(draft);
  const valid = Object.keys(errors).length === 0;
  const show = (field: keyof typeof errors) =>
    touched && errors[field] ? <p className="mt-1 text-xs text-[var(--color-danger)]">{errors[field]}</p> : null;
  const patch = (next: Partial<StatusDraft>) => setDraft({ ...draft, ...next });

  return (
    <SectionCard
      title={draft.kind === 'incident' ? 'Publish an incident' : 'Schedule maintenance'}
      className="mb-6"
      action={
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Close (keeps the draft)
        </button>
      }
    >
      <div className="grid gap-6 p-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4 text-sm">
          <div className="flex gap-2">
            {(['incident', 'maintenance'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={`btn btn-sm ${draft.kind === kind ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => draft.kind !== kind && setDraft(switchDraftKind(draft, kind))}
              >
                {kind === 'incident' ? 'Incident' : 'Maintenance'}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="label">Title ({[...draft.title.trim()].length}/{TITLE_MAX})</span>
            <input className="field field-sm" value={draft.title} onChange={(event) => patch({ title: event.target.value })} />
            {show('title')}
          </label>

          {draft.kind === 'incident' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="label">Impact</span>
                <select
                  className="field field-sm"
                  value={draft.impact ?? ''}
                  onChange={(event) => patch({ impact: (event.target.value || undefined) as IncidentImpact | undefined })}
                >
                  <option value="">Choose…</option>
                  {INCIDENT_IMPACTS.map((impact) => (
                    <option key={impact} value={impact}>
                      {IMPACT_LABELS[impact]}
                    </option>
                  ))}
                </select>
                {show('impact')}
              </label>
              <label className="block">
                <span className="label">State</span>
                <select
                  className="field field-sm"
                  value={draft.state}
                  onChange={(event) => patch({ state: event.target.value as StatusLifecycle })}
                >
                  {INCIDENT_OPEN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {humanizeState(state)}
                    </option>
                  ))}
                </select>
                {show('state')}
              </label>
              <label className="block">
                <span className="label">Started (optional)</span>
                <input
                  type="datetime-local"
                  className="field field-sm"
                  value={draft.startsAt ?? ''}
                  onChange={(event) => patch({ startsAt: event.target.value || undefined })}
                />
                <span className="mt-1 block text-[11px] text-[var(--color-ink-muted)]">
                  {utcHint(draft.startsAt) ?? 'Defaults to the moment you publish.'}
                </span>
                {show('startsAt')}
              </label>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Window starts (your time)</span>
                <input
                  type="datetime-local"
                  className="field field-sm"
                  value={draft.scheduledStartAt ?? ''}
                  onChange={(event) => patch({ scheduledStartAt: event.target.value || undefined })}
                />
                {utcHint(draft.scheduledStartAt) && (
                  <span className="mt-1 block text-[11px] text-[var(--color-ink-muted)]">Customers see {utcHint(draft.scheduledStartAt)}</span>
                )}
                {show('scheduledStartAt')}
              </label>
              <label className="block">
                <span className="label">Window ends (your time)</span>
                <input
                  type="datetime-local"
                  className="field field-sm"
                  value={draft.scheduledEndAt ?? ''}
                  onChange={(event) => patch({ scheduledEndAt: event.target.value || undefined })}
                />
                {utcHint(draft.scheduledEndAt) && (
                  <span className="mt-1 block text-[11px] text-[var(--color-ink-muted)]">Customers see {utcHint(draft.scheduledEndAt)}</span>
                )}
                {show('scheduledEndAt')}
              </label>
            </div>
          )}

          <fieldset>
            <legend className="label">Affected components</legend>
            <div className="flex flex-wrap gap-3">
              {STATUS_COMPONENTS.map(({ id, name }) => (
                <label key={id} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={draft.components.includes(id)}
                    onChange={(event) =>
                      patch({ components: event.target.checked ? [...draft.components, id] : draft.components.filter((c) => c !== id) })
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
              Message to customers ({[...draft.message.trim()].length}/{MESSAGE_MAX})
            </span>
            <textarea
              className="field field-sm"
              rows={5}
              value={draft.message}
              placeholder="What is affected, what customers may notice, and when the next update will come."
              onChange={(event) => patch({ message: event.target.value })}
            />
            {show('message')}
          </label>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              Discard draft
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setTouched(true);
                if (!valid) return;
                const body = toCreateRequest(draft);
                setConfirming({ body, preview: previewCreated(body) });
              }}
            >
              Preview & publish…
            </button>
          </div>
        </div>

        <div>
          <div className="label">Live preview</div>
          {valid ? (
            <StatusPreview event={previewCreated(toCreateRequest(draft))} live={live} />
          ) : (
            <p className="text-xs text-[var(--color-ink-muted)]">The preview appears once the draft is complete.</p>
          )}
        </div>
      </div>

      {confirming && (
        <OperatorActionDialog
          open
          title={confirming.body.kind === 'incident' ? 'Publish incident' : 'Publish maintenance'}
          tone={confirming.body.impact === 'major_outage' ? 'danger' : 'warning'}
          reason="none"
          confirmText="publish"
          submitLabel="Publish to status page"
          fingerprint={`status-create|${JSON.stringify(confirming.body)}`}
          impact={
            <div className="space-y-3">
              <p className="text-xs">
                Customers see this on gregale.dev/status the moment you publish. The event cannot be deleted: a wrong title or message
                can be corrected (it is marked edited), and a mistaken event can only be closed.
              </p>
              <StatusPreview event={confirming.preview} live={live} />
            </div>
          }
          onClose={() => setConfirming(null)}
          onSubmit={async ({ idempotencyKey }) => {
            // On failure the dialog shows the error and the draft stays.
            const event = await createAdminStatusEvent(confirming.body, { idempotencyKey });
            setDraft(null);
            onPublished(event);
            return `Published "${event.title}" to the status page.`;
          }}
        />
      )}
    </SectionCard>
  );
}
