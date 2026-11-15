'use client';

import React, { useState } from 'react';
import {
  ATTENTION_KIND_LABELS,
  ATTENTION_KINDS,
  ATTENTION_STATES,
  CUSTOMER_VISIBLE_KINDS,
  getAttentionSummary,
  kindLabel,
  listAttention,
  type ObsAttentionSummaryResponse,
  type AttentionState,
  type ObsAttentionSignal,
} from '@/lib/ops/accountHealth';
import { useAsync } from '@/lib/useAsync';
import { relativeTime } from '@/lib/format';
import { FilterSelect, Mono, PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { TenantLink } from '@/components/operator/TenantLink';
import { SignalActions } from '@/components/operator/SignalActions';

/* ==========================================================================
   Customers who may be stuck (apid ADR-20261113123000, ADR-20261113180000):
   apid flags accounts whose deploys keep failing, whose apps keep running out
   of memory or failing to boot, whose scheduled jobs keep failing, whose
   custom domain is not serving, who get a burst of refused requests or keep
   hitting a plan limit, or whose payment failed. Signals resolve on their own
   when the condition clears.
   ========================================================================== */

const STATE_LABELS: Record<AttentionState, string> = {
  active: 'Open and dismissed',
  open: 'Open',
  dismissed: 'Dismissed',
  resolved: 'Resolved',
};

export default function AttentionPage() {
  const [kind, setKind] = useState('');
  const [state, setState] = useState<AttentionState>('open');
  const { data, loading, error, reload } = useAsync(() => listAttention({ kind: kind || undefined, state }), [kind, state]);
  const summary = useAsync(() => getAttentionSummary(), []);
  const refresh = () => {
    reload();
    summary.reload();
  };
  const items = data?.items ?? [];
  const accounts = new Set(items.map((s) => s.account_id)).size;

  return (
    <div>
      <PageHeader
        title="Stuck customers"
        subtitle="Accounts apid flagged before they wrote in. Open a signal's account to see the full diagnosis."
        actions={
          <div className="flex items-center gap-3">
            <FilterSelect
              value={kind}
              onChange={setKind}
              options={[{ value: '', label: 'All kinds' }, ...ATTENTION_KINDS.map((k) => ({ value: k, label: kindLabel(ATTENTION_KIND_LABELS, k) }))]}
            />
            <FilterSelect
              value={state}
              onChange={(v) => setState(v as AttentionState)}
              options={ATTENTION_STATES.map((s) => ({ value: s, label: STATE_LABELS[s] }))}
            />
            <button onClick={refresh} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />

      <SectionCard>
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading signals…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-[var(--color-danger)]">{error.message || 'Request failed.'}</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">No {STATE_LABELS[state].toLowerCase()} signals.</div>
        ) : (
          <div className="overflow-x-auto">
            <p className="px-4 pt-3 text-xs text-[var(--color-ink-muted)]">
              {items.length} signal{items.length === 1 ? '' : 's'} on {accounts} account{accounts === 1 ? '' : 's'}
              {items.length >= (data?.limit ?? Infinity) ? ' (list is capped; narrow the filters)' : ''}. Many signals of one
              kind at once usually mean a platform problem, not many stuck customers.
            </p>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--color-line)] text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-2">Account</th>
                  <th className="px-4 py-2">Signal</th>
                  <th className="px-4 py-2">Subject</th>
                  <th className="px-4 py-2">Detail</th>
                  <th className="px-4 py-2">Count</th>
                  <th className="px-4 py-2">Since</th>
                  <th className="px-4 py-2">State</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {items.map((s) => (
                  <SignalTableRow key={s.id} signal={s} onChanged={refresh} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <OutcomeSummary state={summary} />
    </div>
  );
}

/* What support did about each kind: the evidence for changing a threshold. */
function OutcomeSummary({ state }: { state: { data: ObsAttentionSummaryResponse | null; error: Error | null; loading: boolean } }) {
  const days = state.data?.window_days ?? 30;
  return (
    <SectionCard title={`Outcomes, last ${days} days`} className="mt-6">
      {state.error && !state.data ? (
        <p className="p-4 text-xs text-[var(--color-ink-muted)]">
          The outcome summary is not available{state.error.message ? ` (${state.error.message})` : ''}.
        </p>
      ) : !state.data ? (
        <p className="p-4 text-xs text-[var(--color-ink-muted)]">Loading…</p>
      ) : state.data.items.length === 0 ? (
        <p className="p-4 text-xs text-[var(--color-ink-muted)]">No signals in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--color-line)] text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">Signals</th>
                <th className="px-4 py-2">Still open</th>
                <th className="px-4 py-2">Contacted</th>
                <th className="px-4 py-2">False positive</th>
                <th className="px-4 py-2">Other dismissals</th>
                <th className="px-4 py-2">Resolved on own</th>
                <th className="px-4 py-2">Median time to act</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {state.data.items.map((k) => (
                <tr key={k.kind}>
                  <td className="px-4 py-2">{kindLabel(ATTENTION_KIND_LABELS, k.kind)}</td>
                  <td className="px-4 py-2 font-mono">{k.total}</td>
                  <td className="px-4 py-2 font-mono">{k.open}</td>
                  <td className="px-4 py-2 font-mono">{k.contacted}</td>
                  <td className="px-4 py-2 font-mono">
                    {k.false_positive}
                    {k.false_positive_percent >= 0 && <span className="ml-1 text-[var(--color-ink-muted)]">({k.false_positive_percent}%)</span>}
                  </td>
                  <td className="px-4 py-2 font-mono">{k.other_dismissed}</td>
                  <td className="px-4 py-2 font-mono">{k.resolved_on_own}</td>
                  <td className="px-4 py-2">{formatSeconds(k.median_act_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function formatSeconds(seconds?: number): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.round(hours / 24)} days`;
}

function SignalTableRow({ signal: s, onChanged }: { signal: ObsAttentionSignal; onChanged: () => void }) {
  return (
    <tr className="align-top hover:bg-[var(--color-surface-subtle)]">
      <td className="px-4 py-2 font-mono">
        <TenantLink accountId={s.account_id} short />
      </td>
      <td className="px-4 py-2 whitespace-nowrap">
        {kindLabel(ATTENTION_KIND_LABELS, s.kind)}
        {s.state === 'open' && CUSTOMER_VISIBLE_KINDS.includes(s.kind) && (
          <span className="badge badge-info ml-2" title="Shown on the customer's account health page">
            customer sees
          </span>
        )}
      </td>
      <td className="px-4 py-2">
        <Mono>{s.subject}</Mono>
      </td>
      <td className="px-4 py-2 break-words text-[var(--color-ink-muted)]">{s.detail ?? ''}</td>
      <td className="px-4 py-2 font-mono">{s.observed}</td>
      <td className="px-4 py-2 whitespace-nowrap" title={`last seen ${relativeTime(s.last_seen_at)}`}>
        {relativeTime(s.first_seen_at)}
      </td>
      <td className="px-4 py-2 whitespace-nowrap">
        <span className={`badge ${s.state === 'open' ? 'badge-warning' : s.state === 'resolved' ? 'badge-success' : 'badge-neutral'}`}>
          {s.state}
        </span>
        {s.outcome && <span className="ml-2 text-[var(--color-ink-muted)]">{s.outcome.replaceAll('_', ' ')}</span>}
        {s.dismiss_reason && <div className="mt-0.5 text-[var(--color-ink-muted)]">{s.dismiss_reason}</div>}
        {s.ticket_id && <div className="mt-0.5 font-mono text-[var(--color-ink-muted)]">ticket {s.ticket_id}</div>}
      </td>
      <td className="px-4 py-2 text-right">
        <SignalActions signal={s} onDone={onChanged} />
      </td>
    </tr>
  );
}
