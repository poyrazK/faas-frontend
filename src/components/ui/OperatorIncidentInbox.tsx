'use client';

import { useState } from 'react';
import { getObsIncidents } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { SectionCard } from './Panels';
import { SnapshotFreshness } from './SnapshotFreshness';

export function OperatorIncidentInbox() {
  const [cursor, setCursor] = useState('');
  const [severity, setSeverity] = useState('');
  const snapshot = useAsync(() => getObsIncidents(cursor, severity), [cursor, severity], 30000);
  const data = snapshot.data;
  return (
    <div className="my-6">
      <SectionCard title="Incident Inbox" action={
        <select aria-label="Incident severity" value={severity} onChange={(event) => { setSeverity(event.target.value); setCursor(''); }} className="text-xs">
          <option value="">All severities</option><option value="critical">Critical</option><option value="error">Error</option><option value="warning">Warning</option>
        </select>
      }>
        <div className="p-4 text-sm">
          <SnapshotFreshness snapshots={[snapshot]} />
          {snapshot.error && <p role="alert">Could not refresh incidents: {snapshot.error.message}</p>}
          {!!data?.unavailable_sources?.length && <p role="alert" className="text-[var(--color-warning)]">Incomplete snapshot: {data.unavailable_sources.join(', ')} is unavailable.</p>}
          {snapshot.loading && !data ? <p>Loading incidents…</p> : data?.items.length === 0 ? <p>{data.unavailable_sources?.length ? 'No incidents from the available sources.' : 'No incidents in this window.'}</p> : (
            <div className="divide-y divide-[var(--color-line)]">
              {data?.items.map((item) => <div key={item.id} className="py-3"><span className={`badge ${item.severity === 'critical' || item.severity === 'error' ? 'badge-danger' : 'badge-warning'}`}>{item.severity}</span> <span className="font-semibold">{item.summary}</span><div className="mt-1 text-xs text-[var(--color-ink-muted)]">{item.resource_name ?? item.resource_id} · {new Date(item.observed_at).toLocaleString()}</div></div>)}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            {cursor && <button className="btn btn-secondary btn-xs" onClick={() => setCursor('')}>Newest</button>}
            {data?.next_cursor && <button className="btn btn-secondary btn-xs" disabled={snapshot.loading} onClick={() => setCursor(data.next_cursor)}>Older incidents</button>}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
