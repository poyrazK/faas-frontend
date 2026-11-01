'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { listObsTenants, type ObsTenantRow } from '@/lib/api';
import { isAccountId, tenantHref } from '@/lib/routes';
import { findTenantsByEmail, looksLikeEmail, type EmailSearchResult } from '@/lib/ops/tenantSearch';
import { PageHeader, Mono, SearchInput, FilterSelect } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';
import { shortId } from '@/components/operator/EntityId';
import { RowMenu, copyText, rowOpener } from '@/components/ui/RowMenu';

const PAGE_SIZE = 100;

/**
 * How a tenant row reads: the email once revealed, else its org, else its
 * short account ID (so hidden-email rows stay distinguishable), with the
 * rest on the second line.
 */
function tenantLines(tenant: ObsTenantRow): { primary: string; secondary: string; mono: boolean } {
  const id = shortId(tenant.account_id);
  const kind = tenant.is_personal ? 'Personal account' : 'Organization account';
  if (tenant.email) return { primary: tenant.email, secondary: tenant.org_slug ? `${id} · org ${tenant.org_slug}` : id, mono: false };
  if (tenant.org_slug) return { primary: `org ${tenant.org_slug}`, secondary: id, mono: false };
  return { primary: id, secondary: kind, mono: true };
}



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

  // Email search: emails come back only with the audited PII opt-in, so the
  // operator starts it explicitly; it pages the whole directory.
  const [emailSearch, setEmailSearch] = useState<
    { query: string; scanned: number; result?: EmailSearchResult; error?: string } | null
  >(null);
  const emailRun = useRef<{ cancelled: boolean } | null>(null);
  const searchText = search.trim();
  useEffect(() => {
    // A new query cancels a running search and drops stale results.
    if (emailRun.current) emailRun.current.cancelled = true;
    emailRun.current = null;
    queueMicrotask(() => setEmailSearch((current) => (current && current.query !== searchText ? null : current)));
  }, [searchText]);

  const runEmailSearch = async () => {
    const run = { cancelled: false };
    if (emailRun.current) emailRun.current.cancelled = true;
    emailRun.current = run;
    setEmailSearch({ query: searchText, scanned: 0 });
    try {
      const result = await findTenantsByEmail(
        searchText,
        (cursor) => listObsTenants(PAGE_SIZE, cursor, true, filters),
        { signal: run, onProgress: (scanned) => !run.cancelled && setEmailSearch({ query: searchText, scanned }) },
      );
      if (run.cancelled) return;
      const exact = result.matches.filter((row) => row.email?.toLowerCase() === searchText.toLowerCase());
      if (exact.length === 1) {
        router.push(tenantHref(exact[0].account_id));
        return;
      }
      setEmailSearch({ query: searchText, scanned: result.scanned, result });
    } catch (err) {
      if (!run.cancelled) setEmailSearch({ query: searchText, scanned: 0, error: (err as Error).message });
    }
  };
  const emailState = emailSearch && emailSearch.query === searchText ? emailSearch : null;

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
        subtitle="Find a customer and open their workspace."
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

      {looksLikeEmail(searchText) && (
        <div className="mb-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-xs">
          {!emailState ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[var(--color-ink-soft)]">
                Emails are only returned with PII access, so the list below can&apos;t match <strong>{searchText}</strong>.
              </span>
              <button className="btn btn-secondary btn-xs" onClick={() => void runEmailSearch()}>
                <Icon name="search" size={12} />
                Search every tenant by email (records PII access)
              </button>
            </div>
          ) : emailState.error ? (
            <div role="alert" className="text-[var(--color-danger)]">
              Email search failed: {emailState.error}{' '}
              <button className="underline" onClick={() => void runEmailSearch()}>
                Retry
              </button>
            </div>
          ) : !emailState.result ? (
            <div className="flex items-center justify-between gap-3 text-[var(--color-ink-muted)]">
              <span>Searching… {emailState.scanned} tenants checked</span>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => {
                  if (emailRun.current) emailRun.current.cancelled = true;
                  setEmailSearch(null);
                }}
              >
                Cancel
              </button>
            </div>
          ) : emailState.result.matches.length === 0 ? (
            <div className="text-[var(--color-ink-soft)]">
              {emailState.result.complete
                ? `No tenant uses this address (checked all ${emailState.result.scanned}).`
                : `No match in the first ${emailState.result.scanned} tenants; narrow the plan or status filter and search again.`}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-[var(--color-ink-muted)]">
                {emailState.result.matches.length} match{emailState.result.matches.length === 1 ? '' : 'es'} in{' '}
                {emailState.result.scanned} tenants{emailState.result.complete ? '' : ' (search stopped early)'}:
              </div>
              {emailState.result.matches.map((row) => (
                <Link key={row.account_id} href={tenantHref(row.account_id)} className="flex items-center gap-3 hover:underline">
                  <span className="cell-primary">{row.email}</span>
                  <Mono>{shortId(row.account_id)}</Mono>
                  <StatusBadge status={row.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

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
                  <th>Customer</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Apps</th>
                  <th>MFA</th>
                  <th>Created</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((tenant) => {
                  const lines = tenantLines(tenant);
                  return (
                    <tr key={tenant.account_id} {...rowOpener(() => router.push(tenantHref(tenant.account_id)), `Open tenant ${lines.primary}`)}>
                      <td className="nowrap" title={tenant.account_id}>
                        <Link href={tenantHref(tenant.account_id)} className={`cell-primary hover:underline ${lines.mono ? 'font-mono' : ''}`}>
                          {lines.primary}
                        </Link>
                        <div className="text-[11px] text-[var(--color-ink-muted)]">{lines.secondary}</div>
                      </td>
                      <td className="nowrap">
                        <span className="badge badge-neutral uppercase">{tenant.plan}</span>
                      </td>
                      <td className="nowrap">
                        <StatusBadge status={tenant.status} />
                      </td>
                      <td className="nowrap">
                        {tenant.apps_count} apps · <span className="text-[var(--color-brand-bright)]">{tenant.deployments_live_count} live</span>
                      </td>
                      <td className="nowrap">{tenant.mfa_enrolled ? 'On' : <span className="text-[var(--color-ink-muted)]">Off</span>}</td>
                      <td className="nowrap" title={tenant.created_at}>
                        {relativeTime(tenant.created_at)}
                      </td>
                      <td className="cell-menu">
                        <RowMenu
                          label={`Actions for tenant ${lines.primary}`}
                          items={[
                            { label: 'Open workspace', href: tenantHref(tenant.account_id) },
                            { label: 'Deployments', href: `/deployments?${new URLSearchParams({ account: tenant.account_id, status: 'all' })}` },
                            { label: 'Job runs', href: `/jobs?${new URLSearchParams({ account: tenant.account_id })}` },
                            { label: 'Copy account ID', onSelect: () => copyText(tenant.account_id) },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
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
