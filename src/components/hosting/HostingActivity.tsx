'use client';

import { useCallback, useState } from 'react';
import { listHostingActivity } from '@/lib/hosting';
import { useHostingQuery } from '@/lib/useHostingQuery';
import { HostingProvenance } from './HostingProvenance';
import { CopyButton } from '@/components/ui/bits';

type Props = {siteID: string; disabled: boolean; showSource: boolean; reviewableReleaseIDs: string[]; onReview: (release: string) => void; onInspect?: (run: string) => void};
const labels = {recorded: 'Recorded', pending: 'Pending', blocked: 'Blocked', unknown: 'Unknown'};
export function HostingActivity(props: Props) {
  const [before, setBefore] = useState('');
  return <section className="space-y-3 rounded-lg border border-[var(--color-line)] p-4" aria-label="Deployment activity">
    <h3 className="font-semibold">Deployment activity</h3>
    <p className="text-xs">CI runs recorded by Gregale, newest first. States describe stored intent, verification and preview publication. GitHub job status and serving health are not checked. Jobs that failed before Gregale recorded an intent are absent.</p>
    <ActivityPage key={props.siteID + ':' + before} {...props} before={before} onPage={setBefore} />
  </section>;
}
function ActivityPage({siteID, disabled, showSource, reviewableReleaseIDs, onReview, onInspect, before, onPage}: Props & {before: string; onPage: (cursor: string) => void}) {
  const fetcher = useCallback((signal: AbortSignal) => listHostingActivity(siteID, before, signal), [siteID, before]);
  const query = useHostingQuery(fetcher);
  const valid = query.data?.site_id === siteID && query.data.serving_health === 'not_checked' && (!query.data.next_cursor || query.data.next_cursor !== before);
  const page = !query.error && valid && !disabled ? query.data : null;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2"><button className="btn btn-ghost btn-sm" disabled={disabled} onClick={query.refresh}>Refresh activity</button>{before && <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => onPage('')}>Newest runs</button>}</div>
    {query.error && <p role="alert" className="text-sm">{query.error.message} Activity and its actions are unavailable until a successful refresh.</p>}
    {disabled && <p className="text-xs">Activity is paused while site details are unavailable or changing.</p>}
    {!disabled && !query.data && !query.error && <p className="text-xs">Reading recorded CI runs…</p>}
    {!disabled && query.data && !query.error && !valid && <p role="alert" className="text-sm">Activity response does not match this site or page. Refresh before inspecting a run.</p>}
    {page && <>
      <p className="text-xs">Observed {new Date(page.observed_at).toLocaleString()}. Refresh before taking an action. A recorded publication acknowledgment does not prove the preview is serving.</p>
      {page.entries.length === 0 && <p className="text-sm">No recorded CI runs on this page.</p>}
      {page.entries.map(entry => <article key={entry.run_id} className="space-y-2 border-t border-[var(--color-line)] pt-3" aria-label={'CI run ' + entry.run_id}>
        <div className="flex flex-wrap items-center gap-2 text-xs"><strong>{labels[entry.state] || 'Unknown'}</strong><code>{entry.run_id}</code><CopyButton value={entry.run_id} label="Copy activity run ID" /></div>
        <p className="break-all text-xs">Release <code>{entry.release_id}</code> · Preview <code>{entry.preview_id}</code></p>
        <p className="text-xs">Created {new Date(entry.created_at).toLocaleString()} · Original preview expiry {new Date(entry.preview_expires_at).toLocaleString()}</p>
        {showSource && page.source_labels_included && (entry.provenance ? <HostingProvenance value={entry.provenance} /> : <p className="text-xs">Source details are unavailable for this retained intent.</p>)}
        <ul className="list-disc space-y-1 pl-4 text-xs">{entry.checks.map(check => <li key={check.step}><strong>{check.state}</strong>: {check.summary}</li>)}</ul>
        <div className="flex flex-wrap gap-2">
          {onInspect && <button className="btn btn-secondary btn-sm" onClick={() => onInspect(entry.run_id)}>Inspect run</button>}
          {reviewableReleaseIDs.includes(entry.release_id) && <button className="btn btn-secondary btn-sm" onClick={() => onReview(entry.release_id)}>Review release</button>}
        </div>
      </article>)}
      {page.next_cursor && <button className="btn btn-secondary btn-sm" onClick={() => onPage(page.next_cursor!)}>Older runs</button>}
    </>}
  </div>;
}
