'use client';

import React, { use } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api';
import {
  credentialBlocker,
  getHostingSite,
  hostingFeatureOff,
  listAutomationCredentials,
  listOIDCTrusts,
  oidcAudience,
  siteStatus,
  type HostingSite,
} from '@/lib/ops/hosting';
import { hostingSiteHref, opsHref } from '@/lib/routes';
import { relativeTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { PageHeader } from '@/components/ui/bits';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';
import { CopyLinkButton, EntityId } from '@/components/operator/EntityId';
import { CredentialsSection } from './CredentialsSection';
import { TrustsSection } from './TrustsSection';

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * One hosting site: who can deploy to it. Issuing or revoking a credential
 * or trust asks for a fresh authenticator code (the transport prompts on
 * step_up_required); API keys cannot do either.
 */
export default function HostingSitePage({ params }: { params: Promise<{ id: string }> }) {
  const siteId = decode(use(params).id).trim();
  const site = useAsync(() => getHostingSite(siteId), [siteId], 60_000);
  const credentials = useAsync(() => listAutomationCredentials(siteId), [siteId]);
  const trusts = useAsync(() => listOIDCTrusts(siteId), [siteId]);
  const reloadAll = () => {
    site.reload();
    credentials.reload();
    trusts.reload();
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
        subtitle={site.data ? site.data.hostname : 'Who can deploy to this site: automation credentials and GitHub OIDC trusts.'}
        actions={
          <>
            <CopyLinkButton href={hostingSiteHref(siteId)} />
            <button onClick={reloadAll} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
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
          <SnapshotFreshness snapshots={[site, credentials, trusts]} />
          <SiteFacts site={site.data} />
          <CredentialsSection site={site.data} query={credentials} />
          <TrustsSection site={site.data} query={trusts} />
        </>
      )}
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
