'use client';

import React, { Suspense, use, useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api';
import {
  credentialBlocker,
  getHostingSite,
  hostingFeatureOff,
  listAutomationCredentials,
  listOIDCTrusts,
  oidcAudience,
  refreshOnConflict,
  setHostingSiteSuspended,
  siteStatus,
  type HostingSite,
} from '@/lib/ops/hosting';
import { HOSTING_SITE_TABS, hostingSiteHref, opsHref, type HostingSiteTab } from '@/lib/routes';
import { relativeTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useUrlParams } from '@/lib/useUrlState';
import { Mono, PageHeader } from '@/components/ui/bits';
import { RowMenu } from '@/components/ui/RowMenu';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { Icon, type IconName } from '@/components/ui/Icons';
import { PageTabs } from '@/components/ui/PageTabs';
import { CopyLinkButton, EntityId } from '@/components/operator/EntityId';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { CredentialsSection } from './CredentialsSection';
import { TrustsSection } from './TrustsSection';
import { ReleasesTab } from './ReleasesTab';
import { ActivityTab } from './ActivityTab';
import { DomainsTab } from './DomainsTab';

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const TABS: readonly { key: HostingSiteTab; label: string; icon: IconName }[] = [
  { key: 'access', label: 'Access', icon: 'keys' },
  { key: 'releases', label: 'Releases', icon: 'deployments' },
  { key: 'activity', label: 'CI activity', icon: 'queues' },
  { key: 'domains', label: 'Domains & previews', icon: 'domains' },
];

const isTab = (value: string | null): value is HostingSiteTab => !!value && (HOSTING_SITE_TABS as readonly string[]).includes(value);

/**
 * One hosting site: who can deploy to it, what is live, its CI runs, and its
 * domains and previews. Each view has its own URL (?tab=…). Issuing or
 * revoking a credential or trust asks for a fresh authenticator code (the
 * transport prompts on step_up_required); API keys cannot do either.
 */
export default function HostingSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <HostingSiteView id={id} />
    </Suspense>
  );
}

function HostingSiteView({ id }: { id: string }) {
  const siteId = decode(id).trim();
  const [params, setParams] = useUrlParams();
  const requested = params.get('tab');
  const tab: HostingSiteTab = isTab(requested) ? requested : 'access';
  // Bumped by Refresh so the open view reloads its own sections too.
  const [nonce, setNonce] = useState(0);
  const [suspending, setSuspending] = useState(false);
  const site = useAsync(() => getHostingSite(siteId), [siteId], 60_000);
  const reloadAll = () => {
    site.reload();
    setNonce((n) => n + 1);
  };
  /** A write changed the site: show what apid returned at once, then reload everything. */
  const siteChanged = (updated?: HostingSite) => {
    if (updated) site.setData(updated);
    reloadAll();
  };

  const off = hostingFeatureOff(site.error);
  const missing = site.error instanceof ApiError && site.error.status === 404;

  return (
    <div>
      <Link
        href={opsHref('hosting')}
        className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      >
        <Icon name="chevronLeft" size={12} />
        Hosting sites
      </Link>
      <PageHeader
        title={site.data?.name ?? 'Hosting site'}
        subtitle={site.data ? site.data.hostname : 'Who can deploy to this site, what is live, and its CI runs and domains.'}
        actions={
          <>
            <CopyLinkButton href={hostingSiteHref(siteId, tab)} />
            <button onClick={reloadAll} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
            {site.data && site.data.status === 'active' && (
              <RowMenu
                label="More site actions"
                trigger={
                  <>
                    More
                    <Icon name="chevronDown" size={12} />
                  </>
                }
                items={[
                  site.data.suspended
                    ? { label: 'Resume site…', onSelect: () => setSuspending(true) }
                    : { label: 'Suspend site…', tone: 'danger', onSelect: () => setSuspending(true), title: 'Stops serving the site and its previews' },
                ]}
              />
            )}
          </>
        }
      />

      {off ? (
        <div className="card">
          <EmptyState icon="domains" title="Hosting is not available" hint={off} />
        </div>
      ) : missing ? (
        <div className="card">
          <EmptyState
            icon="domains"
            title="No such site"
            hint={`Your operator account owns no hosting site ${siteId}. Sites belong to the account that created them.`}
            action={
              <Link href={opsHref('hosting')} className="btn btn-secondary btn-sm">
                All hosting sites
              </Link>
            }
          />
        </div>
      ) : site.error && !site.data ? (
        <div className="card">
          <ErrorState error={site.error} onRetry={site.reload} />
        </div>
      ) : !site.data ? (
        <div className="card p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading hosting site…</div>
      ) : (
        <>
          <SnapshotFreshness snapshots={[site]} />
          <SiteFacts site={site.data} />
          <div className="mt-6">
            <PageTabs
              tabs={TABS}
              value={tab}
              label="Hosting site views"
              onChange={(next) => setParams({ tab: next === 'access' ? null : next, run: null })}
            />
          </div>
          {tab === 'access' && <AccessTab site={site.data} nonce={nonce} />}
          {tab === 'releases' && <ReleasesTab site={site.data} nonce={nonce} onSiteChanged={siteChanged} />}
          {tab === 'activity' && <ActivityTab site={site.data} nonce={nonce} />}
          {tab === 'domains' && <DomainsTab site={site.data} nonce={nonce} />}
        </>
      )}

      {suspending && site.data && <SuspensionDialog site={site.data} onClose={() => setSuspending(false)} onChanged={siteChanged} />}
    </div>
  );
}

/** Suspend stops serving the site (and its previews); resume serves the live release again. */
function SuspensionDialog({
  site,
  onClose,
  onChanged,
}: {
  site: HostingSite;
  onClose: () => void;
  onChanged: (updated?: HostingSite) => void;
}) {
  const suspend = !site.suspended;
  return (
    <OperatorActionDialog
      open
      title={suspend ? 'Suspend site' : 'Resume site'}
      tone={suspend ? 'danger' : 'warning'}
      reason="none"
      confirmText={suspend ? site.name : undefined}
      submitLabel={suspend ? 'Suspend site' : 'Resume site'}
      fingerprint={`${suspend}|${site.revision}`}
      impact={
        suspend ? (
          <p>
            Stops serving <Mono>{site.hostname}</Mono>, its custom domains and its previews. CI runs cannot deploy to it while it is
            suspended. Releases are kept; resuming serves the live release again.
          </p>
        ) : (
          <p>
            Serves <Mono>{site.hostname}</Mono> again with the live release
            {site.active_release_id ? (
              <>
                {' '}
                <Mono>{site.active_release_id.slice(0, 8)}…</Mono>
              </>
            ) : null}
            , and lets CI runs deploy to it.
          </p>
        )
      }
      onClose={onClose}
      onSubmit={async ({ idempotencyKey }) => {
        const updated = await refreshOnConflict(
          () => setHostingSiteSuspended(site.id, suspend, site.revision, { idempotencyKey }),
          () => onChanged(),
        );
        onChanged(updated);
        return suspend ? `Suspended ${site.name}` : `Resumed ${site.name}`;
      }}
    />
  );
}

/** Who can deploy: automation credentials and GitHub OIDC trusts. */
function AccessTab({ site, nonce }: { site: HostingSite; nonce: number }) {
  const credentials = useAsync(() => listAutomationCredentials(site.id), [site.id, nonce]);
  const trusts = useAsync(() => listOIDCTrusts(site.id), [site.id, nonce]);
  return (
    <div className="space-y-6">
      <CredentialsSection site={site} query={credentials} />
      <TrustsSection site={site} query={trusts} />
    </div>
  );
}

function SiteFacts({ site }: { site: HostingSite }) {
  const status = siteStatus(site);
  const blocker = credentialBlocker(site);
  return (
    <div className="card p-5">
      {blocker && (
        <div role="status" className="mb-4 rounded-lg bg-[var(--color-warning-subtle)] p-3 text-xs text-[var(--color-warning-bold)]">
          {blocker}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-4 text-xs lg:grid-cols-4">
        <Fact label="Status">
          <span className={`badge ${status.tone}`}>{status.label}</span>
        </Fact>
        <Fact label="Durable routing">{site.durable_routing ? 'On' : 'Off'}</Fact>
        <Fact label="Hostname" wide>
          <a href={`https://${site.hostname}`} target="_blank" rel="noreferrer" className="break-all font-mono hover:underline">
            {site.hostname}
          </a>
        </Fact>
        <Fact label="Project · environment" wide>
          <span className="break-all font-mono">
            {site.project_id} · {site.environment}
          </span>
        </Fact>
        <Fact label="Live release">
          {site.active_release_id ? <EntityId id={site.active_release_id} href={null} /> : <span className="text-[var(--color-ink-muted)]">None</span>}
        </Fact>
        <Fact label="Site ID">
          <EntityId id={site.id} href={null} />
        </Fact>
        <Fact label="OIDC audience" wide>
          <span className="break-all font-mono">{oidcAudience(site.id)}</span>
        </Fact>
        <Fact label="Created">{relativeTime(site.created_at)}</Fact>
      </dl>
    </div>
  );
}

/** `wide` facts take the full row on narrow screens, where their values are long. */
function Fact({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2 lg:col-span-1' : ''}`}>
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="mt-1 font-semibold">{children}</dd>
    </div>
  );
}
