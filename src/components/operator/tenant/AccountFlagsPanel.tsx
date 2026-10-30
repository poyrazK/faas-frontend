'use client';

import React, { useState } from 'react';
import { explainFlagDecision, getAccountPlatformFlags, type OperatorPlatformFlagDecision } from '@/lib/ops/support';
import { Notice, PanelSection, RefreshButton, StaleNotice, useKeyed } from './shared';

type Filter = 'all' | 'on' | 'off';

/** ADR-1700: every platform flag decided for one account, and why. Read-only. */
export function AccountFlagsPanel({ accountId }: { accountId: string }) {
  const flags = useKeyed(accountId, getAccountPlatformFlags);
  const [filter, setFilter] = useState<Filter>('all');

  const items = flags.data?.items ?? [];
  const available = items.filter((d) => d.available).length;
  const visible = items.filter((d) => (filter === 'all' ? true : filter === 'on' ? d.available : !d.available));

  return (
    <PanelSection
      title={flags.data ? `Platform flags · ${available} of ${items.length} available (plan ${flags.data.plan})` : 'Platform flags'}
      actions={
        <>
          {(['all', 'on', 'off'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`btn btn-xs ${filter === value ? 'btn-secondary' : 'btn-ghost'}`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? 'All' : value === 'on' ? 'Available' : 'Unavailable'}
            </button>
          ))}
          <RefreshButton onClick={flags.reload} />
        </>
      }
    >
      {flags.error && !flags.data ? (
        <Notice tone="danger">Could not load platform flags: {flags.error.message}</Notice>
      ) : !flags.data ? (
        <div className="text-xs text-[var(--color-ink-muted)]">Loading platform flags…</div>
      ) : items.length === 0 ? (
        <Notice>The platform flag catalog is empty.</Notice>
      ) : (
        <div className="max-h-72 overflow-auto rounded-lg border border-[var(--color-line)]">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>Flag</th>
                <th>For this account</th>
                <th>Why</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((decision) => (
                <tr key={decision.flag}>
                  <td className="cell-primary font-mono">{decision.flag}</td>
                  <td>
                    <FlagState decision={decision} />
                  </td>
                  <td className="text-[var(--color-ink-soft)]">{explainFlagDecision(decision)}</td>
                  <td className="font-mono">v{decision.version}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-[var(--color-ink-muted)]">
                    No flags match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <StaleNotice error={flags.stale ? flags.error : null} label="platform flags" />
    </PanelSection>
  );
}

function FlagState({ decision }: { decision: OperatorPlatformFlagDecision }) {
  if (decision.available) return <span className="badge badge-success">On</span>;
  if (decision.enabled && decision.entitled === false) {
    return (
      <span className="badge badge-warning" title="The flag is on, but the account's plan does not include the capability it releases">
        On · not in plan
      </span>
    );
  }
  return <span className="badge badge-neutral">Off</span>;
}
