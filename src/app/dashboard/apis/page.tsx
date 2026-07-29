'use client';

/* ==========================================================================
   APIs — every HTTPS endpoint the account serves.

   Gregale gives each workflow a platform hostname (App.url) and lets you bind
   custom domains on top, so this page is the join of those two: one row per
   reachable endpoint, platform-issued or custom.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { listApps, listDomains, getAppsMetrics } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, SearchInput, FilterSelect, CopyButton } from '@/components/ui/bits';
import { TableFooter } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { compact, ms } from '@/lib/series';

interface Endpoint {
  key: string;
  host: string;
  url: string;
  slug: string;
  kind: 'Platform' | 'Custom domain';
  verified: boolean;
  status: string;
  requests: number | null;
  p95: number | null;
  errorRate: number | null;
}

export default function ApisPage() {
  const apps = useAsync(listApps, []);
  const domains = useAsync(listDomains, []);
  const metrics = useAsync(() => getAppsMetrics('24h'), []);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');

  const endpoints = useMemo<Endpoint[]>(() => {
    const list: Endpoint[] = [];
    for (const app of apps.data ?? []) {
      const m = metrics.data?.apps?.[app.slug] ?? null;
      let host = app.url;
      try {
        host = new URL(app.url).host;
      } catch {
        /* url already bare */
      }
      list.push({
        key: `platform:${app.id}`,
        host,
        url: app.url,
        slug: app.slug,
        kind: 'Platform',
        verified: true,
        status: app.status,
        requests: m ? m.request_count : null,
        p95: m ? m.latency_p95_ms : null,
        errorRate: m ? m.error_rate_pct : null,
      });

      for (const d of (domains.data ?? []).filter((x) => x.app_id === app.id)) {
        list.push({
          key: `custom:${d.domain}`,
          host: d.domain,
          url: `https://${d.domain}`,
          slug: app.slug,
          kind: 'Custom domain',
          verified: d.verified,
          status: d.verified ? app.status : 'pending verification',
          // Metrics are labelled by app, not by hostname, so a custom domain
          // shows its workflow's totals rather than traffic for that host.
          requests: m ? m.request_count : null,
          p95: m ? m.latency_p95_ms : null,
          errorRate: m ? m.error_rate_pct : null,
        });
      }
    }
    return list;
  }, [apps.data, domains.data, metrics.data]);

  const filtered = endpoints.filter((e) => {
    if (query && !(`${e.host} ${e.slug}`.toLowerCase().includes(query.toLowerCase()))) return false;
    if (kind !== 'all' && e.kind !== kind) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        title="APIs"
        subtitle="Manage your HTTP endpoints and the hostnames that reach them."
        actions={
          <Link href="/dashboard/domains" className="btn btn-primary">
            <Icon name="plus" size={14} /> New domain
          </Link>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search APIs…" className="w-full max-w-xs" />
          <div className="ml-auto">
            <FilterSelect
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All Types' },
                { value: 'Platform', label: 'Platform' },
                { value: 'Custom domain', label: 'Custom domain' },
              ]}
            />
          </div>
        </div>

        <AsyncBoundary
          state={apps}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={5} rows={4} />}
          empty={
            query || kind !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No endpoint matches these filters." />
            ) : (
              <EmptyState
                icon="apis"
                title="No endpoints yet"
                hint="Every workflow gets an HTTPS hostname the moment it's created."
                action={<Link href="/dashboard/workflows" className="btn btn-primary">Create a workflow</Link>}
              />
            )
          }
        >
          {() => (
            <>
              <div className="overflow-x-auto">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>Endpoint</th>
                      <th>Workflow</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Requests (24h)</th>
                      <th>p95</th>
                      <th>Error rate</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e) => (
                      <tr key={e.key}>
                        <td>
                          <a
                            href={e.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mono flex items-center gap-2 text-xs font-medium"
                            style={{ color: 'var(--color-brand)' }}
                          >
                            <Icon name="globe" size={14} />
                            {e.host}
                          </a>
                        </td>
                        <td>
                          <Link href={`/dashboard/workflows/${e.slug}`} className="cell-primary">
                            {e.slug}
                          </Link>
                        </td>
                        <td>{e.kind}</td>
                        <td>
                          {e.verified ? (
                            <StatusBadge state={e.status} />
                          ) : (
                            <span className="badge badge-warn">Pending DNS</span>
                          )}
                        </td>
                        <td>{e.requests != null ? compact(e.requests) : '—'}</td>
                        <td>{ms(e.p95)}</td>
                        <td style={e.errorRate ? { color: 'var(--color-danger)' } : undefined}>
                          {e.errorRate != null ? `${e.errorRate.toFixed(2)}%` : '—'}
                        </td>
                        <td className="text-right">
                          <CopyButton value={e.url} label="Copy" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TableFooter from={1} to={filtered.length} total={filtered.length} noun="endpoints" />
            </>
          )}
        </AsyncBoundary>
      </div>

      <p className="mt-3 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
        Request figures are measured at the gateway over the last 24 hours and are labelled per workflow, so a custom
        domain reports the totals for the workflow behind it rather than for that hostname alone.
      </p>
    </div>
  );
}
