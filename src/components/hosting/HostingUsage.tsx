'use client';

import { useState } from 'react';
import { getHostingUsage } from '@/lib/hosting';
import { useHostingQuery } from '@/lib/useHostingQuery';
import { estimateHostingCosts, formatHostingUSD, hostingPricing, type HostingWorkload } from '@/lib/hosting-cost';

const bytes = (value: number) => `${(value / 1048576).toLocaleString(undefined, { maximumFractionDigits: 2 })} MiB`;
const workloadLabels: Record<keyof HostingWorkload, string> = { classA: 'Monthly R2 Class A operations', classB: 'Monthly R2 Class B operations', workerRequests: 'Monthly Worker requests', cpuMilliseconds: 'Monthly Worker CPU milliseconds' };

export function HostingUsage() {
  const query = useHostingQuery(getHostingUsage, 10000);
  const [workload, setWorkload] = useState<HostingWorkload>({ classA: '0', classB: '0', workerRequests: '0', cpuMilliseconds: '0' });
  const usage = query.data;
  let cost: ReturnType<typeof estimateHostingCosts> | null = null;
  let error = '';
  if (usage && !query.error) {
    try { cost = estimateHostingCosts(usage.reserved_bytes, workload); }
    catch (problem) { error = problem instanceof Error ? problem.message : 'Check the workload inputs.'; }
  }
  return <section className="card space-y-4 p-4" aria-label="Hosting usage">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Account storage and uploads</h2><button className="btn btn-secondary btn-sm" onClick={query.refresh}>Refresh usage</button></div>
    {query.error && <p role="alert" className="text-sm text-[var(--color-danger)]">{query.error.message} Usage is unavailable; refresh before relying on these figures.</p>}
    {!usage && !query.error && <p className="text-sm">Loading account storage…</p>}
    {usage && <>
      <dl className={`grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4 ${query.error ? 'opacity-50' : ''}`}>
        <div><dt>Reserved storage</dt><dd>{bytes(usage.reserved_bytes)} / {bytes(usage.storage_limit_bytes)}</dd></div>
        <div><dt>Ready release payload</dt><dd>{bytes(usage.ready_payload_bytes)}</dd></div>
        <div><dt>Awaiting cleanup</dt><dd>{bytes(usage.retiring_reserved_bytes)}</dd></div>
        <div><dt>Pending upload reservations</dt><dd>{usage.pending_uploads} / {usage.pending_uploads_limit}</dd></div>
      </dl>
      {usage.reserved_bytes >= usage.storage_limit_bytes && <p role="status" className="text-sm">Storage capacity is full. Retire unused releases and wait for cleanup before deploying again.</p>}
      {usage.pending_uploads >= usage.pending_uploads_limit && <p role="status" className="text-sm">Pending upload capacity is full. Finalize or retire a pending release before starting another.</p>}
      <p className="text-xs text-[var(--color-ink-muted)]">Catalog accounting across all projects and environments: {usage.releases} retained releases. Reservations cover staging and published files plus a maximum-size manifest. Promotion and rollback reuse those bytes. Retiring releases keep their reservation until cleanup succeeds. These figures are not a provider bucket inventory. Observed {new Date(usage.observed_at).toLocaleString()}.</p>
      <details className="border-t border-[var(--color-line)] pt-3"><summary className="cursor-pointer text-sm font-medium">Estimate monthly provider usage cost</summary>
        <p className="mt-3 text-xs">Enter an assumed monthly workload. Storage assumes the current reservation is held for a full month. Request and CPU inputs are estimates, not measured traffic.</p>
        <div className="my-3 grid gap-3 sm:grid-cols-2">{(Object.keys(workloadLabels) as (keyof HostingWorkload)[]).map((key) => <label key={key} className="text-xs">{workloadLabels[key]}<input className="field mt-1" inputMode="numeric" pattern="[0-9]+" maxLength={16} value={workload[key]} onChange={(event) => setWorkload({ ...workload, [key]: event.target.value })} /></label>)}</div>
        {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
        {cost && <div className="space-y-1 text-sm"><div>R2 storage: {formatHostingUSD(cost.storage)}</div><div>R2 Class A: {formatHostingUSD(cost.classA)} · Class B: {formatHostingUSD(cost.classB)}</div><div>Worker requests: {formatHostingUSD(cost.workerRequests)} · CPU: {formatHostingUSD(cost.cpu)}</div><div className="font-semibold">Gross usage estimate: {formatHostingUSD(cost.total)} / month</div></div>}
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">Uses USD Standard R2 and Workers Paid usage rates checked {hostingPricing.checkedAt}. Includes R2 billing-unit rounding, before included allowances. Excludes the shared $5/month Workers base, SaaS/Access/domain fees, taxes, and Gregale infrastructure. This is not a bill or a customer price. <a className="underline" href={hostingPricing.r2URL} target="_blank" rel="noreferrer">R2 rates</a> · <a className="underline" href={hostingPricing.workersURL} target="_blank" rel="noreferrer">Workers rates</a></p>
      </details>
    </>}
  </section>;
}
