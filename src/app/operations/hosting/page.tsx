'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  formatBytes,
  getHostingCapabilities,
  getHostingUsage,
  hostingFeatureOff,
  hostingFeatures,
  isHiddenRoute,
  listHostingSites,
  percentText,
  shareOf,
  siteStatus,
  type HostingSite,
  type HostingUsage,
} from '@/lib/ops/hosting';
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
import { ConfigurationLink } from './ConfigurationLink';

/**
 * Static sites on Gregale hosting. apid scopes the list (and the storage
 * usage above it) to the signed-in operator account; each row opens the
 * site. Below the list: what this control plane has switched on.
 */
export default function HostingSitesPage() {
  const router = useRouter();
  const query = useAsync(listHostingSites, [], 60_000);
  const usage = useAsync(getHostingUsage, [], 60_000);
  const capabilities = useAsync(getHostingCapabilities, []);
  const { data, error, loading } = query;
  const off = hostingFeatureOff(error);
  const reload = () => {
    query.reload();
    usage.reload();
    capabilities.reload();
  };

  return (
    <div>
      <PageHeader
        title="Hosting sites"
        subtitle="Static sites owned by your operator account: who deploys them, what is live, and what they store and serve."
        actions={
          <button onClick={reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />

      <SnapshotFreshness snapshots={[query]} />

      {!off &&
        (usage.data ? (
          <UsageTiles usage={usage.data} />
        ) : (
          usage.error && (
            <div role="alert" className="card mb-6 p-4 text-xs text-[var(--color-danger)]">
              Could not load storage usage: {usage.error.message}
            </div>
          )
        ))}

      <SectionCard title="Sites">
        {off ? (
          <EmptyState icon="domains" title="Hosting is not available" hint={off} action={isHiddenRoute(error) ? <ConfigurationLink /> : undefined} />
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
                            { label: 'Open site', onSelect: open },
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

      {!off && capabilities.data && (
        <div className="mt-6">
          <SectionCard title="Features on this control plane">
            <ul className="grid gap-x-6 gap-y-2 px-5 py-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {hostingFeatures(capabilities.data).map((feature) => (
                <li key={feature.label} className="flex items-center gap-2">
                  <span className={`badge ${feature.on ? 'badge-success' : 'badge-neutral'} w-9 justify-center`}>{feature.on ? 'On' : 'Off'}</span>
                  <span>{feature.label}</span>
                  {feature.on && feature.detail && <span className="text-[var(--color-ink-muted)]">· {feature.detail}</span>}
                </li>
              ))}
            </ul>
            <div className="table-foot">
              <span>
                Up to {capabilities.data.sites_per_account} sites per account and {capabilities.data.releases_per_site} releases per site.
                {capabilities.data.domains_enabled && capabilities.data.domain_cname_target && (
                  <>
                    {' '}
                    Custom domains point a CNAME at <span className="font-mono">{capabilities.data.domain_cname_target}</span>.
                  </>
                )}
              </span>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}

/** Storage and uploads against the account's limits; catalog accounting, not a provider bill. */
function UsageTiles({ usage }: { usage: HostingUsage }) {
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      <UsageTile
        label="Storage reserved"
        value={formatBytes(usage.reserved_bytes)}
        limit={`of ${formatBytes(usage.storage_limit_bytes)}`}
        share={shareOf(usage.reserved_bytes, usage.storage_limit_bytes)}
        sub={`${formatBytes(usage.payload_bytes)} of files; each release is stored twice plus a manifest.`}
      />
      <UsageTile
        label="Uploads in progress"
        value={usage.pending_uploads.toLocaleString()}
        limit={`of ${usage.pending_uploads_limit.toLocaleString()}`}
        share={shareOf(usage.pending_uploads, usage.pending_uploads_limit)}
        sub="Releases still uploading count against this until finalized or retired."
      />
      <UsageTile
        label="Releases"
        value={usage.releases.toLocaleString()}
        sub={
          usage.retiring_reserved_bytes > 0
            ? `${formatBytes(usage.retiring_reserved_bytes)} is retiring and freed once cleanup runs.`
            : `${formatBytes(usage.ready_payload_bytes)} of files in ready releases.`
        }
      />
    </div>
  );
}

function UsageTile({ label, value, limit, share, sub }: { label: string; value: string; limit?: string; share?: number; sub: string }) {
  const fill = share === undefined ? '' : share >= 0.9 ? 'var(--color-danger)' : share >= 0.75 ? 'var(--color-warning)' : 'var(--color-brand)';
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-[var(--color-ink-muted)]">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-xl font-bold leading-none">{value}</span>
        {limit && <span className="text-xs text-[var(--color-ink-muted)]">{limit}</span>}
        {share !== undefined && <span className="ml-auto text-xs font-medium">{percentText(share)}</span>}
      </div>
      {share !== undefined && (
        <span
          className="meter mt-2 block"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <span style={{ width: `${share * 100}%`, background: fill }} />
        </span>
      )}
      <p className="mt-2 text-[11px] text-[var(--color-ink-muted)]">{sub}</p>
    </div>
  );
}

