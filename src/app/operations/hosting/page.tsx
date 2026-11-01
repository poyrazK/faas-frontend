'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { hostingFeatureOff, listHostingSites, siteStatus, type HostingSite } from '@/lib/ops/hosting';
import { hostingSiteHref } from '@/lib/routes';
import { relativeTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { PageHeader } from '@/components/ui/bits';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { SectionCard } from '@/components/ui/Panels';
import { EmptyState } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { RowMenu, copyText, rowOpener } from '@/components/ui/RowMenu';
import { shortId } from '@/components/operator/EntityId';

/**
 * Static sites on Gregale hosting. apid scopes the list to the signed-in
 * operator account; each row opens the site's credentials and GitHub trusts.
 */
export default function HostingSitesPage() {
  const router = useRouter();
  const query = useAsync(listHostingSites, [], 60_000);
  const { data, error, loading, reload } = query;
  const off = hostingFeatureOff(error);

  return (
    <div>
      <PageHeader
        title="Hosting sites"
        subtitle="Static sites owned by your operator account, and the credentials and GitHub trusts that deploy them."
        actions={
          <button onClick={reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />

      <SnapshotFreshness snapshots={[query]} />

      <SectionCard title="Sites">
        {off ? (
          <EmptyState icon="domains" title="Hosting is not available" hint={off} />
        ) : error && !data ? (
          <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
            Could not load hosting sites: {error.message}
          </div>
        ) : loading && !data ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading hosting sites…</div>
        ) : !data?.length ? (
          <EmptyState icon="domains" title="No hosting sites" hint="Your operator account does not own any hosting sites yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Project · environment</th>
                  <th>Status</th>
                  <th>Live release</th>
                  <th>Created</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((site: HostingSite) => {
                  const status = siteStatus(site);
                  const open = () => router.push(hostingSiteHref(site.id));
                  return (
                    <tr key={site.id} {...rowOpener(open, `Open site ${site.name}`)}>
                      <td className="nowrap">
                        <span className="cell-primary">{site.name}</span>
                        <div className="font-mono text-[11px] text-[var(--color-ink-muted)]">{site.hostname}</div>
                      </td>
                      <td className="nowrap font-mono">
                        {site.project_id} · {site.environment}
                      </td>
                      <td className="nowrap">
                        <span className={`badge ${status.tone}`}>{status.label}</span>
                      </td>
                      <td className="nowrap font-mono">
                        {site.active_release_id ? shortId(site.active_release_id) : <span className="text-[var(--color-ink-muted)]">None</span>}
                      </td>
                      <td className="nowrap">{relativeTime(site.created_at)}</td>
                      <td className="cell-menu">
                        <RowMenu
                          label={`Actions for ${site.name}`}
                          items={[
                            { label: 'Credentials and trusts', onSelect: open },
                            { label: `Visit ${site.hostname}`, href: `https://${site.hostname}`, external: true },
                            { label: 'Copy site ID', onSelect: () => copyText(site.id) },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {error && data && !off && (
          <div role="alert" className="table-foot text-[var(--color-danger)]">
            Refresh failed: {error.message}. Showing the last successful snapshot.
          </div>
        )}
      </SectionCard>
    </div>
  );
}
