'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createHostingOIDCTrust, listHostingOIDCTrusts, revokeHostingOIDCTrust, type HostingOIDCTrustRules, type HostingSite } from '@/lib/hosting';
import { useHostingQuery } from '@/lib/useHostingQuery';
import { CopyButton } from '@/components/ui/bits';

const empty: HostingOIDCTrustRules = { repository_owner_id: '', repository_id: '', repository: '', ref: 'refs/heads/main', workflow_ref: '', event_name: 'push', environment: '' };
export function HostingOIDC({ site, disabled }: { site: HostingSite; disabled: boolean }) {
  const fetcher = useCallback((signal: AbortSignal) => listHostingOIDCTrusts(site.id, signal), [site.id]);
  const query = useHostingQuery(fetcher);
  const [draft, setDraft] = useState(empty);
  const [review, setReview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const blocked = disabled || busy || !query.data || !!query.error || needsRefresh !== null && (!query.observedAt || query.observedAt <= needsRefresh);
  const serialized = JSON.stringify(draft);
  function edit(next: Partial<HostingOIDCTrustRules>) { setDraft({ ...draft, ...next }); setReview(null); setMessage(''); }
  async function mutate(action: (signal: AbortSignal) => Promise<unknown>, success: string) {
    if (blocked) return;
    const work = new AbortController(); controller.current = work; setBusy(true); setMessage('');
    try { await action(work.signal); if (!work.signal.aborted) setMessage(success); }
    catch (error) { if (!work.signal.aborted) setMessage((error instanceof Error ? error.message : 'Trust update not confirmed.') + ' Refresh the trust list before retrying.'); }
    finally { if (!work.signal.aborted) { setBusy(false); setReview(null); setNeedsRefresh(new Date().toISOString()); query.refresh(); } if (controller.current === work) controller.current = null; }
  }
  return <section className="space-y-3 rounded-lg border border-[var(--color-line)] p-4" aria-label="GitHub deployment identity">
    <div className="flex justify-between gap-3"><h3 className="font-semibold">GitHub deployment identity</h3><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setReview(null); query.refresh(); }}>Refresh trusts</button></div>
    <p className="text-xs">Allow a specific GitHub workflow to stage releases and create private previews without storing a Gregale token. These jobs cannot publish to your production URL. Configure repository IDs from GitHub; identity is verified when a job exchanges its signed token.</p>
    <div className="flex flex-wrap items-center gap-2 text-xs"><span>Audience: <code>{'gregale:hosting:' + site.id}</code></span><CopyButton value={'gregale:hosting:' + site.id} label="Copy audience" /></div>
    {query.error && <p role="alert" className="text-sm">{query.error.message} Trust changes are paused.</p>}
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!blocked) setReview(serialized); }}>
      <fieldset disabled={blocked} className="grid gap-3 sm:grid-cols-2">
        {([
          ['repository_owner_id', 'GitHub repository owner ID', '123456', 20], ['repository_id', 'GitHub repository ID', '987654', 20],
          ['repository', 'Repository', 'owner/repository', 200], ['ref', 'Branch ref', 'refs/heads/main', 255],
          ['workflow_ref', 'Workflow ref', 'owner/repository/.github/workflows/preview.yml@refs/heads/main', 512], ['environment', 'GitHub environment (optional)', 'internal-preview', 255],
        ] as const).map(([key, label, placeholder, max]) => <label className="text-xs" key={key}>{label}<input className="field mt-1" aria-label={label} value={draft[key] || ''} placeholder={placeholder} maxLength={max} required={key !== 'environment'} pattern={key.endsWith('_id') ? '[1-9][0-9]{0,19}' : undefined} onChange={event => edit({ [key]: event.target.value })} /></label>)}
        <label className="text-xs">GitHub event<select className="field mt-1" aria-label="GitHub event" value={draft.event_name} onChange={event => edit({ event_name: event.target.value as HostingOIDCTrustRules['event_name'] })}><option value="push">push</option><option value="workflow_dispatch">workflow_dispatch</option><option value="schedule">schedule</option></select></label>
      </fieldset>
      <button className="btn btn-secondary btn-sm" disabled={blocked}>Review trust binding</button>
      {review === serialized && <div className="space-y-2 rounded border border-[var(--color-line)] p-3 text-xs"><p>Grant <strong>{draft.repository}</strong>, branch <strong>{draft.ref}</strong>, workflow <strong>{draft.workflow_ref}</strong>, event <strong>{draft.event_name}</strong>{draft.environment ? `, environment ${draft.environment}` : ''} access to this site&apos;s staging and private previews. Repository and owner IDs must also match. Pull request events are excluded.</p><button type="button" className="btn btn-secondary btn-sm" disabled={blocked} onClick={() => void mutate(signal => createHostingOIDCTrust(site.id, draft, signal), 'Trust binding created. Copy its trust ID into the frontend hosting Action with oidc-enabled: true.')}>Create reviewed trust</button></div>}
    </form>
    {query.data?.map(trust => <div key={trust.id} className="space-y-1 rounded border border-[var(--color-line)] p-3 text-xs">
      <p className="font-medium">{trust.repository} · {trust.ref} · {trust.event_name}</p>
      <p className="break-all">{trust.workflow_ref}{trust.environment ? ` · Environment: ${trust.environment}` : ''}</p>
      <p>Owner ID: {trust.repository_owner_id} · Repository ID: {trust.repository_id}</p>
      <div className="flex flex-wrap items-center gap-2"><code>{trust.id}</code><CopyButton value={trust.id} label="Copy trust ID" /><button className="btn btn-ghost btn-sm" disabled={blocked} onClick={() => { if (window.confirm(`Revoke GitHub trust ${trust.id} for ${trust.repository}? Issued credentials stop working on their next request.`)) void mutate(signal => revokeHostingOIDCTrust(site.id, trust.id, signal), 'Trust revoked. Its issued credentials are invalidated.'); }}>Revoke trust</button></div>
    </div>)}
    {query.data?.length === 0 && <p className="text-xs">No GitHub trust bindings for this site.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
