'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { getHostingCleanupPlan, setHostingRetentionPolicy, type HostingCapabilities, type HostingCleanupPlan, type HostingSite } from '@/lib/hosting';
import { cleanupReason, retentionReviewCurrent, retentionRules } from '@/lib/hosting-retention';
import { useHostingQuery } from '@/lib/useHostingQuery';

const reservation = (bytes: number) => `${(bytes / 1048576).toFixed(2)} MiB`;
export function HostingRetention({ site, limits, disabled }: { site: HostingSite; limits: HostingCapabilities; disabled: boolean }) {
  const fetcher = useCallback((signal: AbortSignal) => getHostingCleanupPlan(site.id, undefined, signal), [site.id]);
  const query = useHostingQuery(fetcher);
  const [draft, setDraft] = useState<{ pending: string; staged: string; enabled: boolean } | null>(null);
  const [review, setReview] = useState<HostingCleanupPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const current = query.data;
  const values = draft || { pending: String((current?.policy.pending_age_seconds || limits.retention_age_default_seconds || 86400) / 3600), staged: String((current?.policy.staged_age_seconds || limits.retention_age_default_seconds || 86400) / 3600), enabled: current?.policy.enabled || false };
  const rules = retentionRules(values.pending, values.staged, limits.retention_age_min_seconds || 3600, limits.retention_age_max_seconds || 2592000);
  const stale = !current || !!query.error || needsRefresh !== null && (!query.observedAt || query.observedAt <= needsRefresh);
  const blocked = disabled || busy || stale;
  const reviewed = !blocked && !!rules && !!review && !!current && retentionReviewCurrent(review, current, rules);
  const plan = review || current;
  function edit(next: Partial<typeof values>) { setDraft({ ...values, ...next }); setReview(null); setMessage(''); }
  async function preview() {
    if (blocked || !rules) return;
    const work = new AbortController(); controller.current = work;
    setBusy(true); setReview(null); setMessage('');
    try { const result = await getHostingCleanupPlan(site.id, rules, work.signal); if (!work.signal.aborted) setReview(result); }
    catch (error) { if (!work.signal.aborted) setMessage(error instanceof Error ? error.message : 'Cleanup preview unavailable.'); }
    finally { if (!work.signal.aborted) setBusy(false); if (controller.current === work) controller.current = null; }
  }
  async function save() {
    if (!reviewed || !review || !rules) return;
    if (!window.confirm(values.enabled ? 'Enable automatic cleanup under these age rules? Eligible abandoned uploads and expired CI releases will be retired in the background. Published releases and preview references stay protected.' : 'Disable automatic retirement for this site? Cleanup of releases already retiring will continue.')) return;
    const work = new AbortController(); controller.current = work; setBusy(true); setMessage('');
    try {
      await setHostingRetentionPolicy(site.id, { ...rules, enabled: values.enabled, expected_revision: review.policy.revision }, work.signal);
      if (!work.signal.aborted) { setMessage('Retention policy accepted. Reservations are released only after artifact cleanup succeeds.'); setDraft(null); }
    } catch (error) { if (!work.signal.aborted) setMessage((error instanceof Error ? error.message : 'Policy update not confirmed.') + ' Refresh and review before trying again.'); }
    finally { if (!work.signal.aborted) { setReview(null); setNeedsRefresh(new Date().toISOString()); setBusy(false); query.refresh(); } if (controller.current === work) controller.current = null; }
  }
  return <section className="space-y-3 rounded-lg border border-[var(--color-line)] p-4" aria-label="Automatic cleanup">
    <div className="flex justify-between gap-3"><h3 className="font-semibold">Automatic cleanup</h3><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setReview(null); query.refresh(); }}>Refresh cleanup</button></div>
    <p className="text-xs">Published releases, manual staged releases, CI retry windows and preview references stay protected. Cleanup preserves CI run identities. It does not free the 1,000-run limit.</p>
    {query.error && <p role="alert" className="text-sm text-[var(--color-danger)]">{query.error.message} Cleanup data is unavailable; policy changes are paused.</p>}
    {current && <p className="text-xs">Policy: {current.policy.enabled ? 'Enabled' : 'Disabled'} · Revision {current.policy.revision} · Observed {new Date(current.evaluated_at).toLocaleString()}</p>}
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); void preview(); }}>
      <div className="flex flex-wrap gap-3">{([['pending', 'Abandoned upload idle age (hours)'], ['staged', 'Expired CI release idle age (hours)']] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<input className="field mt-1" aria-label={label} type="number" step="any" min={(limits.retention_age_min_seconds || 3600) / 3600} max={(limits.retention_age_max_seconds || 2592000) / 3600} value={values[key]} disabled={blocked} onChange={event => edit({ [key]: event.target.value })} /></label>)}</div>
      <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="Enable automatic cleanup" checked={values.enabled} disabled={blocked} onChange={event => edit({ enabled: event.target.checked })} /> Enable automatic cleanup for this site</label>
      <button className="btn btn-secondary btn-sm" disabled={blocked || !rules}>Preview cleanup rules</button>
      <button type="button" className="btn btn-secondary btn-sm ml-2" disabled={!reviewed} onClick={() => void save()}>Save reviewed policy</button>
    </form>
    {message && <p role="status" className="text-sm">{message}</p>}
    {review && current && rules && !retentionReviewCurrent(review, current, rules) && <p role="alert" className="text-sm">The policy changed. Refresh and review again.</p>}
    {plan && <>
      <p className="text-xs">{review ? 'Proposed rules' : 'Current rules'} · Eligible reservations: {reservation(plan.reclaimable_reserved_bytes)} · Already awaiting cleanup: {reservation(plan.retiring_reserved_bytes)}</p>
      <p className="text-xs text-[var(--color-ink-muted)]">These are catalog reservations, not measured storage or immediate savings. {current?.policy.enabled ? 'The background worker rechecks eligibility before retirement.' : 'Automatic retirement is disabled; this preview changes nothing.'}</p>
      {plan.entries.length === 0 ? <p className="text-xs">No retained releases.</p> : <ul className="space-y-2">{plan.entries.map(entry => <li key={entry.release_id} className="border-t border-[var(--color-line)] pt-2 text-xs"><p className="break-all font-mono">{entry.release_id}</p><p>{entry.eligible ? 'Eligible' : entry.state === 'retiring' ? 'Cleanup pending' : 'Protected'} · {cleanupReason(entry.reason)} · {reservation(entry.reserved_bytes)}</p>{entry.eligible_at && <p>Age / retry threshold: {new Date(entry.eligible_at).toLocaleString()}</p>}</li>)}</ul>}
    </>}
  </section>;
}
