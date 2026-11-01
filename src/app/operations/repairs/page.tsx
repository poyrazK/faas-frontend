'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  DATA_REPAIR_POLL_MS,
  formatAgeSeconds,
  getDataRepairHealth,
  phaseIsOverdue,
  safeHttpUrl,
  type DataRepairHealthItem,
  type DataRepairPhaseHealth,
} from '@/lib/ops/workloads';
import { useAsync } from '@/lib/useAsync';
import { useDebounced } from '@/lib/useDebounced';
import { formatMegabytes, isRealTimestamp } from '@/lib/operator';
import { relativeTime } from '@/lib/format';
import { Mono, PageHeader, SearchInput } from '@/components/ui/bits';
import { CursorFooter, SectionCard, StatTile } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { appDeploymentsHref } from '@/lib/routes';
import { EntityId } from '@/components/operator/EntityId';

const PAGE_SIZE = 64;


export default function DataRepairsPage() {
  return (
    <Suspense>
      <DataRepairHealthView />
    </Suspense>
  );
}

function DataRepairHealthView() {
  const params = useSearchParams();
  const accountParam = params.get('account');
  const [accountInput, setAccountInput] = useState(accountParam ?? '');
  const [attentionOnly, setAttentionOnly] = useState(false);
  // Forward-only cursors: keep the trail so Previous replays a known cursor.
  const [trail, setTrail] = useState<string[]>(['']);
  const cursor = trail[trail.length - 1];

  useEffect(() => {
    if (accountParam !== null) queueMicrotask(() => setAccountInput(accountParam));
  }, [accountParam]);

  const query = useAsync(
    async () => ({ cursor, health: await getDataRepairHealth({ cursor: cursor || undefined, limit: PAGE_SIZE }) }),
    [cursor],
    DATA_REPAIR_POLL_MS,
  );
  const health = query.data && query.data.cursor === cursor ? query.data.health : null;

  const account = useDebounced(accountInput.trim().toLowerCase(), 300);
  const items = (health?.items ?? []).filter(
    (item) =>
      (!account || item.account_id.toLowerCase().includes(account)) && (!attentionOnly || item.needs_attention),
  );
  const attention = health?.items.filter((item) => item.needs_attention).length;
  const unavailable = !health && !!query.error && !query.loading;
  const tileValue = (value: React.ReactNode) => (health ? value : unavailable ? '—' : '…');

  return (
    <div>
      <PageHeader
        title="Data repairs"
        subtitle="Customer PostgreSQL repairs that are stuck or need an operator. Read-only."
        actions={
          <button onClick={query.reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />

      <SnapshotFreshness snapshots={[query]} />

      {unavailable && (
        <div role="alert" className="mb-4 rounded-lg bg-[var(--color-danger-subtle)] p-3 text-sm text-[var(--color-danger)]">
          Repair health is unavailable: {query.error?.message}. Do not assume the queue or retained capacity is empty.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Need attention"
          value={tileValue(attention != null && attention >= PAGE_SIZE ? `${attention}+` : attention)}
          sub={health?.next_cursor ? 'On this page; more pages exist' : 'Unknown outcome, overdue or stranded'}
        />
        <StatTile label="Held sandbox slots" value={tileValue(health?.held_slots)} sub="Fleet-wide" />
        <StatTile label="Held memory" value={tileValue(formatMegabytes(health?.held_memory_mb))} sub="Incl. per-VM overhead" />
        <StatTile
          label="Held vCPUs"
          value={tileValue(health?.held_vcpus)}
          sub={health ? `${health.held_cpu_millicores} millicores` : undefined}
        />
        <StatTile
          label="Unavailable tasks"
          value={tileValue(health?.unavailable_tasks)}
          sub="Holding capacity on an unavailable node"
        />
      </div>

      <div className="mt-6">
        <SectionCard
          title="Phases"
          action={
            health && isRealTimestamp(health.observed_at) ? (
              <span className="text-xs text-[var(--color-ink-muted)]">Observed {relativeTime(health.observed_at)}</span>
            ) : undefined
          }
        >
          {!health ? (
            <div className="p-6 text-center text-xs text-[var(--color-ink-muted)]">
              {unavailable ? 'Phase backlog unavailable.' : 'Loading phases…'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Operations</th>
                    <th>Oldest</th>
                    <th>Warn after</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {health.phases.map((phase) => (
                    <tr key={phase.phase}>
                      <td className="font-mono">{phase.phase}</td>
                      <td className="font-mono font-semibold">{phase.count}</td>
                      <td>{phase.count > 0 ? formatAgeSeconds(phase.oldest_age_seconds) : '—'}</td>
                      <td>{phase.warn_after_seconds > 0 ? formatAgeSeconds(phase.warn_after_seconds) : '—'}</td>
                      <td>
                        <PhaseState phase={phase} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mb-4 mt-6 flex flex-wrap items-center gap-3">
        <SearchInput
          value={accountInput}
          onChange={setAccountInput}
          placeholder="Filter this page by account ID"
          className="w-full sm:w-80"
        />
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-soft)]">
          <input type="checkbox" checked={attentionOnly} onChange={(event) => setAttentionOnly(event.target.checked)} />
          Needs attention only
        </label>
        <span className="text-xs text-[var(--color-ink-muted)]">
          The endpoint has no account filter, so these filters apply to the loaded page only.
        </span>
      </div>

      <SectionCard title="Active operations">
        {!health && query.loading ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading repair operations…</div>
        ) : !health ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
            Could not load repair operations{query.error ? `: ${query.error.message}` : '.'}
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            {health.items.length === 0
              ? trail.length > 1
                ? 'No more repair operations.'
                : 'No repair operation is queued, running or awaiting resolution.'
              : `No operation on this page matches the filter${health.next_cursor ? ' — later pages may.' : '.'}`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Operation</th>
                  <th>Account / app</th>
                  <th>Phase</th>
                  <th>Node</th>
                  <th>Capacity held</th>
                  <th>Recovery</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <RepairRow key={item.cursor_key} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.error && health && (
          <div role="alert" className="table-foot text-[var(--color-danger)]">
            Refresh failed: {query.error.message}. Showing the last successful snapshot.
          </div>
        )}
        {health && (
          <CursorFooter
            count={health.items.length}
            noun="operations"
            page={trail.length}
            hasPrev={trail.length > 1}
            hasNext={!!health.next_cursor}
            onPrev={() => setTrail((current) => (current.length > 1 ? current.slice(0, -1) : current))}
            onNext={() => {
              const next = health.next_cursor;
              if (next) setTrail((current) => [...current, next]);
            }}
          />
        )}
      </SectionCard>
    </div>
  );
}

function PhaseState({ phase }: { phase: DataRepairPhaseHealth }) {
  if (phase.count === 0) return <span className="badge badge-neutral">Idle</span>;
  if (phase.phase === 'outcome_unknown') return <span className="badge badge-danger">Needs resolution</span>;
  if (phaseIsOverdue(phase)) return <span className="badge badge-warning">Overdue</span>;
  return <span className="badge badge-success">Within threshold</span>;
}

function RepairRow({ item }: { item: DataRepairHealthItem }) {
  const runbook = safeHttpUrl(item.runbook_url);
  return (
    <tr>
      <td>
        <EntityId id={item.operation_id} />
        {item.task_id && (
          <div className="text-[11px] text-[var(--color-ink-muted)]">
            task <EntityId id={item.task_id} />
          </div>
        )}
        {item.needs_attention && <span className="badge badge-danger mt-1">Needs attention</span>}
      </td>
      <td>
        <EntityId id={item.account_id} kind="account" />
        <div className="text-[11px] text-[var(--color-ink-muted)]">
          app{' '}
          <EntityId id={item.app_id} kind="app" href={`${appDeploymentsHref(item.app_id)}&account=${encodeURIComponent(item.account_id)}`} />
        </div>
      </td>
      <td>
        <Mono>{item.phase}</Mono>
        <div className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]" title={item.phase_started_at}>
          for {formatAgeSeconds(item.age_seconds)}
        </div>
        {item.cancel_requested && <span className="badge badge-warning mt-1">Cancel requested</span>}
        {item.failure_code && <div className="mt-0.5 font-mono text-[11px] text-[var(--color-danger)]">{item.failure_code}</div>}
      </td>
      <td>
        {item.node_id ? (
          <EntityId id={item.node_id} />
        ) : (
          '—'
        )}
        <div className={item.node_status === 'available' ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-warning-bold)]'}>
          {item.node_status || '—'}
        </div>
      </td>
      <td className="font-mono">
        {item.capacity_held ? `${formatMegabytes(item.held_memory_mb)} · ${item.held_vcpus} vCPU` : '—'}
      </td>
      <td className="max-w-[340px]">
        <div className="text-[var(--color-ink-soft)]">{item.recovery_guidance || '—'}</div>
        {runbook && (
          <a href={runbook} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 hover:underline">
            Runbook
            <Icon name="external" size={11} />
          </a>
        )}
      </td>
    </tr>
  );
}
