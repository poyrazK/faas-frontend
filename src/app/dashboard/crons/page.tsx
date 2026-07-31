'use client';

/* ==========================================================================
   Cron Jobs — /v1/crons, with the recent fire history folded in from the
   cron-sourced rows of /v1/invocations.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { listCrons, createCron, deleteCron, updateCron, listApps, listInvocations, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, SearchInput, FilterSelect, StatusBadge, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { TableFooter, SectionCard } from '@/components/ui/Panels';
import { usePage } from '@/lib/usePaged';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

/** Human gloss for the handful of expressions people actually type. */
function describeSchedule(expr: string): string {
  const map: Record<string, string> = {
    '* * * * *': 'Every minute',
    '*/5 * * * *': 'Every 5 minutes',
    '*/15 * * * *': 'Every 15 minutes',
    '*/30 * * * *': 'Every 30 minutes',
    '0 * * * *': 'Hourly',
    '0 0 * * *': 'Daily at midnight',
    '0 0 * * 0': 'Weekly on Sunday',
    '0 0 1 * *': 'Monthly on the 1st',
  };
  return map[expr.trim()] ?? 'Custom schedule';
}

export default function CronsPage() {
  const crons = useAsync(listCrons, []);
  const apps = useAsync(listApps, []);
  const invocations = useAsync(() => listInvocations(200), []);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState('');
  const [schedule, setSchedule] = useState('*/5 * * * *');
  const [path, setPath] = useState('/');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  const cronRuns = useMemo(
    () => (invocations.data?.invocations ?? []).filter((r) => r.source === 'cron'),
    [invocations.data],
  );

  const appName = (id: string) => apps.data?.find((a) => a.id === id)?.slug ?? id.slice(0, 8);
  const appSlug = (id: string) => apps.data?.find((a) => a.id === id)?.slug;

  const filtered = (crons.data ?? []).filter((c) => {
    if (query && !`${appName(c.app_id)} ${c.schedule} ${c.path}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (status === 'active' && !c.enabled) return false;
    if (status === 'paused' && c.enabled) return false;
    return true;
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createCron({ app_id: appId, schedule: schedule.trim(), path: path.trim() || '/' });
      toast.success('Cron job created.');
      setOpen(false);
      crons.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create cron job.');
    } finally {
      setBusy(false);
    }
  }

  const pg = usePage(filtered, 15);

  return (
    <div>
      <PageHeader
        title="Cron Jobs"
        subtitle="Schedule workflows to run on a cron schedule."
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Icon name="plus" size={14} /> New Cron Job
          </button>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search cron jobs…" className="w-full max-w-xs" />
          <div className="ml-auto">
            <FilterSelect
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'active', label: 'Active' },
                { value: 'paused', label: 'Paused' },
              ]}
            />
          </div>
        </div>

        <AsyncBoundary
          state={crons}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={5} rows={4} />}
          empty={
            query || status !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No cron job matches these filters." />
            ) : (
              <EmptyState
                icon="crons"
                title="No cron jobs"
                hint="Schedule a recurring request to a workflow on a cron expression."
                action={<button className="btn btn-primary" onClick={() => setOpen(true)}>New Cron Job</button>}
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
                      <th>Schedule</th>
                      <th>Workflow</th>
                      <th>Path</th>
                      <th>Status</th>
                      <th>Last fired</th>
                      <th>Runs seen</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pg.items.map((c) => {
                      const slug = appSlug(c.app_id);
                      const runs = cronRuns.filter((r) => r.app_id === c.app_id).length;
                      return (
                        <tr key={c.id}>
                          <td>
                            <div className="mono text-xs font-medium" style={{ color: 'var(--color-ink)' }}>{c.schedule}</div>
                            <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>{describeSchedule(c.schedule)}</div>
                          </td>
                          <td>
                            {slug ? (
                              <Link href={`/dashboard/workflows/${slug}`} className="cell-primary">{slug}</Link>
                            ) : (
                              <Mono>{c.app_id.slice(0, 8)}</Mono>
                            )}
                          </td>
                          <td><Mono>{c.path}</Mono></td>
                          <td>
                            <span className={`badge ${c.enabled ? 'badge-brand' : 'badge-warn'}`}>
                              {c.enabled ? 'Active' : 'Paused'}
                            </span>
                          </td>
                          <td>{relativeTime(c.last_fired_at)}</td>
                          <td>{runs || '—'}</td>
                          <td>
                            <RowMenu>
                              <RowMenuItem
                                onClick={async () => {
                                  try {
                                    await updateCron(c.id, { enabled: !c.enabled });
                                    toast.success(c.enabled ? 'Cron job paused.' : 'Cron job resumed.');
                                    crons.reload();
                                  } catch (err) {
                                    toast.error(err instanceof ApiError ? err.message : 'Toggle failed.');
                                  }
                                }}
                              >
                                {c.enabled ? 'Pause' : 'Resume'}
                              </RowMenuItem>
                              {slug && <RowMenuItem onClick={() => location.assign(`/dashboard/workflows/${slug}`)}>Open workflow</RowMenuItem>}
                              <RowMenuItem
                                danger
                                onClick={async () => {
                                  try {
                                    await deleteCron(c.id);
                                    toast.success('Cron job deleted.');
                                    crons.reload();
                                  } catch (err) {
                                    toast.error(err instanceof ApiError ? err.message : 'Delete failed.');
                                  }
                                }}
                              >
                                Delete
                              </RowMenuItem>
                            </RowMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TableFooter
                from={pg.from}
                to={pg.to}
                total={pg.total}
                noun="cron jobs"
                page={pg.page}
                pageCount={pg.pageCount}
                onPage={pg.setPage}
              />
            </>
          )}
        </AsyncBoundary>
      </div>

      {/* Recent fires — the cron-sourced slice of the invocations table. */}
      <SectionCard className="mt-4" title="Recent cron runs">
        {cronRuns.length === 0 ? (
          <EmptyState icon="clock" title="No cron runs recorded" hint="Runs appear here once a schedule fires." />
        ) : (
          <table className="dtable">
            <thead><tr><th>Workflow</th><th>Path</th><th>Status</th><th>Fired</th><th>Attempts</th></tr></thead>
            <tbody>
              {cronRuns.slice(0, 10).map((r) => {
                const slug = appSlug(r.app_id);
                return (
                  <tr key={r.id}>
                    <td className="cell-primary">
                      {slug ? <Link href={`/dashboard/workflows/${slug}`} style={{ color: 'var(--color-brand)' }}>{slug}</Link> : <Mono>{r.app_id.slice(0, 8)}</Mono>}
                    </td>
                    <td><Mono>{r.path || '/'}</Mono></td>
                    <td>
                      <StatusBadge state={r.state} />
                      {r.last_error && <div className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>{r.last_error}</div>}
                    </td>
                    <td>{relativeTime(r.created_at)}</td>
                    <td>{r.attempts ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New cron job"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="add-cron" type="submit" disabled={busy || !appId}>
              {busy ? 'Creating…' : 'Create cron job'}
            </button>
          </>
        }
      >
        <form id="add-cron" onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Workflow</label>
            <select className="field" value={appId} onChange={(e) => setAppId(e.target.value)} required>
              <option value="">Select a workflow…</option>
              {(apps.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.slug}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Schedule (cron expression)</label>
            <input className="field mono" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="*/5 * * * *" required />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>{describeSchedule(schedule)} · UTC</p>
          </div>
          <div>
            <label className="label">Path</label>
            <input className="field mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/cron/refresh" />
          </div>
        </form>
      </Modal>
    </div>
  );
}
