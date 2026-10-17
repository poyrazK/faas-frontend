'use client';

import { useCallback, useState } from 'react';
import { listHostingHistory, type HostingRelease, type HostingSite, type HostingPreview } from '@/lib/hosting';
import { useHostingQuery } from '@/lib/useHostingQuery';
import { hostingSiteURL } from '@/lib/hosting';
import { HostingProvenance } from './HostingProvenance';

export function HostingHistory({ site, releases, disabled, onReview, previews }: {
 site: HostingSite; releases: HostingRelease[]; disabled: boolean;
 onReview: (releaseID: string) => void; previews?: HostingPreview[];
}) {
 const [before, setBefore] = useState(0);
 const fetcher = useCallback(async (signal: AbortSignal) => ({ ...await listHostingHistory(site.id, before, signal), beforeRevision: before }), [site.id, before]);
 const query = useHostingQuery(fetcher, 5000);
 const stale = !!query.error || !query.data || query.data.beforeRevision !== before;
 return <section className="space-y-3 rounded-lg border border-[var(--color-line)] p-4" aria-label="Deployment history">
  <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Deployment history</h3><div className="flex gap-2"><button className="btn btn-ghost btn-sm" onClick={() => { setBefore(0); query.refresh(); }}>Latest history</button><button className="btn btn-ghost btn-sm" onClick={query.refresh}>Refresh history</button></div></div>
  <p className="text-xs text-[var(--color-ink-muted)]">Accepted promotion intent, recorded while history was enabled. Entries do not confirm edge publication or serving health. Keeps the latest {query.data?.retention_limit ?? 'bounded number of'} entries; older entries and periods with capture disabled may be absent.</p>
  {query.error && <p className="text-sm text-[var(--color-danger)]" role="alert">{query.error.message} History could not be refreshed.</p>}
  {!query.data && !query.error && <p className="text-xs">Loading history…</p>}
  {query.data?.events.length === 0 && <p className="text-xs">No recorded promotions on this page.</p>}
  {query.data?.events.map(event => {
   const retained = releases.some(r => r.id === event.release_id && r.state === 'ready');
   return <article className="space-y-2 border-t border-[var(--color-line)] pt-3" key={event.revision}>
    <p className="text-sm">Revision {event.revision} · {event.release_id === site.active_release_id ? 'Current intended release' : retained ? 'Retained release' : 'Release files unavailable'}</p>
    <p className="break-all font-mono text-xs">{event.previous_release_id || 'Empty site'} → {event.release_id}</p>
    <p className="break-all text-xs">Accepted {new Date(event.accepted_at).toLocaleString()} · Actor account {event.actor.account_id}{event.actor.key_id ? ` · Key ${event.actor.key_id}` : ''}</p>
    <HostingProvenance value={event.provenance} />
    <div className="flex flex-wrap gap-2">
     <button className="btn btn-secondary btn-sm" disabled={disabled || stale || !retained || site.status !== 'active' || event.release_id === site.active_release_id} onClick={() => onReview(event.release_id)}>Review this release</button>
     {!disabled && !stale && !site.suspended && site.status === 'active' && previews?.filter(p => p.release_id === event.release_id && !p.revoked && p.published_generation === p.generation && new Date(p.expires_at).getTime() > new Date(query.observedAt || 0).getTime()).map(p => hostingSiteURL(p.hostname) && <a key={p.id} className="btn btn-ghost btn-sm" href={hostingSiteURL(p.hostname)!} target="_blank" rel="noreferrer">Open release preview ↗</a>)}
    </div>
   </article>;
  })}
  {!!query.data?.next_before_revision && <button className="btn btn-secondary btn-sm" disabled={stale} onClick={() => setBefore(query.data!.next_before_revision!)}>Older promotions</button>}
 </section>;
}
