'use client';

import React from 'react';
import {
  cacheHitRate,
  formatBytes,
  getHostingTraffic,
  hourLabel,
  percentText,
  TRAFFIC_CODES,
  trafficPoints,
  type HostingSite,
} from '@/lib/ops/hosting';
import { useAsync } from '@/lib/useAsync';
import { SectionCard } from '@/components/ui/Panels';
import { BarChart } from '@/components/ui/Chart';
import { QueryBody } from './shared';

/** apid keeps this many failure groups (api.HostingTrafficFailureGroupsMax). */
const FAILURE_GROUPS_MAX = 20;

/**
 * The site's last 24 hours at the edge, from weighted Analytics Engine
 * samples. apid reports a provider failure as an error, never as zero
 * traffic, and the counts are approximate: not billing or health evidence.
 */
export function TrafficTab({ site, nonce }: { site: HostingSite; nonce: number }) {
  const traffic = useAsync(() => getHostingTraffic(site.id), [site.id, nonce], 300_000);

  return (
    <SectionCard
      title="Traffic, last 24 hours"
      action={traffic.data?.approximate ? <span className="badge badge-neutral">Sampled</span> : undefined}
    >
      <QueryBody
        query={traffic}
        noun="traffic"
        icon="metrics"
        empty={{
          title: 'No requests in the last 24 hours',
          hint: `No sampled request reached ${site.hostname}. A failed provider query is shown as an error, never as zero traffic.`,
        }}
        isEmpty={(report) => report.requests === 0}
      >
        {(report) => {
          const errors = report.client_errors + report.server_errors;
          return (
            <>
              <dl className="grid grid-cols-2 gap-4 px-5 py-4 text-xs sm:grid-cols-3 lg:grid-cols-5">
                <Figure label="Requests" value={report.requests.toLocaleString()} />
                <Figure
                  label="Served from cache"
                  value={percentText(cacheHitRate(report))}
                  sub={`${report.cache_hits.toLocaleString()} of ${(report.cache_hits + report.cache_misses).toLocaleString()} cacheable`}
                />
                <Figure
                  label="Client errors (4xx)"
                  value={report.client_errors.toLocaleString()}
                  sub={percentText(report.client_errors / report.requests)}
                  tone={report.client_errors ? 'warning' : undefined}
                />
                <Figure
                  label="Server errors (5xx)"
                  value={report.server_errors.toLocaleString()}
                  sub={percentText(report.server_errors / report.requests)}
                  tone={report.server_errors ? 'danger' : undefined}
                />
                <Figure label="Data served" value={formatBytes(report.payload_bytes)} />
              </dl>
              <div className="px-5 pb-4">
                <div className="mb-1 text-[11px] text-[var(--color-ink-muted)]">Requests per hour</div>
                <BarChart points={trafficPoints(report.buckets)} height={140} />
              </div>
              <div className="border-t border-[var(--color-line)]">
                <div className="px-5 pt-3 text-xs font-medium">Failed requests</div>
                {errors === 0 ? (
                  <p className="px-5 py-3 text-xs text-[var(--color-ink-muted)]">No failed requests were sampled.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="dtable text-xs">
                      <thead>
                        <tr>
                          <th>Hour</th>
                          <th>Status</th>
                          <th>Edge code</th>
                          <th className="text-right">Requests</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.failures.map((failure) => (
                          <tr key={`${failure.start}-${failure.status}-${failure.code}`}>
                            <td className="nowrap">{hourLabel(failure.start)}</td>
                            <td className="nowrap">
                              <span className={`badge ${failure.status >= 500 ? 'badge-danger' : 'badge-warning'}`}>{failure.status}</span>
                            </td>
                            <td className="nowrap">
                              <span className="font-mono">{failure.code}</span>
                              {TRAFFIC_CODES[failure.code] && (
                                <div className="text-[11px] text-[var(--color-ink-muted)]">{TRAFFIC_CODES[failure.code]}</div>
                              )}
                            </td>
                            <td className="nowrap text-right">{failure.requests.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {report.failures.length >= FAILURE_GROUPS_MAX && (
                      <p className="px-5 py-2 text-[11px] text-[var(--color-ink-muted)]">apid returns the {FAILURE_GROUPS_MAX} most recent groups.</p>
                    )}
                  </div>
                )}
              </div>
              <div className="table-foot">
                <span>
                  Weighted samples from {report.source === 'cloudflare_analytics_engine' ? 'Cloudflare Analytics Engine' : report.source}
                  {report.max_sample_interval > 1 ? ` (up to 1 in ${report.max_sample_interval} requests recorded)` : ''}: approximate,
                  not billing or health evidence. Observed {new Date(report.observed_at).toLocaleTimeString()}.
                </span>
              </div>
            </>
          );
        }}
      </QueryBody>
    </SectionCard>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warning' | 'danger' }) {
  const color = tone === 'danger' ? 'text-[var(--color-danger)]' : tone === 'warning' ? 'text-[var(--color-warning-bold)]' : '';
  return (
    <div className="min-w-0">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold leading-tight ${color}`}>{value}</dd>
      {sub && <dd className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">{sub}</dd>}
    </div>
  );
}
