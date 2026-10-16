'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getHostingStatus, listHostingReleases, promoteHostingRelease, suspendHostingSite, deleteHostingSite,
  retireHostingRelease, finalizeHostingRelease, hostingSiteURL,
  type HostingCapabilities, type HostingSiteStatus, type HostingReleaseReview as Review,
} from '@/lib/hosting';
import { ApiError } from '@/lib/api';
import { deployHostingDirectory, type HostingDeployProgress } from '@/lib/hosting-upload';
import { useHostingQuery } from '@/lib/useHostingQuery';
import { Spinner } from '@/components/ui/States';
import { CopyButton } from '@/components/ui/bits';
import { hostingAnalyticsDashboardEnabled, hostingDomainsDashboardEnabled, hostingConfigDashboardEnabled } from '@/lib/hosting-flag';
import { HostingTraffic } from './HostingTraffic';
import { HostingDomains } from './HostingDomains';
import { HostingReleaseReview } from './HostingReleaseReview';
import { reviewHostingRelease, hostingReviewIsCurrent } from '@/lib/hosting-review';

export function HostingSiteDetail({ id, limits, inventoryStale, onChange, onClose }: {
  id: string; limits: HostingCapabilities; inventoryStale: boolean; onChange: () => void; onClose: () => void;
}) {
  const fetcher = useCallback(async (signal: AbortSignal) => {
    const [status, releases] = await Promise.all([getHostingStatus(id, signal), listHostingReleases(id, signal)]);
    return { status, releases };
  }, [id]);
  const query = useHostingQuery(fetcher, 5000);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [spa, setSpa] = useState(false);
  const [stageOnly, setStageOnly] = useState(true);
  const [review, setReview] = useState<Review | null>(null);
  const [progress, setProgress] = useState<HostingDeployProgress | null>(null);
  const upload = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => upload.current?.abort(), []);
  const data = query.data;
  const site = data?.status.site;
  // A failed/ambiguous write requires a successful refresh before another
  // mutation. Never silently retry with the new revision after a conflict.
  const awaitingRefresh = needsRefresh !== null && (!query.observedAt || query.observedAt <= needsRefresh);
  const disabled = busy || inventoryStale || !!query.error || awaitingRefresh || !site || site.status === 'deleting';

  async function run(action: () => Promise<unknown>, success: string) {
    if (disabled) return;
    setBusy(true); setError(''); setMessage(''); setProgress(null);
    try { await action(); setMessage(success); }
    catch (error) { setError(error instanceof ApiError && error.status === 409 ? 'The site changed. Refresh, review the current release and suspension state, then try again.' : error instanceof Error ? error.message : 'The hosting action failed.'); }
    finally { setNeedsRefresh(new Date().toISOString()); setBusy(false); query.refresh(); onChange(); }
  }

  return <section className="card space-y-5 p-5" aria-label="Site management">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{site?.name || 'Site details'}</h2><div className="flex gap-2">
      <button className="btn btn-secondary btn-sm" disabled={busy} onClick={query.refresh}>Refresh details</button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>Close</button>
    </div></div>
    {query.error && <p className="text-sm text-[var(--color-danger)]" role="alert">{query.error.message} Changes are paused. {query.error instanceof ApiError && query.error.status === 404 && 'The site may have finished deletion; close this panel to refresh sites.'}</p>}
    {!site || !data ? (!query.error && <div className="flex gap-2"><Spinner /> Loading site…</div>) : <>
      <div className="flex flex-wrap items-center gap-3"><span className={`badge ${site.suspended || site.status === 'deleting' ? 'badge-warning' : 'badge-neutral'}`}>{site.status === 'deleting' ? 'Deletion requested' : site.suspended ? 'Suspension requested' : 'Enabled intent'}</span>
        {hostingSiteURL(site.hostname) && <a className="text-sm underline" href={hostingSiteURL(site.hostname)!} target="_blank" rel="noreferrer">Open site ↗</a>}
        <CopyButton value={hostingSiteURL(site.hostname) || site.hostname} label="Copy URL" />
      </div>
      <Publication status={data.status} />
      {hostingAnalyticsDashboardEnabled && limits.analytics_enabled && <HostingTraffic key={site.id} siteID={site.id} />}
      {hostingDomainsDashboardEnabled && limits.domains_enabled && <HostingDomains key={site.id} site={site} limits={limits} disabled={busy || inventoryStale || !!query.error || awaitingRefresh} />}
      <div className="flex flex-wrap gap-2">
        {site.durable_routing && <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => {
          if (window.confirm(`${site.suspended ? 'Resume' : 'Suspend'} ${site.name}? The change applies after publication and edge refresh.`)) void run(() => suspendHostingSite(id, !site.suspended, site.revision), `${site.suspended ? 'Resume' : 'Suspension'} accepted. Publication is tracked below.`);
        }}>{site.suspended ? 'Resume site' : 'Suspend site'}</button>}
        <button className="btn btn-secondary btn-sm text-[var(--color-danger)]" disabled={disabled} onClick={() => {
          if (window.confirm(`Delete ${site.name} and all its releases? This cannot be undone. Traffic stops after publication and edge refresh; cleanup continues afterward.`)) void run(() => deleteHostingSite(id), 'Deletion accepted. Routing removal and artifact cleanup continue in the background.');
        }}>Delete site</button>
      </div>
      {site.status === 'deleting' ? <p className="text-sm text-[var(--color-ink-muted)]">This site will disappear after routing removal and the cleanup grace period. Its URL will not be reused.</p> : <form className="space-y-3 rounded-lg border border-[var(--color-line)] p-4" onSubmit={(event) => {
        event.preventDefault();
        if (disabled || files.length === 0 || data.releases.length >= limits.releases_per_site) return;
        const controller = new AbortController(); upload.current = controller;
        void run(async () => {
          await deployHostingDirectory(site, files, spa, limits, controller.signal, setProgress, stageOnly);
          setFiles([]); if (input.current) input.current.value = '';
        }, stageOnly ? 'Release staged and verified. Review its changes before publishing.' : 'Deployment accepted. Watch publication progress before checking the site.').finally(() => { if (upload.current === controller) upload.current = null; });
      }}>
        <h3 className="font-semibold">Deploy a built frontend</h3>
        <p className="text-sm text-[var(--color-ink-muted)]">Select your build output folder, such as dist or out, with index.html at its root. Limits: {limits.files_max} files, {mib(limits.file_max_bytes)} MiB per file, {mib(limits.release_max_bytes)} MiB total.</p>
        {hostingConfigDashboardEnabled && limits.config_enabled && <p className="text-sm text-[var(--color-ink-muted)]">Include gregale-hosting.json at the folder root to configure redirects, response headers, and an HTML 404 page. These settings are restored with a release rollback.</p>}
        <label className="block text-sm">Output directory<input ref={input} aria-label="Built output directory" className="field mt-1" type="file" multiple {...{ webkitdirectory: '' }} disabled={disabled} onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setError(''); setProgress(null); }} /></label>
        {files.length > 0 && <p className="text-xs">{files.length} files selected · {mib(files.reduce((total, file) => total + file.size, 0))} MiB</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={spa} disabled={disabled} onChange={(event) => setSpa(event.target.checked)} /> Use index.html for single-page app routes</label>
        {limits.staged_releases_supported && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stageOnly} disabled={disabled} onChange={(event) => setStageOnly(event.target.checked)} /> Stage and verify without publishing</label>}
        {!limits.staged_releases_supported && stageOnly && <p role="alert" className="text-sm">This API needs an upgrade before it can stage releases safely.</p>}
        <p className="text-xs text-[var(--color-ink-muted)]">Publishing replaces the site&apos;s active release. {site.suspended ? 'The site will remain suspended.' : 'Older verified releases remain available for rollback.'}</p>
        <button className="btn btn-primary btn-sm" disabled={disabled || files.length === 0 || data.releases.length >= limits.releases_per_site || stageOnly && !limits.staged_releases_supported}>{stageOnly ? 'Stage release' : 'Deploy and publish'}</button>
        {data.releases.length >= limits.releases_per_site && <p className="text-sm">This site has reached its {limits.releases_per_site}-release limit. Retire an unused release and wait for cleanup before deploying again.</p>}
      </form>}
      {progress && <div className="space-y-2 text-sm" role="status" aria-live="polite">
        <p>{phaseLabel(progress)}{progress.releaseID && <> · Release <code>{progress.releaseID}</code></>}</p>
        {(progress.phase === 'uploading' || progress.phase === 'hashing') && <progress className="w-full" aria-label="Deployment progress" max={Math.max(1, progress.total)} value={progress.completed} />}
        {busy && <button type="button" className="btn btn-secondary btn-sm" onClick={() => upload.current?.abort()}>Stop deployment</button>}
      </div>}
      {busy && !progress && <p role="status" className="text-sm">Applying change…</p>}
      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {review && <HostingReleaseReview review={review} stale={!hostingReviewIsCurrent(review, site, data.releases)} disabled={disabled}
        onClose={() => setReview(null)} onPublish={() => {
          if (disabled || !hostingReviewIsCurrent(review, site, data.releases)) return;
          if (window.confirm(`Publish reviewed release ${review.release_id.slice(0,8)} at revision ${review.expected_revision}?`)) {
            void run(() => promoteHostingRelease(id, review.release_id, review.expected_revision), 'Release promotion accepted. Watch publication progress.').finally(() => setReview(null));
          }
        }} />}
      <div className="space-y-3"><h3 className="font-semibold">Releases <span className="text-xs font-normal text-[var(--color-ink-muted)]">{data.releases.length} / {limits.releases_per_site}</span></h3>
        {data.releases.length === 0 ? <p className="text-sm text-[var(--color-ink-muted)]">No releases yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-xs text-[var(--color-ink-muted)]"><tr>{['Release', 'State', 'Created', 'Files / size', 'Actions'].map((label) => <th className="p-2 font-medium" key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.releases.map((release) => {
            const active = release.id === site.active_release_id;
            return <tr key={release.id} className="border-t border-[var(--color-line)]">
              <td className="p-2 font-mono text-xs" title={release.id}>{release.id.slice(0, 8)}</td>
              <td className="p-2"><span className={`badge ${active ? 'badge-brand' : 'badge-neutral'}`}>{active ? 'Active intent' : release.state === 'pending' ? 'Awaiting verification' : release.state === 'retiring' ? 'Retiring' : release.first_promoted_at ? 'Previously published' : 'Staged / verified'}</span></td>
              <td className="p-2 text-xs">{new Date(release.created_at).toLocaleString()}</td>
              <td className="p-2 text-xs">{release.manifest.files.length} / {mib(release.manifest.files.reduce((total, file) => total + file.size, 0))} MiB</td>
              <td className="p-2"><div className="flex flex-wrap gap-2">
                {release.state === 'ready' && !active && <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => {
                  try { setReview(reviewHostingRelease(site, data.releases, release.id)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Comparison unavailable. Refresh and retry.'); }
                }}>Review / publish</button>}
                {release.state === 'pending' && <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => void run(() => finalizeHostingRelease(id, release.id, limits), 'Verification completed. Publish the verified release when ready.')}>Verify upload</button>}
                {!active && release.state !== 'retiring' && <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => {
                  if (window.confirm(`Retire release ${release.id.slice(0, 8)}? It will no longer be available for rollback after cleanup.`)) void run(() => retireHostingRelease(id, release.id), 'Retirement accepted. The release remains listed until safe cleanup finishes.');
                }}>Retire</button>}
              </div></td>
            </tr>;
          })}</tbody>
        </table></div>}
        <p className="text-xs text-[var(--color-ink-muted)]">Last refreshed {query.observedAt ? new Date(query.observedAt).toLocaleTimeString() : '—'} · refreshes every 5 seconds.</p>
      </div>
    </>}
  </section>;
}

function Publication({ status }: { status: HostingSiteStatus }) {
  const { site, publication: p } = status;
  const errors: Record<string, string> = { origin_unavailable: 'The publication origin is unavailable.', publication_unavailable: 'The edge publication service is unavailable.', stale_generation: 'A newer routing change is waiting to be published.' };
  return <div className="space-y-2 rounded-lg bg-[var(--color-surface-subtle)] p-4 text-sm" aria-label="Publication status">
    <div className="flex flex-wrap items-center gap-3"><strong>{p.state === 'pending' ? 'Publication pending' : p.state === 'published' ? 'Published to origin' : 'Publication untracked'}</strong>
      {site.durable_routing && <span className="font-mono text-xs">Generation {p.published_generation ?? 0} / {p.generation}</span>}
    </div>
    <p className="text-xs text-[var(--color-ink-muted)]">{p.state === 'untracked' ? 'This legacy site uses short routing leases and has no publication receipt.' : 'A publication receipt confirms routing was stored. Edge locations may take up to 60 seconds to refresh; this is not a serving health check.'}</p>
    {p.pending_since && <p className="text-xs">Pending since {new Date(p.pending_since).toLocaleString()}</p>}
    {p.published_at && <p className="text-xs">Last publication {new Date(p.published_at).toLocaleString()}</p>}
    {p.last_error_code && <p className="text-xs text-[var(--color-danger)]">{errors[p.last_error_code] || 'Publication needs attention.'} {p.state === 'pending' ? 'Gregale will retry automatically.' : 'The last repair check failed.'}</p>}
    {p.retry_count > 0 && <p className="text-xs">{p.retry_count} failed attempts{p.next_attempt_at ? ` · Next attempt ${new Date(p.next_attempt_at).toLocaleTimeString()}` : ''}</p>}
  </div>;
}

const mib = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
function phaseLabel(p: HostingDeployProgress): string {
  switch (p.phase) {
    case 'hashing': return `Checking files ${p.completed} / ${p.total}`;
    case 'creating': return 'Creating release…';
    case 'uploading': return `Uploaded ${p.completed} / ${p.total} files · ${mib(p.bytes)} / ${mib(p.totalBytes)} MiB`;
    case 'verifying': return 'Verifying uploaded files…';
    case 'promoting': return 'Requesting publication…';
    case 'accepted': return 'Deployment accepted';
    case 'staged': return 'Release staged and verified';
  }
}
