'use client';

/* ==========================================================================
   Workflows — the template's name for what /v1/apps calls an app (and what
   the CLI deploys). Same object, one vocabulary for the console.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  listApps, createApp, deleteApp, wakeApp, parkApp,
  listInvocations, listDeployments, AppType, Runtime, ApiError,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono, SearchInput, FilterSelect, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { TableFooter } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';
import { totals, ms, compact } from '@/lib/series';

const RAM_OPTIONS = [128, 256, 512, 1024, 2048];
const PER_PAGE = 12;

export default function WorkflowsPage() {
  const apps = useAsync(listApps, []);
  const invocations = useAsync(() => listInvocations(200), []);
  const deployments = useAsync(listDeployments, []);
  const toast = useToast();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);

  // create form
  const [slug, setSlug] = useState('');
  const [newType, setNewType] = useState<AppType>('app');
  const [runtime, setRuntime] = useState<Runtime>('node22');
  const [ram, setRam] = useState(256);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => invocations.data?.invocations ?? [], [invocations.data]);

  /** Newest deployment per app, for the "Last deployed" column. */
  const lastDeploy = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of deployments.data?.items ?? []) {
      const prev = map.get(d.app_id);
      if (!prev || Date.parse(d.created_at) > Date.parse(prev)) map.set(d.app_id, d.created_at);
    }
    return map;
  }, [deployments.data]);

  const enriched = useMemo(
    () =>
      (apps.data ?? []).map((a) => {
        const mine = rows.filter((r) => r.app_id === a.id);
        return { app: a, stats: totals(mine), deployedAt: lastDeploy.get(a.id) ?? null };
      }),
    [apps.data, rows, lastDeploy],
  );

  const filtered = useMemo(
    () =>
      enriched.filter(({ app }) => {
        if (query && !app.slug.toLowerCase().includes(query.toLowerCase())) return false;
        if (type !== 'all' && app.type !== type) return false;
        if (status !== 'all' && !app.status.toLowerCase().includes(status)) return false;
        return true;
      }),
    [enriched, query, type, status],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createApp({ slug: slug.trim(), type: newType, ram_mb: ram, ...(newType === 'function' ? { runtime } : {}) });
      toast.success(`Workflow “${slug.trim()}” created.`);
      setOpen(false);
      setSlug('');
      apps.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create workflow.');
    } finally {
      setSubmitting(false);
    }
  }

  async function act(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name);
    try {
      await fn();
      toast.success(ok);
      apps.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `${name} failed.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Workflows"
        subtitle="Deploy and manage your serverless workflows."
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Icon name="plus" size={14} /> New Workflow
          </button>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Search workflows…" className="w-full max-w-xs" />
          <div className="ml-auto flex items-center gap-2">
            <FilterSelect
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'run', label: 'Running' },
                { value: 'park', label: 'Parked' },
                { value: 'fail', label: 'Failed' },
              ]}
            />
            <FilterSelect
              value={type}
              onChange={(v) => { setType(v); setPage(1); }}
              options={[
                { value: 'all', label: 'All Types' },
                { value: 'app', label: 'App' },
                { value: 'function', label: 'Function' },
              ]}
            />
          </div>
        </div>

        <AsyncBoundary
          state={apps}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={6} rows={5} />}
          empty={
            query || status !== 'all' || type !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No workflow matches these filters." />
            ) : (
              <EmptyState
                icon="workflows"
                title="No workflows yet"
                hint="Create one to get a public HTTPS endpoint that parks to a snapshot when idle."
                action={
                  <button className="btn btn-primary" onClick={() => setOpen(true)}>
                    <Icon name="plus" size={14} /> New Workflow
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
                      <th>Name</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Invocations</th>
                      <th>Avg completion</th>
                      <th>Memory</th>
                      <th>Last deployed</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(({ app, stats, deployedAt }) => (
                      <tr key={app.id}>
                        <td>
                          <Link href={`/dashboard/workflows/${app.slug}`} className="flex items-center gap-2.5">
                            <span
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                              style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand-bright)' }}
                            >
                              <Icon name={app.type === 'function' ? 'bolt' : 'workflows'} size={14} />
                            </span>
                            <span className="font-medium" style={{ color: 'var(--color-ink)' }}>{app.slug}</span>
                          </Link>
                        </td>
                        <td>
                          {app.type === 'function' ? `Function · ${app.runtime ?? '—'}` : 'HTTPS App'}
                        </td>
                        <td><StatusBadge state={app.status} /></td>
                        <td>{compact(stats.total)}</td>
                        <td>{ms(stats.avgCompletionMs)}</td>
                        <td>{app.ram_mb} MB</td>
                        <td>{relativeTime(deployedAt)}</td>
                        <td>
                          <RowMenu>
                            <RowMenuItem onClick={() => router.push(`/dashboard/workflows/${app.slug}`)}>Open</RowMenuItem>
                            <RowMenuItem
                              onClick={() => act('wake', () => wakeApp(app.slug), `${app.slug} waking.`)}
                            >
                              Wake now
                            </RowMenuItem>
                            <RowMenuItem
                              onClick={() => act('park', () => parkApp(app.slug), `${app.slug} parked.`)}
                            >
                              Park
                            </RowMenuItem>
                            <RowMenuItem
                              danger
                              onClick={async () => {
                                if (!confirm(`Delete ${app.slug}? This removes its snapshots and history.`)) return;
                                await act('delete', () => deleteApp(app.slug), `${app.slug} deleted.`);
                              }}
                            >
                              Delete
                            </RowMenuItem>
                          </RowMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TableFooter
                from={(current - 1) * PER_PAGE + 1}
                to={(current - 1) * PER_PAGE + visible.length}
                total={filtered.length}
                noun="workflows"
                page={current}
                pageCount={pageCount}
                onPage={setPage}
              />
            </>
          )}
        </AsyncBoundary>
      </div>

      {busy && (
        <p className="mt-3 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
          Working…
        </p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New workflow"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="create-app" type="submit" disabled={submitting || slug.trim().length < 3}>
              {submitting ? 'Creating…' : 'Create workflow'}
            </button>
          </>
        }
      >
        <form id="create-app" onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              className="field"
              placeholder="api-user-service"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              pattern="^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$"
              minLength={3}
              maxLength={40}
              required
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Lowercase letters, digits and hyphens. Becomes <Mono>{slug.trim() || 'name'}.gregale.app</Mono>.
            </p>
          </div>

          <div>
            <label className="label">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(['app', 'function'] as AppType[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setNewType(t)}
                  className="rounded-lg border px-3 py-2 text-sm font-medium capitalize"
                  style={{
                    borderColor: newType === t ? 'var(--color-brand)' : 'var(--color-line)',
                    background: newType === t ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                    color: newType === t ? 'var(--color-brand-bright)' : 'var(--color-ink-soft)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {newType === 'function' && (
            <div>
              <label className="label">Runtime</label>
              <select className="field" value={runtime} onChange={(e) => setRuntime(e.target.value as Runtime)}>
                <option value="node22">Node.js 22</option>
                <option value="python312">Python 3.12</option>
              </select>
            </div>
          )}

          <div>
            <label className="label">Memory</label>
            <select className="field" value={ram} onChange={(e) => setRam(Number(e.target.value))}>
              {RAM_OPTIONS.map((r) => (
                <option key={r} value={r}>{r} MB</option>
              ))}
            </select>
          </div>
        </form>
      </Modal>
    </div>
  );
}
