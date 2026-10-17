'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getHostingDiagnostics } from '@/lib/hosting';
import { useHostingQuery } from '@/lib/useHostingQuery';
import { CopyButton } from '@/components/ui/bits';

const canonicalUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const steps: Record<string, string> = {site: 'Site intent', run: 'CI intent', release: 'Artifact verification', preview: 'Private preview', publication: 'Site publication', observation: 'Observation consistency', serving: 'Serving health'};
export function HostingDiagnostics({siteID, disabled, initialRunID = ''}: {siteID: string; disabled: boolean; initialRunID?: string}) {
  const target = useRef<HTMLElement | null>(null);
  useEffect(() => { if (initialRunID) { target.current?.scrollIntoView({block: 'start'}); target.current?.focus({preventScroll: true}); } }, [initialRunID]);
  const [draft, setDraft] = useState(initialRunID);
  const [run, setRun] = useState(initialRunID);
  const valid = draft === '' || canonicalUUID.test(draft);
  return <section ref={target} tabIndex={-1} className="space-y-3 rounded-lg border border-[var(--color-line)] p-4" aria-label="Deployment diagnostics">
    <h3 className="font-semibold">Deployment diagnostics</h3>
    <p className="text-xs">Explain stored deployment progress. This view reads records without changing resources or probing DNS, TLS, Access or serving health.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {event.preventDefault(); if (!disabled && valid) setRun(draft);}}>
      <label className="flex-1 text-xs">Original CI run ID (optional)<input className="field mt-1" aria-label="Original CI run ID (optional)" value={draft} maxLength={36} placeholder="Leave empty for the production site" disabled={disabled} onChange={event => setDraft(event.target.value)} /></label>
      <button className="btn btn-secondary btn-sm" disabled={disabled || !valid}>Inspect deployment</button>
    </form>
    {!valid && <p role="alert" className="text-xs">Use the exact lowercase run UUID from CI output.</p>}
    <DiagnosticReport key={siteID + ':' + run} siteID={siteID} run={run} />
  </section>;
}

function DiagnosticReport({siteID, run}: {siteID: string; run: string}) {
  const fetcher = useCallback((signal: AbortSignal) => getHostingDiagnostics(siteID, run, signal), [siteID, run]);
  const query = useHostingQuery(fetcher);
  const report = !query.error && query.data?.site_id === siteID && (query.data.run_id || '') === run && query.data.serving_health === 'not_checked' ? query.data : null;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{run ? <>Inspecting CI run <code>{run}</code></> : 'Inspecting the production site'}</span><button className="btn btn-ghost btn-sm" onClick={query.refresh}>Refresh diagnostics</button></div>
    {query.error && <p role="alert" className="text-sm">{query.error.message} Diagnostic evidence is unavailable. Refresh before deciding how to recover.</p>}
    {!query.data && !query.error && <p className="text-xs">Reading deployment evidence…</p>}
    {query.data && !query.error && !report && <p role="alert" className="text-sm">The diagnostic response does not match this site and run. Refresh before deciding how to recover.</p>}
    {report && <>
      <p className="text-xs">Observed {new Date(report.observed_at).toLocaleString()}. Records are read separately and can change. Refresh before taking an action.</p>
      <p className="text-sm" role="status">{report.retry_advice === 'retry_same_run' ? 'If retrying CI, keep the original run ID, unchanged files, source labels and original preview TTL. The server will revalidate the retry.' : report.retry_advice === 'inspect_before_retry' ? 'Review the blocking or unknown evidence before retrying. Do not change the run ID to hide an uncertain failure.' : 'No CI retry is suggested by this report.'}</p>
      <div className="flex flex-wrap gap-3 text-xs">{([['Release', report.release_id], ['Preview', report.preview_id]] as const).map(([label, id]) => id && <div key={label}><span>{label}: <code>{id}</code></span><CopyButton value={id} label={'Copy diagnostic ' + label.toLowerCase() + ' ID'} /></div>)}</div>
      <ol className="space-y-2">{report.checks.map(check => <li className="space-y-1 border-t border-[var(--color-line)] pt-2 text-xs" key={check.step}>
        <p className="font-medium">{steps[check.step] || 'Additional evidence'} · {check.state.replaceAll('_', ' ')}</p>
        <p>{check.summary}</p><p>{check.action}</p>
        {check.generation !== undefined && <p>Generation {check.published_generation ?? 0} / {check.generation}</p>}
        {check.next_attempt_at && <p>Next recorded attempt: {new Date(check.next_attempt_at).toLocaleString()}</p>}
      </li>)}</ol>
    </>}
  </div>;
}
