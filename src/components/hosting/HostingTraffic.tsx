'use client';

import { useCallback } from 'react';
import { getHostingTraffic } from '@/lib/hosting';
import { useHostingQuery } from '@/lib/useHostingQuery';

const number = (value: number) => value.toLocaleString();
const errors: Record<string, string> = { hosting_file_not_found: 'File not found', method_not_allowed: 'Unsupported method', hosting_route_unavailable: 'Routing unavailable', hosting_artifact_unavailable: 'Artifact unavailable', hosting_unavailable: 'Serving unavailable' };

export function HostingTraffic({ siteID }: { siteID: string }) {
  const fetcher = useCallback((signal: AbortSignal) => getHostingTraffic(siteID, signal), [siteID]);
  const query = useHostingQuery(fetcher, 60000);
  const data = query.data;
  const lookups = data ? data.cache_hits + data.cache_misses : 0;
  const peak = Math.max(1, ...(data?.buckets.map((bucket) => bucket.requests) ?? []));
  return <section className="space-y-4 rounded-lg border border-[var(--color-line)] p-4" aria-label="Site traffic">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Traffic observations <span className="badge badge-neutral">Approximate</span></h3><button className="btn btn-secondary btn-sm" onClick={query.refresh}>Refresh traffic</button></div>
    <p className="text-xs text-[var(--color-ink-muted)]">Authorized requests that reached this Worker, aggregated over 24 hours. Cloudflare may sample or delay data and collection can drop observations. Access denials, pre-Worker traffic and unresolvable custom domains are excluded. These are not billing or uptime counters.</p>
    {query.error && <p className="text-sm text-[var(--color-danger)]" role="alert">{query.error.message} Traffic observations are unavailable; this does not mean zero requests. Deployment controls remain available.</p>}
    {!data && !query.error && <p className="text-sm">Loading traffic observations…</p>}
    {data && !query.error && <>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt>Recorded requests (estimated)</dt><dd>{number(data.requests)}</dd></div>
        <div><dt>Expected response payload</dt><dd>{(data.payload_bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 2 })} MiB</dd></div>
        <div><dt>File-cache hits / lookups</dt><dd>{number(data.cache_hits)} / {number(lookups)}{lookups ? ` (${Math.round(data.cache_hits / lookups * 100)}%)` : ''}</dd></div>
        <div><dt>4xx / 5xx responses</dt><dd>{number(data.client_errors)} / {number(data.server_errors)}</dd></div>
      </dl>
      {data.requests === 0 && <p className="text-sm">No observations in this window. Verify that Worker collection is enabled and the provider is receiving events before interpreting this as no traffic.</p>}
      <p className="text-xs text-[var(--color-ink-muted)]">Window {new Date(data.period_start).toLocaleString()}–{new Date(data.period_end).toLocaleString()}. Queried {new Date(data.observed_at).toLocaleString()}. Maximum sample weight {data.max_sample_interval || 'unobserved'}. API queries may reuse observations for up to one minute.</p>
      <div className="flex h-24 items-end gap-1" role="img" aria-label="Estimated hourly request trend">{data.buckets.map((bucket) => <div key={bucket.start} className="min-w-0 flex-1 rounded-t bg-[var(--color-brand)]" style={{ height: `${bucket.requests === 0 ? 0 : Math.max(2, bucket.requests / peak * 100)}%` }} title={`${new Date(bucket.start).toLocaleString()}: ${number(bucket.requests)} estimated requests`} />)}</div>
      <details><summary className="cursor-pointer text-sm">Hourly observations</summary><div className="overflow-x-auto"><table className="mt-2 w-full text-left text-xs"><thead><tr>{['Hour', 'Requests', 'Cache hits / misses', '4xx / 5xx'].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.buckets.map((bucket) => <tr key={bucket.start} className="border-t border-[var(--color-line)]"><td className="p-2 whitespace-nowrap">{new Date(bucket.start).toLocaleString()}</td><td className="p-2">{number(bucket.requests)}</td><td className="p-2">{number(bucket.cache_hits)} / {number(bucket.cache_misses)}</td><td className="p-2">{number(bucket.client_errors)} / {number(bucket.server_errors)}</td></tr>)}</tbody></table></div></details>
      <div><h4 className="text-sm font-medium">Recent failure groups</h4>{data.failures.length === 0 ? <p className="mt-2 text-xs">No recorded failure groups in this window. This is not a serving-health guarantee.</p> : <div className="overflow-x-auto"><table className="mt-2 w-full text-left text-xs"><thead><tr>{['Hour', 'Response', 'Estimated requests'].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.failures.map((failure, index) => <tr key={index} className="border-t border-[var(--color-line)]"><td className="p-2 whitespace-nowrap">{new Date(failure.start).toLocaleString()}</td><td className="p-2">{failure.status} · {errors[failure.code] || 'Serving error'}</td><td className="p-2">{number(failure.requests)}</td></tr>)}</tbody></table></div>}</div>
      <p className="text-xs text-[var(--color-ink-muted)]">Payload counts declared file sizes for successful GET responses, not bytes received by visitors. HEAD and 304 have zero payload and no file-cache lookup. Cache figures cover the Worker’s file cache, not browser caches or every metadata lookup. CPU and provider operation charges remain separate estimates.</p>
    </>}
  </section>;
}
