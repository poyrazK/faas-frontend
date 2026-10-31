'use client';

import React from 'react';
import Link from 'next/link';
import type { ObsAppDetailResponse } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { formatMegabytes } from '@/lib/operator';
import { nodeHref } from '@/lib/routes';
import { EntityId } from '../EntityId';
import { InstanceActions } from '../InstanceActions';

/** One app's workload; `onChanged` reloads it after an instance action. */
export function AppWorkload({ detail, onChanged }: { detail: ObsAppDetailResponse; onChanged?: () => void }) {
  const m = detail.health.metrics;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TenantFact label="App" value={detail.app.slug} />
        <TenantFact label="Runtime" value={detail.app.runtime} />
        <TenantFact label="Max concurrency" value={detail.app.max_concurrency} />
        <TenantFact label="Instances" value={detail.instances.length} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <TenantTile label={`Requests (${m.range})`} value={m.request_count} />
        <TenantTile label="p95" value={`${m.latency_p95_ms.toFixed(0)} ms`} />
        <TenantTile label="Errors" value={`${m.error_rate_pct.toFixed(2)}%`} />
        <TenantTile label="Queue" value={m.queue_depth ?? 0} />
        <TenantTile label="Metrics source" value={m.source === 'prometheus' ? 'Prometheus' : 'Degraded'} />
      </div>
      {detail.health.errors.length > 0 && (
        <div className="overflow-x-auto rounded border border-[var(--color-line)]">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>Error</th>
                <th>Route</th>
                <th>Requests</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {detail.health.errors.map((error) => (
                <tr key={error.fingerprint}>
                  <td>
                    {error.error_class} ({error.http_status})
                  </td>
                  <td>{error.route}</td>
                  <td>{error.request_count}</td>
                  <td>{relativeTime(error.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail.instances.length > 0 && (
        <div className="overflow-x-auto rounded border border-[var(--color-line)]">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>Instance</th>
                <th>State</th>
                <th>Node</th>
                <th>RAM</th>
                <th>Last request</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {detail.instances.map((instance) => (
                <tr key={instance.id}>
                  <td>
                    <EntityId id={instance.id} kind="instance" />
                  </td>
                  <td>
                    <span className="badge badge-neutral">{instance.state.replace('_', ' ')}</span>
                  </td>
                  <td>
                    {instance.node_name ? (
                      <Link href={nodeHref(instance.node_name)} className="hover:underline">
                        {instance.node_name}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="font-mono">{formatMegabytes(instance.ram_mb)}</td>
                  <td>{instance.last_request_at ? relativeTime(instance.last_request_at) : '—'}</td>
                  <td>
                    <InstanceActions instance={{ ...instance, app_slug: instance.app_slug || detail.app.slug }} onDone={onChanged} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="overflow-x-auto rounded border border-[var(--color-line)]">
        <table className="dtable text-xs">
          <thead>
            <tr>
              <th>Deployed</th>
              <th>Status</th>
              <th>Source</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {detail.deployments.map((deployment) => (
              <tr key={deployment.id}>
                <td>{relativeTime(deployment.created_at)}</td>
                <td>{deployment.status}</td>
                <td className="font-mono">{deployment.source_url || deployment.commit_sha || deployment.kind}</td>
                <td className="text-[var(--color-danger)]">{deployment.error_code || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TenantStatusBadge({ status }: { status: string }) {
  const tone = status === 'active' ? 'badge-success' : status === 'past_due' ? 'badge-warning' : 'badge-danger';
  return <span className={`badge ${tone}`}>{status.replace('_', ' ')}</span>;
}

export function TenantFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[var(--color-ink-muted)]">{label}</div>
      <div className="mt-0.5 truncate font-semibold">{value}</div>
    </div>
  );
}

export function TenantTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] p-3">
      <div className="text-[11px] text-[var(--color-ink-muted)]">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-[var(--color-ink-muted)]">{sub}</div>}
    </div>
  );
}
