'use client';

import React, { useState } from 'react';
import {
  searchObsAuditLog,
  listObsEvents,
  type GlobalAuditLogEntry,
  type ObsEventRow,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, SearchInput } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

type LogView = 'audit' | 'events';

export default function GlobalAuditLogPage() {
  const [view, setView] = useState<LogView>('audit');
  const [search, setSearch] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [operatorOnly, setOperatorOnly] = useState(false);
  const [kindPrefix, setKindPrefix] = useState('');

  // 1. Audit log search query
  const auditQuery = useAsync(
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

  // 2. Live diagnostic events query
  const eventsQuery = useAsync(
    () =>
      listObsEvents(
        150,
        kindPrefix.trim() || undefined,
        actorEmail.trim() || undefined,
        targetAccountId.trim() || undefined,
      ),
    [kindPrefix, actorEmail, targetAccountId],
    15000,
  );

  const filteredAudit = (auditQuery.data?.items || []).filter((entry: GlobalAuditLogEntry) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      entry.kind.toLowerCase().includes(s) ||
      entry.actor.toLowerCase().includes(s) ||
      (entry.account_id && entry.account_id.toLowerCase().includes(s)) ||
      (entry.subject && entry.subject.toLowerCase().includes(s))
    );
  });

  const filteredEvents = (eventsQuery.data?.items || []).filter((event: ObsEventRow) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      event.kind.toLowerCase().includes(s) ||
      event.actor.toLowerCase().includes(s) ||
      (event.subject && event.subject.toLowerCase().includes(s))
    );
  });

  const handleRefresh = () => {
    if (view === 'audit') auditQuery.reload();
    else eventsQuery.reload();
  };

  return (
    <div>
      <PageHeader
        title="Global Operator Audit & Event Trail"
        subtitle="Regulator-grade audit search and live platform lifecycle events across tenant accounts and operator actions (ADR-091 §3.7)"
        actions={
          <button onClick={handleRefresh} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh Trail
          </button>
        }
      />

      {/* Tab Switcher */}
      <div className="mb-4 flex items-center gap-2 border-b border-[var(--color-line)] pb-2">
        <button
          onClick={() => setView('audit')}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            view === 'audit'
              ? 'bg-[var(--color-brand)] text-white'
              : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-subtle)]'
          }`}
        >
          <Icon name="logs" size={14} />
          <span>Regulator Audit Log (/v1/admin/obs/audit-log/search)</span>
        </button>

        <button
          onClick={() => setView('events')}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            view === 'events'
              ? 'bg-[var(--color-brand)] text-white'
              : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-subtle)]'
          }`}
        >
          <Icon name="bolt" size={14} />
          <span>Live Diagnostic Events (/v1/admin/obs/events)</span>
        </button>
      </div>

      {/* Advanced Filter Bar */}
      <div className="mb-4 space-y-3 rounded-lg bg-[var(--color-surface)] p-4 border border-[var(--color-line)]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Actor / Email Filter</label>
            <input
              type="text"
              placeholder="e.g. alice@example.com"
              value={actorEmail}
              onChange={(e) => setActorEmail(e.target.value)}
              className="field field-sm w-full font-mono text-xs"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold">
              {view === 'audit' ? 'Target Account ID' : 'Subject UUID'}
            </label>
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

          {view === 'audit' && (
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
          )}
        </div>

        <div className="pt-2 border-t border-[var(--color-line)]">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Quick text filter on loaded records (subject, payload, UUID)…"
            className="w-full"
          />
        </div>
      </div>

      {view === 'audit' ? (
        <SectionCard title="Regulator Audit Log Records">
          {auditQuery.loading && !auditQuery.data ? (
            <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
              Searching Global Audit Log…
            </div>
          ) : auditQuery.error ? (
            <div className="p-8 text-center text-sm text-[var(--color-danger)]">
              {auditQuery.error.message || 'Operator access required to view global audit log.'}
            </div>
          ) : filteredAudit.length === 0 ? (
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
                  {filteredAudit.map((entry: GlobalAuditLogEntry) => (
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
      ) : (
        <SectionCard title="Live Diagnostic Events Stream">
          {eventsQuery.loading && !eventsQuery.data ? (
            <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
              Fetching Live Platform Events…
            </div>
          ) : eventsQuery.error ? (
            <div className="p-8 text-center text-sm text-[var(--color-danger)]">
              {eventsQuery.error.message || 'Operator access required to view platform events.'}
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
              No live event records match the search criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Event Kind</th>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Subject ID</th>
                    <th className="px-4 py-3">Diagnostic Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {filteredEvents.map((evt: ObsEventRow) => (
                    <tr key={evt.id} className="hover:bg-[var(--color-surface-subtle)]">
                      <td className="px-4 py-3 font-mono">
                        <div>{new Date(evt.at).toLocaleTimeString()}</div>
                        <div className="text-[11px] text-[var(--color-ink-muted)]">
                          {relativeTime(evt.at)}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-[var(--color-brand-bright)]">
                        {evt.kind}
                      </td>
                      <td className="px-4 py-3 font-mono">{evt.actor}</td>
                      <td className="px-4 py-3 font-mono text-[var(--color-ink-muted)]">
                        {evt.subject ? <Mono>{evt.subject.slice(0, 13)}…</Mono> : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        {evt.data && Object.keys(evt.data).length > 0 ? (
                          <span className="truncate block max-w-sm text-[var(--color-ink-muted)]">
                            {JSON.stringify(evt.data)}
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
      )}
    </div>
  );
}
