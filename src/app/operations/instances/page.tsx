'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { listFleetInstances, type InstanceListState } from '@/lib/ops/fleetInstances';
import { listComputeNodes } from '@/lib/ops/nodes';
import { useAsync } from '@/lib/useAsync';
import { useUrlParams } from '@/lib/useUrlState';
import { relativeTime } from '@/lib/format';
import { formatMegabytes, isRealTimestamp } from '@/lib/operator';
import { instanceHref } from '@/lib/routes';
import { FilterSelect, PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { EntityId } from '@/components/operator/EntityId';
import { InstanceActions } from '@/components/operator/InstanceActions';
import { rowOpener } from '@/components/ui/RowMenu';

/* ==========================================================================
   Every VM serving across the fleet (apid ADR-20261121161842), most recently
   used first. Filters live in the URL, so /instances?account_id=… is a link
   to one customer's running VMs.
   ========================================================================== */

export default function InstancesPage() {
  return (
    <Suspense>
      <Instances />
    </Suspense>
  );
}

function Instances() {
  const router = useRouter();
  const [params, update] = useUrlParams();
  const state: InstanceListState = params.get('state') === 'resident' ? 'resident' : 'running';
  const node = params.get('node') ?? '';
  const appId = params.get('app_id') ?? '';
  const accountId = params.get('account_id') ?? '';
  const nodes = useAsync(() => listComputeNodes(true), []);
  const list = useAsync(() => listFleetInstances({ state, node, appId, accountId }), [state, node, appId, accountId]);
  const items = list.data?.items ?? [];
  const accounts = new Set(items.map((i) => i.account_id).filter(Boolean)).size;
  const ram = items.reduce((sum, i) => sum + i.ram_mb, 0);

  return (
    <div>
      <PageHeader
        title="Running instances"
        subtitle="Every VM serving across the fleet, most recently used first. Open one for its wake and the requests it ran."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              value={state}
              onChange={(v) => update({ state: v === 'resident' ? 'resident' : null })}
              options={[
                { value: 'running', label: 'Running' },
                { value: 'resident', label: 'Every VM held' },
              ]}
            />
            <FilterSelect
              value={node}
              onChange={(v) => update({ node: v || null })}
              options={[{ value: '', label: 'All nodes' }, ...(nodes.data ?? []).map((n) => ({ value: n.name, label: n.name }))]}
            />
            <button onClick={list.reload} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />

      {(appId || accountId) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--color-ink-muted)]">Only</span>
          {accountId && (
            <span className="flex items-center gap-1">
              account <EntityId id={accountId} kind="account" />
            </span>
          )}
          {appId && (
            <span className="flex items-center gap-1">
              app <EntityId id={appId} kind="app" />
            </span>
          )}
          <button className="btn btn-ghost btn-xs" onClick={() => update({ app_id: null, account_id: null })}>
            Clear
          </button>
        </div>
      )}

      {!!list.data?.unavailable_nodes?.length && (
        <div role="status" className="mb-4 rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
          Could not read {list.data.unavailable_nodes.join(', ')}; their instances are missing below.
        </div>
      )}

      <SectionCard>
        {list.loading && !list.data ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading instances…</div>
        ) : list.error && !list.data ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
            {list.error.message || 'Could not load instances.'}
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            {state === 'running' ? 'Nothing is running.' : 'No VM is held on any node.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Instance</th>
                  <th>App</th>
                  <th>Account</th>
                  <th>Node</th>
                  <th>State</th>
                  <th>RAM</th>
                  <th>Started</th>
                  <th>Last request</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} {...rowOpener(() => router.push(instanceHref(i.id)), `Open instance ${i.id}`)}>
                    <td>
                      <EntityId id={i.id} kind="instance" />
                    </td>
                    <td>
                      <Link href={instanceHref(i.id)} className="cell-primary hover:underline">
                        {i.app_slug || i.app_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{i.account_id ? <EntityId id={i.account_id} kind="account" /> : '—'}</td>
                    <td>{i.node_name ? <EntityId id={i.node_name} kind="node" /> : '—'}</td>
                    <td>
                      <span className={`badge ${i.state === 'running' ? 'badge-success' : 'badge-neutral'}`}>{i.state}</span>
                    </td>
                    <td className="font-mono">{formatMegabytes(i.ram_mb)}</td>
                    <td>{isRealTimestamp(i.started_at) ? relativeTime(i.started_at) : '—'}</td>
                    <td>{isRealTimestamp(i.last_request_at) ? relativeTime(i.last_request_at) : '—'}</td>
                    <td className="cell-menu">
                      <InstanceActions instance={i} onDone={list.reload} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-foot">
          <span>
            {items.length} instance{items.length === 1 ? '' : 's'} on {accounts} account{accounts === 1 ? '' : 's'} · {formatMegabytes(ram)}
            {list.data?.truncated ? ` · capped at ${list.data.limit}; narrow the filters` : ''}
          </span>
        </div>
      </SectionCard>
    </div>
  );
}
