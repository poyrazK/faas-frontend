'use client';

import React, { useRef, useState } from 'react';
import {
  SUPPORT_BODY_MAX,
  SUPPORT_REASON_MAX,
  supportTicketAction,
  TICKET_PRIORITIES,
  type StaffTicket,
  type TicketChange,
  type TicketOp,
} from '@/lib/ops/supportInbox';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';

/* Staff actions on one ticket. Each is a stepped-up, idempotent write at the
   revision the operator was looking at; apid refuses it (409) if the ticket
   changed since, and agents may act only on tickets assigned to them (or
   claim an unassigned one); managers may act on any. */

const SAME = (a?: string, b?: string) => !!a && !!b && a.replaceAll('-', '') === b.replaceAll('-', '');

export function TicketActions({ ticket, me, onDone }: { ticket: StaffTicket; me?: string; onDone: () => void }) {
  const [open, setOpen] = useState<TicketOp | null>(null);
  const changed = useRef(false);
  const status = ticket.ticket.status;
  const resolved = status === 'resolved';
  const close = () => {
    setOpen(null);
    if (changed.current) {
      changed.current = false;
      onDone();
    }
  };
  const button = (op: TicketOp, label: string, primary = false) => (
    <button type="button" className={`btn btn-sm ${primary ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOpen(op)}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {!resolved && button('reply', 'Reply to customer', true)}
      {!resolved && button('note', 'Internal note')}
      {button('triage', SAME(ticket.assignee_id, me) ? 'Triage' : ticket.assignee_id ? 'Triage or reassign' : 'Assign to me')}
      {!resolved && !ticket.episode.wait_since && button('pause', 'Wait on customer')}
      {!resolved && !!ticket.episode.wait_since && button('resume', 'Stop waiting')}
      {!resolved && button('close', 'Resolve')}
      {resolved && button('reopen', 'Reopen')}
      {open && (
        <ActionDialog
          ticket={ticket}
          op={open}
          me={me}
          onClose={close}
          onDone={() => {
            changed.current = true;
          }}
        />
      )}
    </div>
  );
}

const TITLES: Record<TicketOp, { title: string; submit: string; impact: string }> = {
  reply: { title: 'Reply to customer', submit: 'Send reply', impact: 'The customer sees this message and is notified. It counts as a staff reply for the SLA.' },
  note: { title: 'Internal note', submit: 'Add note', impact: 'Only support staff see notes. The customer is not notified.' },
  triage: { title: 'Triage ticket', submit: 'Save', impact: 'Changes the priority and who owns the ticket. The reason is kept in the ticket history.' },
  pause: { title: 'Wait on customer', submit: 'Pause the clock', impact: 'Marks the ticket as waiting on the customer and pauses the SLA clock until they reply or you resume it.' },
  resume: { title: 'Stop waiting', submit: 'Resume the clock', impact: 'Restarts the SLA clock and marks the ticket open again.' },
  close: { title: 'Resolve ticket', submit: 'Resolve', impact: 'Closes the ticket and stops the SLA clock. The customer may reopen it within the reopen window.' },
  reopen: { title: 'Reopen ticket', submit: 'Reopen', impact: 'Starts a new SLA episode with this message to the customer and routes the ticket again.' },
};

function ActionDialog({ ticket, op, me, onClose, onDone }: { ticket: StaffTicket; op: TicketOp; me?: string; onClose: () => void; onDone: () => void }) {
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState(ticket.priority);
  const [owner, setOwner] = useState<'keep' | 'me' | 'route'>(ticket.assignee_id ? 'keep' : 'me');
  const [reason, setReason] = useState('');
  const t = TITLES[op];
  const needsBody = op === 'reply' || op === 'note' || op === 'reopen';
  const triage = op === 'triage';

  const change = (): TicketChange => {
    if (needsBody) return { body: body.trim() };
    if (!triage) return {};
    const out: TicketChange = { priority, reason: reason.trim(), required_skills: ticket.required_skills ?? [] };
    if (owner === 'route') out.route = true;
    else if (owner === 'me' && me) out.assignee_id = me;
    else if (owner === 'keep' && ticket.assignee_id) out.assignee_id = ticket.assignee_id;
    if (ticket.team_id && owner !== 'route') out.team_id = ticket.team_id;
    return out;
  };
  const valid = needsBody
    ? body.trim() !== '' && body.length <= SUPPORT_BODY_MAX
    : triage
      ? reason.trim() !== '' && reason.length <= SUPPORT_REASON_MAX && (owner !== 'me' || !!me)
      : true;

  return (
    <OperatorActionDialog
      open
      title={t.title}
      reason="none"
      submitLabel={t.submit}
      canSubmit={valid}
      fingerprint={JSON.stringify({ id: ticket.ticket.id, op, revision: ticket.ticket.revision, change: change() })}
      impact={
        <div className="space-y-1.5 text-xs">
          <p>
            <strong>{ticket.ticket.subject}</strong>
          </p>
          <p>{t.impact}</p>
        </div>
      }
      onSubmit={async ({ idempotencyKey }) => {
        await supportTicketAction(ticket.ticket.id, op, ticket.ticket.revision, change(), { idempotencyKey });
        onDone();
        return `${t.title}: done`;
      }}
      onClose={onClose}
    >
      {needsBody && (
        <label className="block">
          <span className="label">{op === 'note' ? 'Note' : 'Message to the customer'}</span>
          <textarea className="field" rows={7} value={body} maxLength={SUPPORT_BODY_MAX} onChange={(e) => setBody(e.target.value)} />
        </label>
      )}
      {triage && (
        <div className="space-y-3">
          <label className="block">
            <span className="label">Priority</span>
            <select className="field field-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Owner</span>
            <select className="field field-sm" value={owner} onChange={(e) => setOwner(e.target.value as typeof owner)}>
              {ticket.assignee_id && <option value="keep">Keep the current assignee</option>}
              {!ticket.assignee_id && <option value="keep">Leave unassigned</option>}
              <option value="me" disabled={!me}>
                Assign to me
              </option>
              <option value="route">Route automatically</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Reason</span>
            <input className="field field-sm" value={reason} maxLength={SUPPORT_REASON_MAX} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
      )}
    </OperatorActionDialog>
  );
}
