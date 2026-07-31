'use client';

/* ==========================================================================
   Queue Jobs — real queue introspection (#394).

   Depth, in-flight count and oldest-pending age come from
   /v1/apps/{slug}/queues/state. Pending rows come from `peek`, which
   acquires no lease and does not increment `attempts` — so opening this page
   cannot perturb the queue. Exhausted rows come from `dead_letter`.

   The endpoints are per-app, so a workflow has to be selected first; there is
   no account-wide queue view.
   ========================================================================== */

import React, { useState } from 'react';
import Link from 'next/link';
import {
  listApps, getQueueState, peekQueue, listDeadLetter, queueSend, cancelDelayedTask, ApiError,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, SearchInput, FilterSelect, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { StatTile, TableFooter } from '@/components/ui/Panels';
import { usePage } from '@/lib/usePaged';
import { AsyncBoundary, EmptyState, SkeletonTable, SkeletonBlock } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';
import { compact } from '@/lib/series';

type Tab = 'Pending' | 'Dead letter';

/** Seconds → a short human age for the oldest-pending tile. */
function age(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/** Payloads arrive as a JSON string straight from the jsonb column. */
function prettyPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

export default function QueuesPage() {
  const apps = useAsync(listApps, []);
  const toast = useToast();

  const [picked, setPicked] = useState('');
  const slug = picked || apps.data?.[0]?.slug || '';

  const [tab, setTab] = useState<Tab>('Pending');
  const [query, setQuery] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [payload, setPayload] = useState('{\n  "hello": "world"\n}');
  const [busy, setBusy] = useState(false);

  const state = useAsync(() => (slug ? getQueueState(slug) : Promise.resolve(null)), [slug]);
  const pending = useAsync(() => (slug ? peekQueue(slug, 50) : Promise.resolve(null)), [slug]);
  const dead = useAsync(() => (slug ? listDeadLetter(slug, 50) : Promise.resolve(null)), [slug]);

  const pendingMsgs = (pending.data?.messages ?? []).filter((m) =>
    query ? `${m.id} ${m.payload}`.toLowerCase().includes(query.toLowerCase()) : true,
  );
  const deadMsgs = (dead.data?.messages ?? []).filter((m) =>
    query ? `${m.id} ${m.payload} ${m.last_error}`.toLowerCase().includes(query.toLowerCase()) : true,
  );

  // Declared before the early return below — hooks cannot be conditional.
  const pgPending = usePage(pendingMsgs, 15);
  const pgDead = usePage(deadMsgs, 15);

  const s = state.data;
  const capPct = s && s.plan_cap > 0 ? Math.min(100, (s.depth / s.plan_cap) * 100) : 0;

  function reloadAll() {
    state.reload();
    pending.reload();
    dead.reload();
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) return;
    setBusy(true);
    try {
      await queueSend(slug, JSON.parse(payload) as Record<string, unknown>);
      toast.success(`Message queued to ${slug}.`);
      setSendOpen(false);
      reloadAll();
    } catch (err) {
      if (err instanceof SyntaxError) toast.error('Payload must be valid JSON.');
      else toast.error(err instanceof ApiError ? err.message : 'Could not queue the message.');
    } finally {
      setBusy(false);
    }
  }

  if (apps.data && apps.data.length === 0) {
    return (
      <div>
        <PageHeader title="Queue Jobs" subtitle="Process jobs in the background with at-least-once delivery." />
        <div className="card">
          <EmptyState
            icon="queues"
            title="No workflows yet"
            hint="Queues belong to a workflow. Create one to start pushing background work."
            action={<Link href="/dashboard/workflows" className="btn btn-primary">Create a workflow</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Queue Jobs"
        subtitle="Process jobs in the background with at-least-once delivery."
        actions={
          <>
            <FilterSelect
              value={slug}
              onChange={setPicked}
              options={(apps.data ?? []).map((a) => ({ value: a.slug, label: a.slug }))}
            />
            <button className="btn-icon btn-icon-bordered" onClick={reloadAll} aria-label="Refresh">
              <Icon name="refresh" size={16} />
            </button>
            <button className="btn btn-primary" onClick={() => setSendOpen(true)} disabled={!slug}>
              <Icon name="plus" size={14} /> Send message
            </button>
          </>
        }
      />

      <AsyncBoundary state={state} skeleton={<SkeletonBlock height={120} />}>
        {() =>
          !s ? (
            <SkeletonBlock height={120} />
          ) : (
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Queue depth"
                value={compact(s.depth)}
                sub={`of ${compact(s.plan_cap)} allowed on ${s.plan}`}
                color={capPct > 80 ? 'var(--color-chart-alt)' : undefined}
              />
              <StatTile label="In flight" value={compact(s.in_flight)} sub="holding a dispatch lease" />
              <StatTile
                label="Oldest pending"
                value={age(s.oldest_pending_age_seconds)}
                sub={s.oldest_pending_at ? relativeTime(s.oldest_pending_at) : 'queue is empty'}
              />
              <StatTile
                label="Dead letter"
                value={compact(dead.data?.messages.length ?? 0)}
                color="var(--color-chart-alt)"
                sub="retry budget exhausted"
              />
            </div>
          )
        }
      </AsyncBoundary>

      {s && capPct > 80 && (
        <div
          className="mb-4 flex items-start gap-3 rounded-lg px-4 py-3"
          style={{ background: '#fdf6e7', border: '1px solid #f2e2bd' }}
        >
          <Icon name="alerts" size={16} style={{ color: '#a1650b', marginTop: 2, flex: 'none' }} />
          <p className="text-sm" style={{ color: '#7c4f08' }}>
            The queue is at {capPct.toFixed(0)}% of the {s.plan} plan cap ({compact(s.depth)} of {compact(s.plan_cap)}).
            Sends are rejected once the cap is reached.
          </p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <div className="seg">
            {(['Pending', 'Dead letter'] as Tab[]).map((t) => (
              <button key={t} data-active={tab === t} onClick={() => setTab(t)}>
                {t}
                {t === 'Dead letter' && (dead.data?.messages.length ?? 0) > 0 ? ` (${dead.data!.messages.length})` : ''}
              </button>
            ))}
          </div>
          <SearchInput value={query} onChange={setQuery} placeholder="Search messages…" className="ml-auto w-full max-w-xs" />
        </div>

        {tab === 'Pending' ? (
          <AsyncBoundary
            state={pending}
            isEmpty={() => pendingMsgs.length === 0}
            skeleton={<SkeletonTable cols={4} rows={4} />}
            empty={
              query ? (
                <EmptyState icon="search" title="No matches" hint="No pending message matches that search." />
              ) : (
                <EmptyState
                  icon="queues"
                  title="Queue is empty"
                  hint={`Nothing is waiting on ${slug}. Messages appear here between send and ack.`}
                  action={<button className="btn btn-primary" onClick={() => setSendOpen(true)}>Send a message</button>}
                />
              )
            }
          >
            {() => (
              <>
                <div className="overflow-x-auto">
                  <table className="dtable">
                    <thead>
                      <tr><th>Message</th><th>Payload</th><th>Attempts</th><th>Queued</th><th /></tr>
                    </thead>
                    <tbody>
                      {pgPending.items.map((m) => (
                        <tr key={m.id}>
                          <td className="cell-primary"><Mono>{m.id.slice(0, 12)}</Mono></td>
                          <td className="mono max-w-[340px] truncate text-xs" title={m.payload}>
                            {prettyPayload(m.payload)}
                          </td>
                          <td>
                            {m.attempts}
                            {m.last_error && (
                              <div className="mt-1 max-w-[220px] truncate text-xs" style={{ color: 'var(--color-danger)' }} title={m.last_error}>
                                {m.last_error}
                              </div>
                            )}
                          </td>
                          <td>{relativeTime(m.created_at)}</td>
                          <td>
                            <RowMenu>
                              <RowMenuItem
                                danger
                                onClick={async () => {
                                  try {
                                    await cancelDelayedTask(m.id);
                                    toast.success('Message cancelled.');
                                    reloadAll();
                                  } catch (err) {
                                    toast.error(err instanceof ApiError ? err.message : 'Cancel failed.');
                                  }
                                }}
                              >
                                Cancel message
                              </RowMenuItem>
                            </RowMenu>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TableFooter from={pgPending.from} to={pgPending.to} total={pgPending.total} noun="pending messages" page={pgPending.page} pageCount={pgPending.pageCount} onPage={pgPending.setPage} />
              </>
            )}
          </AsyncBoundary>
        ) : (
          <AsyncBoundary
            state={dead}
            isEmpty={() => deadMsgs.length === 0}
            skeleton={<SkeletonTable cols={4} rows={3} />}
            empty={
              query ? (
                <EmptyState icon="search" title="No matches" hint="No dead-letter message matches that search." />
              ) : (
                <EmptyState
                  icon="check"
                  title="Nothing in the dead letter queue"
                  hint={`No message on ${slug} has exhausted its retry budget.`}
                />
              )
            }
          >
            {() => (
              <>
                <div className="overflow-x-auto">
                  <table className="dtable">
                    <thead>
                      <tr><th>Message</th><th>Last error</th><th>Payload</th><th>Attempts</th><th>Failed</th></tr>
                    </thead>
                    <tbody>
                      {pgDead.items.map((m) => (
                        <tr key={m.id}>
                          <td className="cell-primary"><Mono>{m.id.slice(0, 12)}</Mono></td>
                          <td className="max-w-[260px]" style={{ color: 'var(--color-danger)' }}>{m.last_error}</td>
                          <td className="mono max-w-[240px] truncate text-xs" title={m.payload}>
                            {prettyPayload(m.payload)}
                          </td>
                          <td>{m.attempts}</td>
                          <td>{relativeTime(m.failed_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TableFooter from={pgDead.from} to={pgDead.to} total={pgDead.total} noun="dead-letter messages" page={pgDead.page} pageCount={pgDead.pageCount} onPage={pgDead.setPage} />
              </>
            )}
          </AsyncBoundary>
        )}
      </div>

      <p className="mt-4 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
        Viewing this page does not consume anything: pending messages are read with a peek that acquires no lease and
        leaves the attempt count untouched.
      </p>

      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title={`Send message to ${slug}`}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setSendOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="send-queue" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send message'}
            </button>
          </>
        }
      >
        <form id="send-queue" onSubmit={send} className="space-y-4">
          <div>
            <label className="label">Payload (JSON)</label>
            <textarea className="field mono" rows={7} value={payload} onChange={(e) => setPayload(e.target.value)} required />
            {s && (
              <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                Queue currently holds {compact(s.depth)} of {compact(s.plan_cap)} allowed on the {s.plan} plan.
              </p>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
