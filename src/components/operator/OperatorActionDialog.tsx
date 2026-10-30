'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ApiError, newIdempotencyKey } from '@/lib/api';
import { reasonError, toReasonCode } from '@/lib/operator';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export interface OperatorActionContext {
  reason: string;
  /** Stable for this dialog session and these inputs; reuse on retry. */
  idempotencyKey: string;
}

export interface OperatorActionDialogProps {
  open: boolean;
  title: string;
  /** What will happen and to whom. Shown above the inputs. */
  impact: React.ReactNode;
  tone?: 'danger' | 'warning' | 'default';
  /**
   * 'code' for lifecycle/recovery endpoints ([a-z0-9_]{1,64}), 'text' for
   * billing and config writes, 'none' when the endpoint takes no reason.
   */
  reason: 'code' | 'text' | 'none';
  reasonSuggestions?: readonly string[];
  /** When set, the operator must type this exact value to enable submit. */
  confirmText?: string;
  submitLabel: string;
  /** Extra inputs (amount, invoice, target id …). */
  children?: React.ReactNode;
  /** False while the extra inputs are incomplete or invalid. */
  canSubmit?: boolean;
  /**
   * Identity of the request body. A new key is minted when it changes, so an
   * edited request is never replayed under the key of a different one.
   */
  fingerprint?: string;
  /** Resolve with a success message (toasted) or throw to keep the dialog open. */
  onSubmit: (ctx: OperatorActionContext) => Promise<string | void>;
  onClose: () => void;
}

/**
 * Keys of requests that were sent but not confirmed (timeout, network error,
 * 5xx). Kept outside the component so closing the dialog and trying the same
 * request again — same action, target, inputs and reason — replays it under
 * the original key instead of applying it twice. Cleared on success.
 */
const UNCONFIRMED_KEY_TTL_MS = 30 * 60 * 1000;
const unconfirmedKeys = new Map<string, { key: string; at: number }>();

function keyFor(identity: string): string {
  const now = Date.now();
  for (const [id, entry] of unconfirmedKeys) {
    if (now - entry.at > UNCONFIRMED_KEY_TTL_MS) unconfirmedKeys.delete(id);
  }
  const existing = unconfirmedKeys.get(identity);
  if (existing) return existing.key;
  const key = newIdempotencyKey();
  unconfirmedKeys.set(identity, { key, at: now });
  return key;
}

/**
 * The one way the console performs a write against another tenant's
 * resources or the fleet: explicit impact text, a required audited reason,
 * optional typed confirmation, double-submit protection, and an idempotency
 * key that survives retries (and the step-up prompt) for the same request.
 */
export function OperatorActionDialog({
  open,
  title,
  impact,
  tone = 'default',
  reason: reasonFormat,
  reasonSuggestions = [],
  confirmText,
  submitLabel,
  children,
  canSubmit = true,
  fingerprint = '',
  onSubmit,
  onClose,
}: OperatorActionDialogProps) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setReason('');
      setTyped('');
      setError(null);
      setTouched(false);
      setBusy(false);
    });
  }, [open]);

  const reasonProblem = reasonFormat === 'none' ? null : reasonError(reason, reasonFormat);
  const confirmed = !confirmText || typed.trim() === confirmText;
  const ready = !busy && canSubmit && !reasonProblem && confirmed;

  const identity = useMemo(() => [title, fingerprint, reason.trim()].join('\u0000'), [title, fingerprint, reason]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!ready) return;
    const idempotencyKey = keyFor(identity);
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit({ reason: reason.trim(), idempotencyKey });
      unconfirmedKeys.delete(identity);
      setBusy(false);
      if (message) toast.success(message);
      onClose();
    } catch (err) {
      // A 4xx means the server answered and did not apply it; a fresh key is right next time.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.code !== 'step_up_required') {
        unconfirmedKeys.delete(identity);
      }
      setBusy(false);
      const detail =
        err instanceof ApiError && err.code === 'step_up_required'
          ? 'Verification was cancelled, so nothing was changed.'
          : (err as Error).message;
      setError(detail);
    }
  };

  const submitClass = tone === 'danger' ? 'btn-danger' : tone === 'warning' ? 'btn-warning' : 'btn-primary';

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} width={520}>
      <form onSubmit={submit} className="space-y-4">
        <div
          className={`rounded-lg border p-3 text-sm ${
            tone === 'danger'
              ? 'border-[#f5d5d5] bg-[var(--color-danger-subtle)]'
              : tone === 'warning'
                ? 'border-[#f2e2bd] bg-[var(--color-warning-subtle)]'
                : 'border-[var(--color-line)] bg-[var(--color-surface-subtle)]'
          }`}
        >
          {impact}
        </div>

        {children}

        {reasonFormat !== 'none' && (
          <div>
            <label className="label" htmlFor="operator-action-reason">
              Reason {reasonFormat === 'code' ? '(code, recorded in the audit log)' : '(recorded in the audit log)'}
            </label>
            {reasonFormat === 'code' ? (
              <input
                id="operator-action-reason"
                className="field field-sm font-mono"
                value={reason}
                onChange={(event) => setReason(toReasonCode(event.target.value))}
                onBlur={() => setTouched(true)}
                placeholder="e.g. planned_maintenance"
                autoComplete="off"
              />
            ) : (
              <textarea
                id="operator-action-reason"
                className="field field-sm"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="Why is this change needed? Reference the ticket or incident."
              />
            )}
            {reasonSuggestions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {reasonSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="badge badge-neutral cursor-pointer font-mono hover:border-[var(--color-line-strong)]"
                    onClick={() => setReason(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {touched && reasonProblem && <p className="mt-1 text-xs text-[var(--color-danger)]">{reasonProblem}</p>}
          </div>
        )}

        {confirmText && (
          <div>
            <label className="label" htmlFor="operator-action-confirm">
              Type <span className="font-mono text-[var(--color-ink)]">{confirmText}</span> to confirm
            </label>
            <input
              id="operator-action-confirm"
              className="field field-sm font-mono"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-[var(--color-danger-subtle)] p-2 text-xs text-[var(--color-danger)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`btn btn-sm ${submitClass}`} disabled={!ready}>
            {busy ? 'Working…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
