'use client';

import React, { useState } from 'react';
import { getPlatformFlagDecision, type OperatorPlatformFlag } from '@/lib/ops/flags';
import { canonicalUUID, explainDecision, formatBasisPoints, toRfc3339Seconds } from '@/lib/ops/flags-edit';
import { useAsync } from '@/lib/useAsync';
import { useDebounced } from '@/lib/useDebounced';
import { Mono } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { TenantLink } from '@/components/operator/TenantLink';
import { EntityId } from '@/components/operator/EntityId';

/**
 * "Would account X get flag Y, and why?" — evaluates apid's live snapshot
 * (GET /v1/admin/flags/{key}/decision) and records nothing.
 */
export function DecisionExplorer({
  flags,
  onOpenFlag,
}: {
  flags: readonly OperatorPlatformFlag[];
  onOpenFlag: (key: string) => void;
}) {
  const [flagKey, setFlagKey] = useState('');
  const [account, setAccount] = useState('');
  const [org, setOrg] = useState('');
  const [at, setAt] = useState('');

  const settled = { account: useDebounced(account), org: useDebounced(org), at: useDebounced(at) };
  const accountId = canonicalUUID(settled.account);
  const orgId = settled.org.trim() ? canonicalUUID(settled.org) : '';
  const atIso = settled.at ? toRfc3339Seconds(settled.at) : '';
  const key = flagKey || flags[0]?.key || '';
  const ready = !!key && !!accountId && orgId !== null && atIso !== null;

  const inputs = [key, accountId, orgId, atIso].join('\u0000');
  const decision = useAsync(
    async () => ({
      inputs,
      data: ready ? await getPlatformFlagDecision(key, { accountId: accountId!, orgId: orgId || undefined, at: atIso || undefined }) : null,
    }),
    [inputs, ready],
  );
  // Only a decision evaluated for exactly these inputs is shown; an error for
  // the current inputs is never hidden behind an older answer.
  const result = decision.data && decision.data.inputs === inputs ? decision.data.data : null;
  const typing = account !== settled.account || org !== settled.org || at !== settled.at;

  return (
    <SectionCard title="Decision explorer" className="mb-6">
      <div className="space-y-4 p-4 text-sm">
        <p className="text-xs text-[var(--color-ink-muted)]">
          Would an account get a flag right now, and why? Evaluated against apid&apos;s live snapshot; nothing is recorded.
          Plan entitlement is applied on top: a flag never unlocks a capability the plan lacks.
        </p>
        <div className="grid gap-3 md:grid-cols-[1.2fr_1.4fr_1fr_1fr]">
          <label className="block">
            <span className="label">Flag</span>
            <select className="field field-sm" value={key} onChange={(event) => setFlagKey(event.target.value)}>
              {flags.map((flag) => (
                <option key={flag.key} value={flag.key}>
                  {flag.label} ({flag.key})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Account ID</span>
            <input
              className="field field-sm font-mono"
              placeholder="account UUID"
              value={account}
              spellCheck={false}
              onChange={(event) => setAccount(event.target.value)}
            />
            {settled.account.trim() && !accountId && (
              <span className="mt-1 block text-xs text-[var(--color-danger)]">Enter an account UUID.</span>
            )}
          </label>
          <label className="block">
            <span className="label">Acting under org (optional)</span>
            <input
              className="field field-sm font-mono"
              placeholder="organization UUID"
              value={org}
              spellCheck={false}
              onChange={(event) => setOrg(event.target.value)}
            />
            {orgId === null && <span className="mt-1 block text-xs text-[var(--color-danger)]">Enter an organization UUID.</span>}
          </label>
          <label className="block">
            <span className="label">At (optional, your time)</span>
            <input type="datetime-local" className="field field-sm" value={at} onChange={(event) => setAt(event.target.value)} />
          </label>
        </div>

        {!ready ? (
          <div className="text-xs text-[var(--color-ink-muted)]">Pick a flag and enter an account ID to see the decision.</div>
        ) : decision.error && !result ? (
          <div role="alert" className="rounded-lg bg-[var(--color-danger-subtle)] p-3 text-xs text-[var(--color-danger)]">
            Could not evaluate: {decision.error.message}
          </div>
        ) : !result ? (
          <div className="text-xs text-[var(--color-ink-muted)]">Evaluating…</div>
        ) : (
          <div className={`rounded-lg border border-[var(--color-line)] p-4 ${typing || decision.loading ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${result.available ? 'badge-success' : 'badge-neutral'}`}>
                {result.available ? 'Available to this account' : 'Not available to this account'}
              </span>
              <span className={`badge ${result.enabled ? 'badge-info' : 'badge-neutral'}`}>flag {result.enabled ? 'on' : 'off'}</span>
              {result.entitled !== undefined && (
                <span className={`badge ${result.entitled ? 'badge-success' : 'badge-warning'}`}>
                  {result.entitled ? 'plan entitled' : 'plan not entitled'}
                </span>
              )}
              <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={() => onOpenFlag(result.flag)}>
                Open flag
              </button>
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {explainDecision(result).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
              <Fact label="Account" value={<TenantLink accountId={result.account_id} short />} />
              <Fact label="Plan" value={result.plan || '—'} />
              <Fact label="Org" value={result.org_id ? <EntityId id={result.org_id} chars={13} /> : '—'} />
              <Fact label="Rule" value={result.rule_id ? <Mono>{result.rule_id}</Mono> : result.opt_in ? `opt-in (${result.opt_in})` : '—'} />
              <Fact label="Bucket" value={result.bucket !== undefined ? `${result.bucket} (${formatBasisPoints(result.bucket)})` : '—'} />
              <Fact label="Snapshot" value={`v${result.version}${result.at ? ` · at ${result.at}` : ''}`} />
            </div>
          </div>
        )}
        {decision.error && result && (
          <div role="alert" className="text-xs text-[var(--color-danger)]">
            Refresh failed: {decision.error.message}. Showing the last decision.
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[var(--color-ink-muted)]">{label}</div>
      <div className="truncate">{value}</div>
    </div>
  );
}
