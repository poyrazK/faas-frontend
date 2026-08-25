'use client';

import React, { useState } from 'react';
import { searchObsAuditLog, type GlobalAuditLogEntry } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, SearchInput } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

export default function GlobalAuditLogPage() {
  const [search, setSearch] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [operatorOnly, setOperatorOnly] = useState(false);
  const [kindPrefix, setKindPrefix] = useState('');

  const { data, loading, error, reload } = useAsync(
    () =>
      searchObsAuditLog({
        limit: 150,
        actor_email: actorEmail.trim() || undefined,
        target_account_id: targetAccountId.trim() || undefined,
        operator_only: operatorOnly ? true : undefined,
        kind_prefix: kindPrefix.trim() || undefined,
      }),
    [actorEmail, targetAccountId, operatorOnly, kindPrefix],
    20000,
  );

  const filtered = (data?.items || []).filter((entry: GlobalAuditLogEntry) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      entry.kind.toLowerCase().includes(s) ||
      entry.actor.toLowerCase().includes(s) ||
      (entry.account_id && entry.account_id.toLowerCase().includes(s)) ||
      (entry.subject && entry.subject.toLowerCase().includes(s))
    );
  });

  return (
    <div>
      <PageHeader
        title="Global Operator Audit Log"
        subtitle="Regulator-grade audit search and platform-wide trail across tenant accounts and operator actions (ADR-091 §3.7)"
        actions={
          <button onClick={reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh Trail
          </button>
        }
      />

      {/* Advanced Filter Bar */}
      <div className="mb-4 space-y-3 rounded-lg bg-[var(--color-surface)] p-4 border border-[var(--color-line)]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Actor Email Filter</label>
            <input
              type="text"
              placeholder="e.g. alice@example.com"
              value={actorEmail}
              onChange={(e) => setActorEmail(e.target.value)}
              className="field field-sm w-full font-mono text-xs"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold">Target Account ID</label>
            <input
              type="text"
              placeholder="e.g. 550e8400-e29b-41d4..."
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
              className="field field-sm w-full font-mono text-xs"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold">Action Kind Prefix</label>
            <input
              type="text"
              placeholder="e.g. operator.action or auth."
              value={kindPrefix}
              onChange={(e) => setKindPrefix(e.target.value)}
              className="field field-sm w-full font-mono text-xs"
            />
          </div>

          <div className="flex flex-col justify-end">
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={operatorOnly}
                onChange={(e) => setOperatorOnly(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--color-line)]"
              />
              <span>Operator Actions Only</span>
            </label>
          </div>
        </div>

        <div className="pt-2 border-t border-[var(--color-line)]">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Quick text filter on loaded rows (subject, payload, UUID)…"
            className="w-full"
          />
        </div>
      </div>

      <SectionCard>
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            Searching Global Audit Log…
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-[var(--color-danger)]">
            {error.message || 'Operator access required to view global audit log.'}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            No audit log entries match the search filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action Kind</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Target Account</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Payload Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {filtered.map((entry: GlobalAuditLogEntry) => (
                  <tr key={entry.id} className="hover:bg-[var(--color-surface-subtle)]">
                    <td className="px-4 py-3 font-mono">
                      <div>{new Date(entry.at).toLocaleTimeString()}</div>
                      <div className="text-[11px] text-[var(--color-ink-muted)]">
                        {relativeTime(entry.at)}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-[var(--color-brand-bright)]">
                      {entry.kind}
                    </td>
                    <td className="px-4 py-3 font-mono">{entry.actor}</td>
                    <td className="px-4 py-3 font-mono text-[var(--color-ink-muted)]">
                      {entry.account_id ? <Mono>{entry.account_id.slice(0, 13)}…</Mono> : 'Anonymous'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--color-ink-muted)]">
                      {entry.subject || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px]">
                      {entry.data && Object.keys(entry.data).length > 0 ? (
                        <span className="truncate block max-w-xs text-[var(--color-ink-muted)]">
                          {JSON.stringify(entry.data)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
