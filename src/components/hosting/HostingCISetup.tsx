'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { listHostingOIDCTrusts, prepareHostingCISetup, type HostingCISetupConfig, type HostingCISetup, type HostingSite } from '@/lib/hosting';
import { useHostingQuery } from '@/lib/useHostingQuery';

const initial: HostingCISetupConfig = {api_base: 'https://api.gregale.dev', action_commit: '', checkout_commit: '', prepare_action: './.github/actions/prepare-frontend', cli_path: './.gregale/bin/gregale', cli_sha256: '', output_path: 'dist', spa_fallback: false, preview_ttl_seconds: 86400, wait_timeout_seconds: 120};
export function HostingCISetup({site, disabled, reservationsEnabled = false}: {site: HostingSite; disabled: boolean; reservationsEnabled?: boolean}) {
  const [config, setConfig] = useState(initial);
  const [trustID, setTrustID] = useState('');
  const [result, setResult] = useState<{key: string; report: HostingCISetup} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const fetcher = useCallback(async (signal: AbortSignal) => {
    try { return await listHostingOIDCTrusts(site.id, signal); }
    catch (error) { if (!signal.aborted) { controller.current?.abort(); setBusy(false); setResult(null); } throw error; }
  }, [site.id]);
  const trusts = useHostingQuery(fetcher);
  const trust = trusts.data?.find(value => value.id === trustID);
  const key = JSON.stringify({site: [site.id, site.revision, site.status, site.suspended], trust, config, reservationsEnabled});
  const blocked = disabled || busy || !!trusts.error || !trust || site.status !== 'active' || site.suspended;
  const report = !disabled && !trusts.error && trust && result?.key === key ? result.report : null;
  function reset() { controller.current?.abort(); setBusy(false); setResult(null); setError(''); }
  function edit(change: Partial<HostingCISetupConfig>) { reset(); setConfig({...config, ...change}); }
  async function generate() {
    if (blocked || !trust || config.reserve_preview && !reservationsEnabled) return;
    const work = new AbortController(); controller.current = work; setBusy(true); setError(''); setResult(null);
    try {
      const report = await prepareHostingCISetup(site.id, trust.id, config, work.signal);
      if (report.site_id !== site.id || report.trust_id !== trust.id) throw new Error('Setup response does not match the selected site and trust.');
      if (!work.signal.aborted) setResult({key, report});
    } catch (error) { if (!work.signal.aborted) setError(error instanceof Error ? error.message : 'Setup unavailable. Refresh trusts and try again.'); }
    finally { if (!work.signal.aborted) setBusy(false); if (controller.current === work) controller.current = null; }
  }
  function download(body: string, filename: string, type: string) {
    if (blocked || !report?.configuration_valid) return;
    const url = URL.createObjectURL(new Blob([body], {type}));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="space-y-3 rounded-lg border border-[var(--color-line)] p-4" aria-label="GitHub deployment setup">
    <div className="flex justify-between gap-3"><h3 className="font-semibold">GitHub deployment setup</h3><button className="btn btn-ghost btn-sm" onClick={() => { reset(); trusts.refresh(); }}>Refresh setup trusts</button></div>
    <p className="text-xs">Generate a workflow for an existing reviewed trust. Your local preparation Action supplies a pinned CLI and prebuilt files. Review the downloads before committing them to GitHub.</p>
    {trusts.error && <p role="alert" className="text-sm">{trusts.error.message} Setup downloads are paused.</p>}
    {trusts.data?.length === 0 && <p className="text-sm">Create a GitHub deployment identity binding first, then refresh setup trusts.</p>}
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); void generate(); }}>
      <label className="block text-xs">Existing trust binding<select className="field mt-1" aria-label="Existing trust binding" disabled={disabled || !!trusts.error || busy} value={trustID} onChange={event => { reset(); setTrustID(event.target.value); setConfig({...config, cron: '', default_branch: ''}); }}><option value="">Select a reviewed trust</option>{trusts.data?.map(value => <option key={value.id} value={value.id}>{value.repository} · {value.ref} · {value.event_name} · {value.id}</option>)}</select></label>
      {trust && <div className="space-y-1 text-xs break-all"><p>{trust.workflow_ref}</p><p>Owner ID: {trust.repository_owner_id} · Repository ID: {trust.repository_id} · Environment: {trust.environment || 'none'}</p></div>}
      <fieldset disabled={blocked} className="grid gap-3 sm:grid-cols-2">
        {([
          ['api_base', 'Gregale API origin'], ['action_commit', 'Reviewed hosting Action commit SHA'], ['checkout_commit', 'Reviewed checkout commit SHA'], ['prepare_action', 'Local preparation Action'], ['cli_path', 'Prepared CLI path'], ['cli_sha256', 'Reviewed CLI SHA-256'], ['output_path', 'Prebuilt output directory'],
        ] as const).map(([field, label]) => <label className="text-xs" key={field}>{label}<input className="field mt-1" aria-label={label} required value={config[field]} maxLength={field.endsWith('commit') ? 40 : field === 'cli_sha256' ? 64 : 256} pattern={field.endsWith('commit') ? '[0-9a-f]{40}' : field === 'cli_sha256' ? '[0-9a-f]{64}' : undefined} onChange={event => edit({[field]: event.target.value})} /></label>)}
        <label className="text-xs">Preview lifetime in seconds<input className="field mt-1" aria-label="Preview lifetime in seconds" type="number" required min={1} value={config.preview_ttl_seconds} onChange={event => edit({preview_ttl_seconds: Number(event.target.value)})} /></label>
        <label className="text-xs">Publication wait in seconds<input className="field mt-1" aria-label="Publication wait in seconds" type="number" required min={1} value={config.wait_timeout_seconds} onChange={event => edit({wait_timeout_seconds: Number(event.target.value)})} /></label>
        {reservationsEnabled && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!config.reserve_preview} onChange={event => edit({reserve_preview: event.target.checked})} />Reserve preview capacity before uploads</label>}
        {trust?.event_name === 'schedule' && <><label className="text-xs">UTC cron schedule<input className="field mt-1" aria-label="UTC cron schedule" required value={config.cron || ''} onChange={event => edit({cron: event.target.value})} /></label><label className="text-xs">Declared GitHub default branch<input className="field mt-1" aria-label="Declared GitHub default branch" required value={config.default_branch || ''} onChange={event => edit({default_branch: event.target.value})} /></label></>}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={config.spa_fallback} onChange={event => edit({spa_fallback: event.target.checked})} />Use SPA fallback for CI output</label>
      </fieldset>
      <button className="btn btn-secondary btn-sm" disabled={blocked}>Check and generate workflow</button>
    </form>
    {busy && <p role="status" className="text-sm">Checking current site, flags and trust…</p>}
    {error && <p role="alert" className="text-sm">{error}</p>}
    {report && <div className="space-y-3 text-xs" aria-label="Generated deployment configuration">
      <p className="font-medium">{report.configuration_valid ? 'Configuration checks passed. Manual review and live qualification remain.' : 'Configuration has blockers. Resolve them before exporting.'}</p>
      <ul className="list-disc space-y-1 pl-4">{report.checks.map(check => <li key={check.code}><strong>{check.state}</strong>: {check.message}</li>)}</ul>
      {report.configuration_valid && report.workflow_yaml && <>
        <p>Save the workflow at <code>{report.workflow_path}</code> in <code>{report.repository}</code>. Preflight reads your local files without uploading them.</p>
        <div className="flex flex-wrap gap-2"><button className="btn btn-secondary btn-sm" disabled={blocked} onClick={() => download(report.workflow_yaml!, report.workflow_path.split('/').pop()!, 'application/yaml')}>Download workflow YAML</button><button className="btn btn-secondary btn-sm" disabled={blocked} onClick={() => download(JSON.stringify({site_id: site.id, trust_id: trustID, config}, null, 2) + '\n', 'gregale-ci-setup.json', 'application/json')}>Download setup JSON</button></div>
        <p>With the CLI setup opt-in enabled, run <code>gregale sites ci-preflight --config gregale-ci-setup.json --repo-root .</code> before committing.</p>
        <details><summary>Review generated workflow</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre text-xs">{report.workflow_yaml}</pre></details>
      </>}
      <ul className="list-disc space-y-1 pl-4">{report.recovery.map(message => <li key={message}>{message}</li>)}</ul>
    </div>}
  </section>;
}
