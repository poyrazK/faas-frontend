'use client';

import React, { useState } from 'react';
import {
  ABUSE_HOLD_REASON_LABELS,
  abuseHoldNoteError,
  deriveAbuseHoldState,
  listAbuseHoldEvents,
  placeAccountAbuseHold,
  releaseAccountAbuseHold,
  type AccountAbuseHoldActionResponse,
} from '@/lib/ops/support';
import { relativeTime } from '@/lib/format';
import { Mono } from '@/components/ui/bits';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { Notice, PanelSection, RefreshButton, StaleNotice, formatDateTime, useKeyed } from './shared';

/**
 * ADR-361 account abuse hold: while held, the account cannot boot or deploy
 * anything. apid has no read endpoint for the current hold, so the panel
 * shows the authoritative state returned by this session's last place/release
 * and otherwise the most recent hold event in the events log.
 */
export function AbuseHoldPanel({ accountId }: { accountId: string }) {
  const history = useKeyed(accountId, (id) => listAbuseHoldEvents(id));
  const [result, setResult] = useState<{ res: AccountAbuseHoldActionResponse; at: number } | null>(null);
  const [action, setAction] = useState<'place' | 'release' | null>(null);

  const derived = history.data ? deriveAbuseHoldState(history.data) : null;
  // This session's place/release result is authoritative until a newer hold
  // event (e.g. the scheduler re-holding the account) appears in the log.
  const lastEvent = derived && derived.state !== 'none' ? derived.last : null;
  const newerEvent = !!result && !!lastEvent && Date.parse(lastEvent.at) > result.at;
  const confirmed = result && result.res.account_id === accountId && !newerEvent ? result.res : null;
  const looksHeld = confirmed ? confirmed.abuse_hold !== null : derived?.state === 'held';

  return (
    <PanelSection title="Abuse hold" actions={<RefreshButton onClick={history.reload} />}>
      <div className="space-y-2 rounded-lg border border-[var(--color-line)] p-3 text-xs">
        {confirmed ? (
          <div className="flex flex-wrap items-center gap-2">
            {confirmed.abuse_hold ? (
              <>
                <span className="badge badge-danger">Held</span>
                <span>
                  since {formatDateTime(confirmed.abuse_hold.held_at)} ·{' '}
                  {ABUSE_HOLD_REASON_LABELS[confirmed.abuse_hold.reason] ?? confirmed.abuse_hold.reason}
                </span>
              </>
            ) : (
              <span className="badge badge-success">Not held</span>
            )}
            <span className="text-[var(--color-ink-muted)]">
              Confirmed by the server after your last action{confirmed.changed ? '' : ' (no change was needed)'}.
            </span>
          </div>
        ) : history.error && !history.data ? (
          <Notice tone="danger">Could not read the hold history: {history.error.message}</Notice>
        ) : !derived ? (
          <div className="text-[var(--color-ink-muted)]">Loading hold history…</div>
        ) : derived.state === 'none' ? (
          <div className="text-[var(--color-ink-muted)]">
            No hold has been recorded for this account in the events log.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge ${derived.state === 'held' ? 'badge-danger' : 'badge-neutral'}`}>
              {derived.state === 'held' ? 'Last recorded: held' : 'Last recorded: released'}
            </span>
            <span>
              {relativeTime(derived.last.at)} by <Mono>{derived.last.actorEmail || derived.last.actor}</Mono>
              {derived.last.reason ? ` · ${ABUSE_HOLD_REASON_LABELS[derived.last.reason] ?? derived.last.reason}` : ''}
            </span>
          </div>
        )}
        {!confirmed && (
          <p className="text-[11px] text-[var(--color-ink-muted)]">
            The control plane exposes no read of the current hold; this is the newest hold event. Placing or releasing
            returns the authoritative state.
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className={`btn btn-xs ${looksHeld ? 'btn-secondary' : 'btn-danger'}`}
            onClick={() => setAction('place')}
          >
            Place hold…
          </button>
          <button
            type="button"
            className={`btn btn-xs ${looksHeld ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAction('release')}
          >
            Release hold…
          </button>
        </div>
      </div>

      {history.data && history.data.length > 0 && (
        <div className="mt-2 max-h-40 divide-y divide-[var(--color-line)] overflow-y-auto rounded-lg border border-[var(--color-line)] text-xs">
          {history.data.map((event) => (
            <div key={`${event.kind}:${event.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <span className={`badge ${event.action === 'placed' ? 'badge-danger' : 'badge-success'}`}>{event.action}</span>
                <span className="ml-2">{event.actorEmail || event.actor}</span>
                {event.reason && <span className="ml-2 text-[var(--color-ink-muted)]">{event.reason}</span>}
                {event.note && <div className="mt-0.5 truncate text-[var(--color-ink-muted)]">“{event.note}”</div>}
              </div>
              <span className="text-[var(--color-ink-muted)]" title={formatDateTime(event.at)}>
                {relativeTime(event.at)}
              </span>
            </div>
          ))}
        </div>
      )}
      {history.data && <StaleNotice error={history.stale ? history.error : null} label="the hold history" />}

      {action === 'place' && (
        <OperatorActionDialog
          open
          title="Place abuse hold"
          tone="danger"
          reason="text"
          confirmText={accountId.slice(0, 8)}
          submitLabel="Place hold"
          fingerprint={`abuse-hold|place|${accountId}`}
          impact={
            <span>
              Account <Mono>{accountId}</Mono> is refused every boot and deploy from the moment the hold commits, and
              the scheduler drains its running workloads on the next reaper pass. It stays down until an operator
              releases the hold. An existing hold keeps its original reason and time.
            </span>
          }
          onSubmit={async ({ reason, idempotencyKey }) => {
            const problem = abuseHoldNoteError(reason);
            if (problem) throw new Error(problem);
            const res = await placeAccountAbuseHold(accountId, reason, { idempotencyKey });
            setResult({ res, at: Date.now() });
            history.reload();
            history.reload();
            return res.changed ? 'Abuse hold placed.' : 'The account was already held; the existing hold was kept.';
          }}
          onClose={() => setAction(null)}
        />
      )}
      {action === 'release' && (
        <OperatorActionDialog
          open
          title="Release abuse hold"
          tone="warning"
          reason="text"
          submitLabel="Release hold"
          fingerprint={`abuse-hold|release|${accountId}`}
          impact={
            <span>
              Account <Mono>{accountId}</Mono> may boot and deploy again. Parked apps stay parked and wake normally on
              their next request.
            </span>
          }
          onSubmit={async ({ reason, idempotencyKey }) => {
            const problem = abuseHoldNoteError(reason);
            if (problem) throw new Error(problem);
            const res = await releaseAccountAbuseHold(accountId, reason, { idempotencyKey });
            setResult({ res, at: Date.now() });
            history.reload();
            history.reload();
            return res.changed ? 'Abuse hold released.' : 'The account was not held; nothing changed.';
          }}
          onClose={() => setAction(null)}
        />
      )}
    </PanelSection>
  );
}
