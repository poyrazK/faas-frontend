'use client';

import React, { useState } from 'react';
import {
  EGRESS_FLOW_DEFAULT_LIMIT,
  EGRESS_FLOW_RETENTION_DAYS,
  egressQueryError,
  listEgressFlows,
  localInputToRfc3339,
  type EgressFlowQuery,
} from '@/lib/ops/metering';
import { relativeTime } from '@/lib/format';
import { FilterSelect } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { TenantLink } from '@/components/operator/TenantLink';
import { useKeyed } from '@/components/operator/tenant/shared';
import { Field } from './form';
import { EntityId } from '@/components/operator/EntityId';

/**
 * ADR-371 egress flow log: which tenant opened a connection to an address at
 * a time. Answers abuse reports that name the platform's egress IP.
 */
export function EgressFlows({ defaultAccount }: { defaultAccount: string | null }) {
  const [remote, setRemote] = useState('');
  const [account, setAccount] = useState(defaultAccount ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(String(EGRESS_FLOW_DEFAULT_LIMIT));
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ q: EgressFlowQuery; nonce: number } | null>(
    defaultAccount ? { q: { account_id: defaultAccount }, nonce: 1 } : null,
  );

  const flows = useKeyed(submitted ? String(submitted.nonce) : null, () => listEgressFlows(submitted?.q ?? {}));

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    const q: EgressFlowQuery = {
      remote: remote.trim() || undefined,
      account_id: account.trim() || undefined,
      from: localInputToRfc3339(from) ?? undefined,
      to: localInputToRfc3339(to) ?? undefined,
      limit: Number(limit),
    };
    const problem = egressQueryError(q);
    setFormError(problem);
    if (!problem) setSubmitted((prev) => ({ q, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  const q = submitted?.q;
  const windowLabel = q
    ? `${q.from ? new Date(q.from).toLocaleString() : q.to ? '24 h before' : 'last 24 hours'} → ${q.to ? new Date(q.to).toLocaleString() : 'now'}`
    : '';

  return (
    <SectionCard
      title="Egress flow log"
      action={
        submitted && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={flows.reload}>
            <Icon name="refresh" size={13} />
            Refresh
          </button>
        )
      }
    >
      <form onSubmit={search} className="grid gap-3 border-b border-[var(--color-line)] p-5 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <Field id="egress-remote" label="Remote address or CIDR" value={remote} onChange={setRemote} placeholder="203.0.113.7 or 203.0.113.0/24" mono />
        </div>
        <div className="lg:col-span-2">
          <Field id="egress-account" label="Account (optional)" value={account} onChange={setAccount} placeholder="account UUID" mono />
        </div>
        <div>
          <label className="label" htmlFor="egress-from">
            From
          </label>
          <input id="egress-from" type="datetime-local" className="field field-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="egress-to">
            To
          </label>
          <input id="egress-to" type="datetime-local" className="field field-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-6">
          <FilterSelect
            value={limit}
            onChange={setLimit}
            options={[
              { value: '200', label: '200 rows' },
              { value: '500', label: '500 rows' },
              { value: '1000', label: '1000 rows' },
            ]}
          />
          <button type="submit" className="btn btn-primary btn-sm">
            <Icon name="search" size={14} />
            Search flows
          </button>
          <span className="text-[11px] text-[var(--color-ink-muted)]">
            Times are your local zone. Empty range = last 24 hours; the log keeps {EGRESS_FLOW_RETENTION_DAYS} days.
          </span>
          {formError && (
            <span role="alert" className="text-xs text-[var(--color-danger)]">
              {formError}
            </span>
          )}
        </div>
      </form>

      {!submitted ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
          Search by remote address to find which tenant connected to it, or by account to see where it connected.
        </div>
      ) : flows.error && !flows.data ? (
        <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
          Could not search the egress flow log: {flows.error.message}
        </div>
      ) : !flows.data ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Searching…</div>
      ) : flows.data.flows.length === 0 ? (
        <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">No flows match in {windowLabel}.</div>
      ) : (
        <>
          {flows.data.truncated && (
            <div role="status" className="bg-[var(--color-warning-subtle)] px-5 py-2 text-xs text-[var(--color-warning-bold)]">
              The {q?.limit ?? EGRESS_FLOW_DEFAULT_LIMIT}-row limit was reached; older matching flows are not shown. Narrow
              the window or the filters.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Observed</th>
                  <th>Account</th>
                  <th>App</th>
                  <th>Instance</th>
                  <th>Node</th>
                  <th>Remote</th>
                </tr>
              </thead>
              <tbody>
                {flows.data.flows.map((flow, index) => (
                  <tr key={`${flow.observed_at}:${flow.instance_id}:${flow.remote_ip}:${flow.remote_port}:${index}`}>
                    <td title={new Date(flow.observed_at).toISOString()}>
                      <div>{new Date(flow.observed_at).toLocaleString()}</div>
                      <div className="text-[var(--color-ink-muted)]">{relativeTime(flow.observed_at)}</div>
                    </td>
                    <td>{flow.account_id ? <TenantLink accountId={flow.account_id} short /> : '—'}</td>
                    <td>
                      <EntityId id={flow.app_id} kind="app" />
                    </td>
                    <td>
                      <EntityId id={flow.instance_id} kind="instance" />
                    </td>
                    <td>{flow.node}</td>
                    <td className="cell-primary font-mono">
                      {flow.remote_ip.includes(':') ? `[${flow.remote_ip}]` : flow.remote_ip}:{flow.remote_port}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>
              {flows.data.flows.length} flow(s), newest first · {windowLabel}
            </span>
            {flows.stale && flows.error && (
              <span role="alert" className="text-[var(--color-danger)]">
                Refresh failed: {flows.error.message}. Showing the last result.
              </span>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}
