'use client';

/* ==========================================================================
   Workers — every live Firecracker microVM across the account.

   There's no account-wide instance endpoint, so this fans out over
   /v1/apps/{slug}/instances. Per-app failures are kept rather than thrown:
   one workflow 404-ing shouldn't blank the whole page.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { listApps, listInstances, parkApp, wakeApp, type Instance, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, StatusBadge, SearchInput, FilterSelect, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { StatTile, TableFooter } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

interface WorkerRow {
  instance: Instance;
  slug: string;
}

async function loadWorkers(): Promise<{ workers: WorkerRow[]; appCount: number; failed: string[] }> {
  const apps = await listApps();
  const failed: string[] = [];

  const results = await Promise.all(
    apps.map(async (a) => {
      try {
        const list = await listInstances(a.slug);
        return list.map((instance) => ({ instance, slug: a.slug }));
      } catch {
        failed.push(a.slug);
        return [];
      }
    }),
  );

  return { workers: results.flat(), appCount: apps.length, failed };
}

export default function WorkersPage() {
  const data = useAsync(loadWorkers, []);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [state, setState] = useState('all');

  const workers = useMemo(() => data.data?.workers ?? [], [data.data]);

  const filtered = useMemo(
    () =>
      workers.filter(({ instance, slug }) => {
        if (query && !`${slug} ${instance.id}`.toLowerCase().includes(query.toLowerCase())) return false;
        if (state !== 'all' && !instance.state.toLowerCase().includes(state)) return false;
        return true;
      }),
    [workers, query, state],
  );

  const running = workers.filter((w) => w.instance.state.toLowerCase().includes('run')).length;
  const totalRam = workers.reduce((s, w) => s + w.instance.ram_mb, 0);

  return (
    <div>
      <PageHeader
        title="Workers"
        subtitle="Live Firecracker microVMs serving your workflows."
        actions={
          <button className="btn-icon btn-icon-bordered" onClick={() => data.reload()} aria-label="Refresh">
            <Icon name="refresh" size={16} />
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Live microVMs" value={workers.length} sub={`across ${data.data?.appCount ?? 0} workflows`} />
        <StatTile label="Running" value={running} sub={`${workers.length - running} waking or parking`} />
        <StatTile label="Resident memory" value={`${totalRam} MB`} sub="Sum of allocated RAM" />
        <StatTile
          label="Parked workflows"
          value={Math.max(0, (data.data?.appCount ?? 0) - new Set(workers.map((w) => w.slug)).size)}
          sub="Zero resident memory"
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search workers…" className="w-full max-w-xs" />
          <div className="ml-auto">
            <FilterSelect
              value={state}
              onChange={setState}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'run', label: 'Running' },
                { value: 'wak', label: 'Waking' },
                { value: 'park', label: 'Parking' },
              ]}
            />
          </div>
        </div>

        <AsyncBoundary
          state={data}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={6} rows={4} />}
          empty={
            query || state !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No worker matches these filters." />
            ) : (
              <EmptyState
                icon="workers"
                title="No live workers"
                hint="Every workflow is parked as a snapshot right now — that's the idle state, and it costs nothing."
                action={<Link href="/dashboard/workflows" className="btn btn-secondary">View workflows</Link>}
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
                      <th>Instance</th>
                      <th>Workflow</th>
                      <th>State</th>
                      <th>Memory</th>
                      <th>Started</th>
                      <th>Last request</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(({ instance, slug }) => (
                      <tr key={instance.id}>
                        <td className="cell-primary"><Mono>{instance.id.slice(0, 12)}</Mono></td>
                        <td>
                          <Link href={`/dashboard/workflows/${slug}`} style={{ color: 'var(--color-brand)' }}>{slug}</Link>
                        </td>
                        <td><StatusBadge state={instance.state} /></td>
                        <td>{instance.ram_mb} MB</td>
                        <td>{relativeTime(instance.started_at)}</td>
                        <td>{relativeTime(instance.last_request_at)}</td>
                        <td>
                          <RowMenu>
                            <RowMenuItem onClick={() => location.assign(`/dashboard/workflows/${slug}`)}>Open workflow</RowMenuItem>
                            <RowMenuItem
                              onClick={async () => {
                                try {
                                  await wakeApp(slug);
                                  toast.success(`${slug} waking.`);
                                  data.reload();
                                } catch (err) {
                                  toast.error(err instanceof ApiError ? err.message : 'Wake failed.');
                                }
                              }}
                            >
                              Wake
                            </RowMenuItem>
                            <RowMenuItem
                              onClick={async () => {
                                try {
                                  await parkApp(slug);
                                  toast.success(`${slug} parked.`);
                                  data.reload();
                                } catch (err) {
                                  toast.error(err instanceof ApiError ? err.message : 'Park failed.');
                                }
                              }}
                            >
                              Park now
                            </RowMenuItem>
                          </RowMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TableFooter from={1} to={filtered.length} total={filtered.length} noun="workers" />
            </>
          )}
        </AsyncBoundary>
      </div>

      {data.data && data.data.failed.length > 0 && (
        <p className="mt-3 text-xs" style={{ color: 'var(--color-warn)' }}>
          Could not read instances for: {data.data.failed.join(', ')}.
        </p>
      )}
    </div>
  );
}
