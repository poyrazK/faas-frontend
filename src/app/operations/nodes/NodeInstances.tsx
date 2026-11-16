'use client';

import React, { useState } from 'react';
import type { ObsInstanceRow } from '@/lib/api';
import { formatMegabytes } from '@/lib/operator';
import { relativeTime } from '@/lib/format';
import { FilterSelect } from '@/components/ui/bits';
import { EntityId } from '@/components/operator/EntityId';
import { InstanceActions } from '@/components/operator/InstanceActions';

/* The VMs a node holds (apid lists only resident instances: running,
   starting, warm, frozen, draining, snapshotting, migrating). Running ones
   are shown first by default, most recently used first. */

export type InstanceView = 'running' | 'all';

/** Instances for the view, most recent request first (never-used last). */
export function visibleInstances(instances: ObsInstanceRow[], view: InstanceView): ObsInstanceRow[] {
  const rows = view === 'running' ? instances.filter((i) => i.state === 'running') : [...instances];
  const at = (i: ObsInstanceRow) => (i.last_request_at ? Date.parse(i.last_request_at) || 0 : 0);
  return rows.sort((a, b) => at(b) - at(a));
}

export function NodeInstances({
  instances,
  nodeName,
  onChanged,
}: {
  instances: ObsInstanceRow[];
  nodeName: string | null;
  onChanged: () => void;
}) {
  const [view, setView] = useState<InstanceView>('running');
  const running = instances.filter((i) => i.state === 'running').length;
  const rows = visibleInstances(instances, view);
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-[var(--color-ink-soft)]">
          Instances · {running} running{instances.length > running ? ` of ${instances.length} on the node` : ''}
        </h4>
        <FilterSelect
          value={view}
          onChange={(v) => setView(v as InstanceView)}
          options={[
            { value: 'running', label: 'Running' },
            { value: 'all', label: 'All on the node' },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <div className="text-[var(--color-ink-muted)]">
          {view === 'running' ? 'No instance is running on this node.' : 'No VM is on this node.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>Instance</th>
                <th>App</th>
                <th>Account</th>
                <th>State</th>
                <th>RAM</th>
                <th>Last request</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((instance) => (
                <tr key={instance.id}>
                  <td>
                    <EntityId id={instance.id} kind="instance" />
                  </td>
                  <td>{instance.app_slug || <EntityId id={instance.app_id} kind="app" />}</td>
                  <td>{instance.account_id ? <EntityId id={instance.account_id} kind="account" /> : '—'}</td>
                  <td>
                    <span className={`badge ${instance.state === 'running' ? 'badge-success' : 'badge-neutral'}`}>{instance.state}</span>
                  </td>
                  <td className="font-mono">{formatMegabytes(instance.ram_mb)}</td>
                  <td>{instance.last_request_at ? relativeTime(instance.last_request_at) : '—'}</td>
                  <td>
                    <InstanceActions instance={{ ...instance, node_name: instance.node_name || nodeName || undefined }} onDone={onChanged} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
