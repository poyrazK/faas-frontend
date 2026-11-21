'use client';

import React, { useState } from 'react';
import type { ObsNodeApp } from '@/lib/api';
import { formatMegabytes, isRealTimestamp } from '@/lib/operator';
import { relativeTime } from '@/lib/format';
import { EntityId } from '@/components/operator/EntityId';

/* The apps placed on a node. Most are parked at any moment, so the table
   shows those with a VM on the node unless the operator asks for all. */

/** Apps with a VM on the node, or every placed app when `all`. */
export function visibleApps(apps: ObsNodeApp[], all: boolean): ObsNodeApp[] {
  return all ? apps : apps.filter((app) => app.instances_live > 0);
}

export function NodeApps({ apps }: { apps: ObsNodeApp[] }) {
  const [all, setAll] = useState(false);
  const rows = visibleApps(apps, all);
  const active = visibleApps(apps, false).length;
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-[var(--color-ink-soft)]">
          Apps · {active} with a VM{apps.length > active ? ` of ${apps.length} placed` : ''}
        </h4>
        {apps.length > active && (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAll(!all)}>
            {all ? 'Only apps with a VM' : `Show all ${apps.length} placed apps`}
          </button>
        )}
      </div>
      {apps.length === 0 ? (
        <div className="text-[var(--color-ink-muted)]">No apps are placed on this node.</div>
      ) : rows.length === 0 ? (
        <div className="text-[var(--color-ink-muted)]">No app has a VM on this node; all {apps.length} are parked.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
          <table className="dtable text-xs">
            <thead>
              <tr>
                <th>App</th>
                <th>Account</th>
                <th>Instances</th>
                <th>RAM</th>
                <th>Last request</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((app) => (
                <tr key={app.id}>
                  <td className="cell-primary">{app.slug}</td>
                  <td>
                    <EntityId id={app.account_id} kind="account" />
                  </td>
                  <td>
                    {app.instances_live} live · {app.instances_running} running · {app.instances_cold_booting} cold
                  </td>
                  <td className="font-mono">{formatMegabytes(app.ram_used_mb)}</td>
                  <td>{isRealTimestamp(app.last_request_at) ? relativeTime(app.last_request_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
