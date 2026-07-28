'use client';

/* ==========================================================================
   Queue Jobs — the queue- and delayed-task-sourced rows of /v1/invocations.

   The control plane has no "list queue depth" endpoint; depth is inferred
   from rows that haven't reached a terminal state, which is exactly what the
   drain still owes work on. Cancelling a pending row uses the real
   DELETE /v1/delayed-tasks/{id}.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { listApps, listInvocations, queueSend, cancelDelayedTask, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, StatusBadge, SearchInput, FilterSelect, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { StatTile, TableFooter } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';
import { totals, compact, ms } from '@/lib/series';

const PER_PAGE = 15;

export default function QueuesPage() {
  const apps = useAsync(listApps, []);
  const invocations = useAsync(() => listInvocations(200), []);
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [state, setState] = useState('all');
  const [page, setPage] = useState(1);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendApp, setSendApp] = useState('');
  const [payload, setPayload] = useState('{\n  "hello": "world"\n}');
  const [busy, setBusy] = useState(false);

  const queued = useMemo(
    () => (invocations.data?.invocations ?? []).filter((r) => r.source === 'queue' || r.source === 'delayed_task'),
    [invocations.data],
  );

  const stats = useMemo(() => totals(queued), [queued]);
  const appSlug = (id: string) => apps.data?.find((a) => a.id === id)?.slug;

  const filtered = queued.filter((r) => {
    const slug = appSlug(r.app_id) ?? r.app_id;
    if (query && !`${slug} ${r.path ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (state !== 'all' && r.state !== state) return false;
    return true;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const slug = apps.data?.find((a) => a.id === sendApp)?.slug;
    if (!slug) return;
    setBusy(true);
    try {
      const body = JSON.parse(payload) as Record<string, unknown>;
      await queueSend(slug, body);
      toast.success(`Message queued to ${slug}.`);
      setSendOpen(false);
      invocations.reload();
    } catch (err) {
      if (err instanceof SyntaxError) toast.error('Payload must be valid JSON.');
      else toast.error(err instanceof ApiError ? err.message : 'Could not queue the message.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Queue Jobs"
        subtitle="Process jobs in the background with at-least-once delivery."
        actions={
          <button className="btn btn-primary" onClick={() => setSendOpen(true)} disabled={!apps.data?.length}>
            <Icon name="plus" size={14} /> Send message
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Messages seen" value={compact(stats.total)} sub="Newest 200 dispatches" />
        <StatTile label="In flight" value={compact(stats.pending)} sub="Pending or dispatching" />
        <StatTile label="Failed" value={compact(stats.failed)} sub={`${stats.errorRatePct.toFixed(2)}% of finished`} />
        <StatTile label="Avg completion" value={ms(stats.avgCompletionMs)} sub={stats.p95CompletionMs != null ? `p95 ${ms(stats.p95CompletionMs)}` : undefined} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Search queue jobs…" className="w-full max-w-xs" />
          <div className="ml-auto">
            <FilterSelect
              value={state}
              onChange={(v) => { setState(v); setPage(1); }}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'pending', label: 'Pending' },
                { value: 'dispatching', label: 'Dispatching' },
                { value: 'completed', label: 'Completed' },
                { value: 'failed', label: 'Failed' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
          </div>
        </div>

        <AsyncBoundary
          state={invocations}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={6} rows={5} />}
          empty={
            query || state !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No queue job matches these filters." />
            ) : (
              <EmptyState
                icon="queues"
                title="No queue jobs"
                hint="Send a message to a workflow's queue and it appears here until the drain acks it."
                action={
                  <button className="btn btn-primary" onClick={() => setSendOpen(true)} disabled={!apps.data?.length}>
                    Send a message
                  </button>
                }
              />
            )
          }
        >
          {() => (
            <>
              <div className="overflow-x-auto">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Workflow</th>
                      <th>Kind</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>Queued</th>
                      <th>Completed</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const slug = appSlug(r.app_id);
                      const cancellable = r.source === 'delayed_task' && (r.state === 'pending' || r.state === 'dispatching');
                      return (
                        <tr key={r.id}>
                          <td className="cell-primary"><Mono>{r.id.slice(0, 12)}</Mono></td>
                          <td>
                            {slug ? (
                              <Link href={`/dashboard/workflows/${slug}`} style={{ color: 'var(--color-brand)' }}>{slug}</Link>
                            ) : (
                              <Mono>{r.app_id.slice(0, 8)}</Mono>
                            )}
                          </td>
                          <td>{r.source === 'queue' ? 'Queue' : 'Delayed task'}</td>
                          <td>
                            <StatusBadge state={r.state} />
                            {r.last_error && (
                              <div className="mt-1 max-w-[240px] truncate text-xs" style={{ color: 'var(--color-danger)' }} title={r.last_error}>
                                {r.last_error}
                              </div>
                            )}
                          </td>
                          <td>{r.attempts ?? 0}</td>
                          <td>{relativeTime(r.created_at)}</td>
                          <td>{relativeTime(r.completed_at)}</td>
                          <td>
                            {cancellable && (
                              <RowMenu>
                                <RowMenuItem
                                  danger
                                  onClick={async () => {
                                    try {
                                      await cancelDelayedTask(r.id);
                                      toast.success('Task cancelled.');
                                      invocations.reload();
                                    } catch (err) {
                                      toast.error(err instanceof ApiError ? err.message : 'Cancel failed.');
                                    }
                                  }}
                                >
                                  Cancel task
                                </RowMenuItem>
                              </RowMenu>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TableFooter
                from={(current - 1) * PER_PAGE + 1}
                to={(current - 1) * PER_PAGE + visible.length}
                total={filtered.length}
                noun="queue jobs"
                page={current}
                pageCount={pageCount}
                onPage={setPage}
              />
            </>
          )}
        </AsyncBoundary>
      </div>

      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Send queue message"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setSendOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="send-queue" type="submit" disabled={busy || !sendApp}>
              {busy ? 'Sending…' : 'Send message'}
            </button>
          </>
        }
      >
        <form id="send-queue" onSubmit={send} className="space-y-4">
          <div>
            <label className="label">Workflow</label>
            <select className="field" value={sendApp} onChange={(e) => setSendApp(e.target.value)} required>
              <option value="">Select a workflow…</option>
              {(apps.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.slug}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Payload (JSON)</label>
            <textarea className="field mono" rows={6} value={payload} onChange={(e) => setPayload(e.target.value)} required />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Counted against your plan&apos;s max queue depth.
            </p>
          </div>
        </form>
      </Modal>
    </div>
  );
}
