'use client';

import { useCallback, useState } from 'react';
import { useHostingQuery } from '@/lib/useHostingQuery';
import { createHostingPreview, listHostingPreviews, revokeHostingPreview, hostingSiteURL, type HostingCapabilities, type HostingRelease, type HostingSite } from '@/lib/hosting';
import { CopyButton } from '@/components/ui/bits';

export function HostingPreviews({ site, releases, limits, disabled }: { site: HostingSite; releases: HostingRelease[]; limits: HostingCapabilities; disabled: boolean }) {
  const fetcher = useCallback((signal: AbortSignal) => listHostingPreviews(site.id, signal), [site.id]);
  const query = useHostingQuery(fetcher, 5000);
  const [releaseID, setReleaseID] = useState('');
  const [ttl, setTTL] = useState(String((limits.preview_ttl_default_seconds || 86400) / 60));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState<string | null>(null);
  const stale = !!query.error || !query.data || (needsRefresh !== null && (!query.observedAt || query.observedAt <= needsRefresh));
  const blocked = disabled || busy || stale;
  const seconds = Number(ttl) * 60;
  const validTTL = Number.isSafeInteger(seconds) && seconds >= (limits.preview_ttl_min_seconds || 300) && seconds <= (limits.preview_ttl_max_seconds || 259200);
  async function run(action: () => Promise<unknown>, success: string) {
    if (blocked) return;
    setBusy(true); setMessage('');
    try { await action(); setMessage(success); }
    catch (error) { setMessage((error instanceof Error ? error.message : 'Preview request failed.') + ' Refresh previews before retrying an uncertain request.'); }
    finally { setBusy(false); setNeedsRefresh(new Date().toISOString()); query.refresh(); }
  }
  return <section className="space-y-3 rounded-lg border border-[var(--color-line)] p-4" aria-label="Private previews">
    <div className="flex justify-between gap-3"><h3 className="font-semibold">Private previews</h3><button className="btn btn-ghost btn-sm" disabled={busy} onClick={query.refresh}>Refresh previews</button></div>
    <p className="text-xs text-[var(--color-ink-muted)]">Each URL stays on one verified release and requires internal Access sign-in. Promotion does not change it. Referenced files stay retained until preview cleanup finishes.</p>
    {query.error && <p role="alert" className="text-sm text-[var(--color-danger)]">{query.error.message}</p>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (!validTTL || !releases.some(r => r.id === releaseID && r.state === 'ready')) return; void run(() => createHostingPreview(site.id, releaseID, seconds), 'Preview accepted. Wait for publication, then open it.'); }}>
      <label className="text-xs">Verified release<select aria-label="Preview release" className="input mt-1" value={releaseID} disabled={blocked} onChange={event => setReleaseID(event.target.value)}><option value="">Select release</option>{releases.filter(r => r.state === 'ready').map(r => <option key={r.id} value={r.id}>{r.id}{r.first_promoted_at || r.id === site.active_release_id ? ' (published before)' : ' (staged)'}</option>)}</select></label>
      <label className="text-xs">Expires after (minutes)<input aria-label="Preview lifetime in minutes" className="input mt-1" type="number" min={(limits.preview_ttl_min_seconds || 300) / 60} max={(limits.preview_ttl_max_seconds || 259200) / 60} step="1" value={ttl} disabled={blocked} onChange={event => setTTL(event.target.value)} /></label>
      <button className="btn btn-secondary btn-sm" disabled={blocked || !releaseID || !validTTL || (query.data?.length || 0) >= (limits.previews_per_site || 8)}>Create preview</button>
    </form>
    {message && <p className="text-sm" role="status">{message}</p>}
    {query.data?.length === 0 && <p className="text-xs">No private previews.</p>}
    {query.data?.map(p => <article key={p.id} className="space-y-2 border-t border-[var(--color-line)] pt-3">
      <p className="break-all font-mono text-xs">{p.hostname}</p><p className="break-all text-xs">Release {p.release_id} · Expires {new Date(p.expires_at).toLocaleString()}</p>
      <p className="text-xs">{p.revoked ? 'Revocation requested; cleanup pending' : new Date(p.expires_at).getTime() <= new Date(query.observedAt || 0).getTime() ? 'Expired; cleanup pending' : p.published_generation === p.generation ? 'Publication acknowledged' : 'Publication pending'} · Edge refresh may take up to 60 seconds after publication.</p>
      {p.last_error_code && <p className="text-xs text-[var(--color-danger)]">Preview publication needs attention. Gregale will retry.</p>}
      <div className="flex flex-wrap gap-2">
        {!blocked && !site.suspended && site.status === 'active' && !p.revoked && new Date(p.expires_at).getTime() > new Date(query.observedAt || 0).getTime() && p.published_generation === p.generation && hostingSiteURL(p.hostname) && <><a className="btn btn-secondary btn-sm" href={hostingSiteURL(p.hostname)!} target="_blank" rel="noreferrer">Open preview ↗</a><CopyButton value={hostingSiteURL(p.hostname)!} label="Copy preview URL" /></>}
        {!p.revoked && <button className="btn btn-ghost btn-sm" disabled={blocked} onClick={() => void run(() => revokeHostingPreview(site.id, p.id, p.generation), 'Revocation accepted. Edge refresh and cleanup continue in the background.')}>Revoke preview</button>}
      </div>
    </article>)}
  </section>;
}
