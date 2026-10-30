'use client';

import React from 'react';
import {
  forceColdBootApp,
  issueAccountCredit,
  reconcileAccount,
  refundAccount,
  restoreObsAccount,
  revokeObsAccountSessions,
  suspendObsAccount,
  type ObsInvoiceSummary,
} from '@/lib/api';
import { formatCents, gbHours, parseMoneyAmount, REASON_SUGGESTIONS } from '@/lib/operator';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';

/** Every write the tenant workspace can start; each opens one audited dialog. */
export type TenantAction =
  | { type: 'suspend' | 'restore' | 'revoke-sessions' | 'credit' | 'reconcile' }
  | { type: 'refund'; invoice: ObsInvoiceSummary }
  | { type: 'cold-boot'; slug: string };

/** Pre-filled amount for a newly opened action (the paid total for refunds). */
export const initialActionAmount = (action: TenantAction) =>
  action.type === 'refund' ? ((action.invoice.amount_paid_cents || action.invoice.total_cents) / 100).toFixed(2) : '';

export function TenantActionDialog({
  action,
  tenantId,
  accountLabel,
  currency,
  amount,
  setAmount,
  onClose,
  onDone,
  trackColdBoot,
}: {
  action: TenantAction;
  tenantId: string;
  accountLabel: string;
  currency?: string;
  amount: string;
  setAmount: (value: string) => void;
  onClose: () => void;
  onDone: () => void;
  trackColdBoot: (intentId: string, slug: string) => void;
}) {
  const cents = parseMoneyAmount(amount);
  const refundCap = action.type === 'refund' ? action.invoice.amount_paid_cents || action.invoice.total_cents : 0;
  const money = (value: number) => formatCents(value, currency);

  const common = { open: true, onClose };
  switch (action.type) {
    case 'suspend':
      return (
        <OperatorActionDialog
          {...common}
          title="Suspend account"
          tone="danger"
          reason="code"
          reasonSuggestions={REASON_SUGGESTIONS.account}
          confirmText={accountLabel}
          submitLabel="Suspend"
          fingerprint={`suspend|${tenantId}`}
          impact="Blocks sign-in and API access, revokes every dashboard session, and stops the account's apps from waking. Restorable."
          onSubmit={async ({ reason, idempotencyKey }) => {
            const res = await suspendObsAccount(tenantId, reason, { idempotencyKey });
            onDone();
            return `Account suspended; ${res.revoked_sessions} session(s) revoked.`;
          }}
        />
      );
    case 'restore':
      return (
        <OperatorActionDialog
          {...common}
          title="Restore account"
          reason="code"
          reasonSuggestions={REASON_SUGGESTIONS.account}
          submitLabel="Restore"
          fingerprint={`restore|${tenantId}`}
          impact="Re-enables sign-in, API access and app wakes for this account."
          onSubmit={async ({ reason, idempotencyKey }) => {
            await restoreObsAccount(tenantId, reason, { idempotencyKey });
            onDone();
            return 'Account restored.';
          }}
        />
      );
    case 'revoke-sessions':
      return (
        <OperatorActionDialog
          {...common}
          title="Revoke all sessions"
          tone="warning"
          reason="code"
          reasonSuggestions={REASON_SUGGESTIONS.account}
          submitLabel="Revoke sessions"
          fingerprint={`revoke|${tenantId}`}
          impact="Signs the customer out of every dashboard session. API keys keep working."
          onSubmit={async ({ reason, idempotencyKey }) => {
            const res = await revokeObsAccountSessions(tenantId, reason, { idempotencyKey });
            onDone();
            return `${res.revoked_sessions} session(s) revoked.`;
          }}
        />
      );
    case 'credit':
      return (
        <OperatorActionDialog
          {...common}
          title="Issue credit"
          tone="warning"
          reason="text"
          submitLabel={cents ? `Issue ${money(cents)}` : 'Issue credit'}
          canSubmit={cents !== null}
          fingerprint={`credit|${tenantId}|${cents}`}
          impact="Adds a credit the billing provider applies to this account's next invoices."
          onSubmit={async ({ reason, idempotencyKey }) => {
            if (cents === null) throw new Error('Enter an amount.');
            const res = await issueAccountCredit(tenantId, cents, reason, { idempotencyKey });
            onDone();
            return `Credit issued: ${money(cents)} (balance ${money(res.cents_remaining)}).`;
          }}
        >
          <AmountField amount={amount} setAmount={setAmount} currency={currency} invalid={amount !== '' && cents === null} />
        </OperatorActionDialog>
      );
    case 'refund':
      return (
        <OperatorActionDialog
          {...common}
          title={`Refund invoice ${action.invoice.number || action.invoice.id}`}
          tone="danger"
          reason="text"
          confirmText={action.invoice.number || action.invoice.id}
          submitLabel={cents ? `Refund ${money(cents)}` : 'Refund'}
          canSubmit={cents !== null && cents <= refundCap}
          fingerprint={`refund|${tenantId}|${action.invoice.id}|${cents}`}
          impact={
            <span>
              Sends a refund to the billing provider. This moves money and cannot be undone. Paid on this invoice:{' '}
              <strong>{money(refundCap)}</strong>; the provider rejects amounts above what is still refundable.
            </span>
          }
          onSubmit={async ({ reason, idempotencyKey }) => {
            if (cents === null) throw new Error('Enter an amount.');
            const res = await refundAccount(tenantId, action.invoice.id, cents, reason, { idempotencyKey });
            onDone();
            return `Refund ${res.status}: ${formatCents(res.amount_cents, res.currency)} (${res.provider_refund_id}).`;
          }}
        >
          <AmountField
            amount={amount}
            setAmount={setAmount}
            currency={currency}
            invalid={amount !== '' && (cents === null || cents > refundCap)}
            hint={`Up to ${money(refundCap)}`}
          />
        </OperatorActionDialog>
      );
    case 'reconcile':
      return (
        <OperatorActionDialog
          {...common}
          title="Reconcile usage"
          reason="none"
          submitLabel="Reconcile"
          fingerprint={`reconcile|${tenantId}`}
          impact="Recomputes this account's metered usage for the current billing period from raw meter rows."
          onSubmit={async ({ idempotencyKey }) => {
            const res = await reconcileAccount(tenantId, { idempotencyKey });
            onDone();
            return `Reconciled ${gbHours(res.mb_seconds).toFixed(2)} GB-h for ${new Date(res.start).toLocaleDateString()} – ${new Date(res.end).toLocaleDateString()}.`;
          }}
        />
      );
    case 'cold-boot':
      return (
        <OperatorActionDialog
          {...common}
          title={`Force cold boot: ${action.slug}`}
          tone="warning"
          reason="code"
          reasonSuggestions={REASON_SUGGESTIONS.instance}
          submitLabel="Force cold boot"
          fingerprint={`cold-boot|${action.slug}`}
          impact="Marks this app's warm and init snapshots stale; every next wake cold boots. Use after a bad snapshot."
          onSubmit={async ({ reason, idempotencyKey }) => {
            const res = await forceColdBootApp(action.slug, reason, { idempotencyKey });
            trackColdBoot(res.intent_id, action.slug);
            return `Cold boot queued for ${action.slug}; follow it under Emergency Controls.`;
          }}
        />
      );
  }
}

function AmountField({
  amount,
  setAmount,
  currency,
  invalid,
  hint,
}: {
  amount: string;
  setAmount: (value: string) => void;
  currency?: string;
  invalid: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="label">Amount{currency ? ` (${currency.toUpperCase()})` : ''}</span>
      <input
        className="field field-sm font-mono"
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="10.00"
        autoComplete="off"
      />
      <span className={`mt-1 block text-xs ${invalid ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]'}`}>
        {invalid ? 'Enter a positive amount with at most two decimals' + (hint ? ` (${hint.toLowerCase()})` : '') + '.' : hint}
      </span>
    </label>
  );
}
