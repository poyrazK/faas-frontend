'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { listObsTenants, type ObsTenantRow } from '@/lib/api';
import { isAccountId, tenantHref } from '@/lib/routes';
import { PageHeader, SearchInput, FilterSelect } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';
import { EntityId } from '@/components/operator/EntityId';

const PAGE_SIZE = 100;



export default function TenantsPage() {
  return (
    <Suspense>
      <TenantsDirectory />
    </Suspense>
  );
}

function TenantsDirectory() {
  const params = useSearchParams();
  const [includePii, setIncludePii] = useState(false);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const jumpQuery = params.get('q');

  // The header search navigates here with ?q=; follow later jumps too.
  useEffect(() => {
    if (jumpQuery !== null) queueMicrotask(() => setSearch(jumpQuery));
  }, [jumpQuery]);
  const [planFilter, setPlanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Directory: server-side plan/status filters, cursor pages appended on demand.
  const [rows, setRows] = useState<ObsTenantRow[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listNonce, setListNonce] = useState(0);
  const listSeq = useRef(0);

  const filters = {
    plan: planFilter === 'all' ? undefined : planFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
  };

  const loadPage = async (cursor: string | undefined, append: boolean) => {
    const seq = ++listSeq.current;
    setListLoading(true);
    setListError(null);
    try {
      const res = await listObsTenants(PAGE_SIZE, cursor, includePii, filters);
      if (seq !== listSeq.current) return;
      setRows((current) => (append ? [...current, ...res.items] : res.items));
      setNextCursor(res.next_cursor);
    } catch (err) {
      if (seq === listSeq.current) setListError((err as Error).message);
    } finally {
      if (seq === listSeq.current) setListLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => void loadPage(undefined, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includePii, planFilter, statusFilter, listNonce]);

  // An exact account ID (from the header search or a pasted link) goes
  // straight to that customer's workspace, loaded page or not.
  const router = useRouter();
  useEffect(() => {
    if (jumpQuery && isAccountId(jumpQuery)) router.replace(tenantHref(jumpQuery));
  }, [jumpQuery, router]);

  const query = search.trim().toLowerCase();
  const visibleRows = query
    ? rows.filter(
        (t) =>
          t.account_id.toLowerCase().includes(query) ||
          t.email?.toLowerCase().includes(query) ||
          t.org_slug?.toLowerCase().includes(query),
      )
    : rows;

  return (
    <div>
      <PageHeader
        title="Tenants"
        subtitle="Find a customer and open their workspace: apps, deployments, billing, flags and a full activity timeline."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIncludePii(!includePii)}
              className={`btn btn-sm ${includePii ? 'btn-warning' : 'btn-secondary'}`}
              title="Showing emails records a pii.accessed audit event"
            >
              <Icon name="shield" size={14} />
              {includePii ? 'Emails visible' : 'Emails hidden'}
            </button>
            <button onClick={() => setListNonce((n) => n + 1)} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />

      {includePii && (
        <div className="mb-4 rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
          <Icon name="shield" size={14} className="mr-1.5 inline" />
          Customer emails are visible. Each load is recorded as PII access in the audit log.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter loaded tenants by ID, email or org…"
          className="w-full sm:w-80"
        />
        <FilterSelect
          value={planFilter}
          onChange={setPlanFilter}
          options={[
            { value: 'all', label: 'All plans' },
            { value: 'free', label: 'Free' },
            { value: 'hobby', label: 'Hobby' },
            { value: 'pro', label: 'Pro' },
            { value: 'scale', label: 'Scale' },
          ]}
        />
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'past_due', label: 'Past due' },
            { value: 'suspended', label: 'Suspended' },
            { value: 'deleted_pending', label: 'Deletion pending' },
          ]}
        />
      </div>

      <SectionCard>
        {listError && rows.length === 0 ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
            Could not load tenants: {listError}
          </div>
        ) : listLoading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading tenants…</div>
        ) : visibleRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            {query && nextCursor ? 'No match among loaded tenants — load more to keep searching.' : 'No tenants match.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Email</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Apps / live</th>
                  <th>MFA</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((tenant) => (
                  <tr key={tenant.account_id}>
                    <td className="font-mono">
                      <EntityId id={tenant.account_id} kind="account" />
                      {tenant.org_slug && (
                        <div className="text-[11px] text-[var(--color-ink-muted)]">org: {tenant.org_slug}</div>
                      )}
                    </td>
                    <td>
                      {tenant.email ? (
                        <Link href={tenantHref(tenant.account_id)} className="cell-primary hover:underline">
                          {tenant.email}
                        </Link>
                      ) : (
                        <span className="italic text-[var(--color-ink-muted)]">hidden</span>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-neutral uppercase">{tenant.plan}</span>
                    </td>
                    <td>
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td>
                      <span className="font-semibold">{tenant.apps_count}</span> apps ·{' '}
                      <span className="font-semibold text-[var(--color-brand-bright)]">{tenant.deployments_live_count}</span> live
                    </td>
                    <td>{tenant.mfa_enrolled ? 'Enrolled' : <span className="text-[var(--color-ink-muted)]">Off</span>}</td>
                    <td>{relativeTime(tenant.created_at)}</td>
                    <td className="text-right">
                      <Link href={tenantHref(tenant.account_id)} className="btn btn-secondary btn-xs">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-foot">
          <span>
            {rows.length} loaded{query ? ` · ${visibleRows.length} match the filter` : ''}
            {listError && rows.length > 0 ? ` · last load failed: ${listError}` : ''}
          </span>
          {nextCursor && (
            <button
              className="btn btn-secondary btn-xs"
              disabled={listLoading}
              onClick={() => void loadPage(nextCursor, true)}
            >
              {listLoading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'active' ? 'badge-success' : status === 'past_due' ? 'badge-warning' : 'badge-danger';
  return <span className={`badge ${tone}`}>{status.replace('_', ' ')}</span>;
}
