'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { listDeployments, listApps } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono, SearchInput, FilterSelect } from '@/components/ui/bits';
import { StatTile, TableFooter } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

const PER_PAGE = 15;

export default function DeploymentsPage() {
  const deps = useAsync(listDeployments, []);
  const apps = useAsync(listApps, []);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);

  const items = useMemo(() => deps.data?.items ?? [], [deps.data]);
  const appSlug = (id: string) => apps.data?.find((a) => a.id === id)?.slug;

  const filtered = items.filter((d) => {
    const slug = appSlug(d.app_id) ?? d.app_id;
    if (query && !`${slug} ${d.id} ${d.image_digest ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (status !== 'all' && !d.status.toLowerCase().includes(status)) return false;
    return true;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const succeeded = items.filter((d) => /succe|ready|active|deploy/i.test(d.status)).length;
  const failed = items.filter((d) => /fail|error/i.test(d.status)).length;

  return (
    <div>
      <PageHeader
        title="Deployments"
        subtitle="Build and release history across all your workflows."
        actions={
          <button className="btn-icon btn-icon-bordered" onClick={() => deps.reload()} aria-label="Refresh">
            <Icon name="refresh" size={16} />
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Deployments" value={items.length} sub={deps.data?.next_before ? 'Newest page' : 'All time'} />
        <StatTile label="Succeeded" value={succeeded} />
        <StatTile label="Failed" value={failed} sub={items.length ? `${((failed / items.length) * 100).toFixed(1)}% of builds` : undefined} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Search deployments…" className="w-full max-w-xs" />
          <div className="ml-auto">
            <FilterSelect
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'succ', label: 'Succeeded' },
                { value: 'build', label: 'Building' },
                { value: 'fail', label: 'Failed' },
              ]}
            />
          </div>
        </div>

        <AsyncBoundary
          state={deps}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={5} rows={5} />}
          empty={
            query || status !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No deployment matches these filters." />
            ) : (
              <EmptyState
                icon="deployments"
                title="No deployments yet"
                hint="Deploy from the CLI or push to a connected repository to see builds here."
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
                      <th>Deployment</th>
                      <th>Workflow</th>
                      <th>Kind</th>
                      <th>Image digest</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((d) => {
                      const slug = appSlug(d.app_id);
                      return (
                        <tr key={d.id}>
                          <td className="cell-primary"><Mono>{d.id.slice(0, 12)}</Mono></td>
                          <td>
                            {slug ? (
                              <Link href={`/dashboard/workflows/${slug}`} style={{ color: 'var(--color-brand)' }}>{slug}</Link>
                            ) : (
                              <Mono>{d.app_id.slice(0, 8)}</Mono>
                            )}
                          </td>
                          <td>{d.kind}</td>
                          <td className="mono text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                            {d.image_digest ? d.image_digest.slice(0, 20) + '…' : '—'}
                          </td>
                          <td>
                            <StatusBadge state={d.status} />
                            {d.error && (
                              <div className="mt-1 max-w-[280px] text-xs" style={{ color: 'var(--color-danger)' }}>
                                {d.error}
                              </div>
                            )}
                          </td>
                          <td>{relativeTime(d.created_at)}</td>
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
                noun="deployments"
                page={current}
                pageCount={pageCount}
                onPage={setPage}
              />
            </>
          )}
        </AsyncBoundary>
      </div>
    </div>
  );
}
