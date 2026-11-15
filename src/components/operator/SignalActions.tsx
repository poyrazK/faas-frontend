'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ATTENTION_KIND_LABELS,
  contactCustomer,
  DISMISS_NOTE_MAX,
  DISMISS_OUTCOME_LABELS,
  DISMISS_OUTCOMES,
  dismissSignal,
  getContactDraft,
  kindLabel,
  type ObsAttentionContactDraft,
  type ObsAttentionSignal,
} from '@/lib/ops/accountHealth';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { Mono } from '@/components/ui/bits';

/* Contact a stuck customer or dismiss their signal with an outcome
   (apid ADR-20261113180000, ADR-20261115120000). Both are stepped-up,
   idempotent operator writes; apid records the outcome either way. */
export function SignalActions({ signal, onDone }: { signal: ObsAttentionSignal; onDone: () => void }) {
  const [open, setOpen] = useState<'contact' | 'dismiss' | null>(null);
  // The dialog closes itself after a successful write; refresh the list then,
  // not while the dialog is still showing its result.
  const changed = useRef(false);
  if (signal.state !== 'open' && open === null) return null;
  const close = () => {
    setOpen(null);
    if (changed.current) {
      changed.current = false;
      onDone();
    }
  };
  const done = () => {
    changed.current = true;
  };
  return (
    <span className="inline-flex gap-1.5 whitespace-nowrap">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen('contact')}>
        Contact
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen('dismiss')}>
        Dismiss
      </button>
      {open === 'dismiss' && <DismissDialog signal={signal} onClose={close} onDone={done} />}
      {open === 'contact' && <ContactDialog signal={signal} onClose={close} onDone={done} />}
    </span>
  );
}

function SignalSummary({ signal }: { signal: ObsAttentionSignal }) {
  return (
    <p>
      <strong>{kindLabel(ATTENTION_KIND_LABELS, signal.kind)}</strong> on <Mono>{signal.subject}</Mono>
      {signal.detail ? `: ${signal.detail}` : ''}
    </p>
  );
}

function DismissDialog({ signal, onClose, onDone }: { signal: ObsAttentionSignal; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState<string>('');
  const [note, setNote] = useState('');
  return (
    <OperatorActionDialog
      open
      title="Dismiss signal"
      reason="none"
      submitLabel="Dismiss"
      canSubmit={!!outcome && note.length <= DISMISS_NOTE_MAX}
      fingerprint={JSON.stringify({ id: signal.id, outcome, note })}
      impact={
        <div className="space-y-1.5 text-xs">
          <SignalSummary signal={signal} />
          <p>The signal closes with this outcome. If it was shown to the customer, it disappears from their account health page.</p>
        </div>
      }
      onSubmit={async ({ idempotencyKey }) => {
        await dismissSignal(signal.id, outcome, note, { idempotencyKey });
        onDone();
        return 'Signal dismissed';
      }}
      onClose={onClose}
    >
      <label className="block">
        <span className="label">Outcome</span>
        <select className="field field-sm" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Choose an outcome…</option>
          {DISMISS_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {DISMISS_OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block">
        <span className="label">Note (optional)</span>
        <input className="field field-sm" value={note} maxLength={DISMISS_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
      </label>
    </OperatorActionDialog>
  );
}

function ContactDialog({ signal, onClose, onDone }: { signal: ObsAttentionSignal; onClose: () => void; onDone: () => void }) {
  const [draft, setDraft] = useState<ObsAttentionContactDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    let live = true;
    getContactDraft(signal.id)
      .then((d) => {
        if (!live) return;
        setDraft(d);
        setSubject(d.subject);
        setCategory(d.category);
        setBody(d.body);
      })
      .catch((err: Error) => live && setLoadError(err.message || 'Could not load the draft.'));
    return () => {
      live = false;
    };
  }, [signal.id]);

  const valid = !!draft && subject.trim() !== '' && body.trim() !== '' &&
    subject.length <= draft.subject_max && body.length <= draft.body_max && draft.categories.includes(category);
  return (
    <OperatorActionDialog
      open
      title="Contact customer"
      reason="none"
      submitLabel="Send and open ticket"
      canSubmit={valid}
      fingerprint={JSON.stringify({ id: signal.id, subject, category, body })}
      impact={
        <div className="space-y-1.5 text-xs">
          <SignalSummary signal={signal} />
          <p>
            Opens a ticket in the customer&apos;s personal support scope with this message first, assigned to you and waiting
            for the customer. They are notified like any staff reply. Write only what they can see in their own dashboard.
          </p>
        </div>
      }
      onSubmit={async ({ idempotencyKey }) => {
        const out = await contactCustomer(signal.id, subject.trim(), category, body.trim(), { idempotencyKey });
        onDone();
        return out.ticket_id ? `Ticket ${out.ticket_id} opened` : 'Customer contacted';
      }}
      onClose={onClose}
    >
      {loadError ? (
        <p className="text-xs text-[var(--color-danger)]">{loadError}</p>
      ) : !draft ? (
        <p className="text-xs text-[var(--color-ink-muted)]">Loading the draft…</p>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="label">Subject</span>
            <input className="field field-sm" value={subject} maxLength={draft.subject_max} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Category</span>
            <select className="field field-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
              {draft.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Message</span>
            <textarea className="field" rows={7} value={body} maxLength={draft.body_max} onChange={(e) => setBody(e.target.value)} />
          </label>
        </div>
      )}
    </OperatorActionDialog>
  );
}
