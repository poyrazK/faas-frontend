'use client';

/* ==========================================================================
   Deployment detail — the drill-in that both deployment lists previously
   lacked, so build logs (#254) had no route into the UI at all.

   Build logs stream over SSE from /v1/deployments/{id}/logs. Provenance and
   SBOM come from the build endpoints; both are optional in practice because
   the Phase-3 populator (cosign + syft) hasn't filled every column yet, and
   an empty string there means "not populated", not "no data".
   ========================================================================== */

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  getDeployment, listApps, getBuildProvenance, getBuildSbom, deploymentLogsUrl, ApiError,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono, CopyButton } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonBlock } from '@/components/ui/States';
import { LogStream } from '@/components/LogStream';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

type Tab = 'Build log' | 'Provenance' | 'SBOM';

/** A build is still moving while its status is neither success nor failure. */
function isTerminal(status: string): boolean {
  return /succe|ready|active|deployed|fail|error|cancel/i.test(status);
}

export default function DeploymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('Build log');

  const deployment = useAsync(() => getDeployment(id), [id]);
  const apps = useAsync(listApps, []);

  const slug = apps.data?.find((a) => a.id === deployment.data?.app_id)?.slug;
  const running = deployment.data ? !isTerminal(deployment.data.status) : false;

  return (
    <div>
      <Link
        href="/dashboard/deployments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: 'var(--color-ink-muted)' }}
      >
        <Icon name="chevronLeft" size={14} /> Deployments
      </Link>

      <AsyncBoundary state={deployment} skeleton={<SkeletonBlock height={140} />}>
        {(d) => (
          <>
            <PageHeader
              title={`Deployment ${d.id.slice(0, 12)}`}
              subtitle={`${d.kind} · created ${relativeTime(d.created_at)}${slug ? ` · ${slug}` : ''}`}
              actions={
                <>
                  {slug && (
                    <Link href={`/dashboard/workflows/${slug}`} className="btn btn-secondary">
                      <Icon name="workflows" size={14} /> Open workflow
                    </Link>
                  )}
                  <button className="btn-icon btn-icon-bordered" onClick={deployment.reload} aria-label="Refresh">
                    <Icon name="refresh" size={16} />
                  </button>
                </>
              }
            />

            <SectionCard title="Summary">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5 text-sm sm:grid-cols-4">
                <Field k="Status" v={<StatusBadge state={d.status} />} />
                <Field k="Kind" v={d.kind} />
                <Field k="Created" v={relativeTime(d.created_at)} />
                <Field
                  k="Workflow"
                  v={
                    slug ? (
                      <Link href={`/dashboard/workflows/${slug}`} style={{ color: 'var(--color-brand)' }}>
                        {slug}
                      </Link>
                    ) : (
                      <Mono>{d.app_id.slice(0, 8)}</Mono>
                    )
                  }
                />
                <div className="col-span-2 sm:col-span-4">
                  <dt className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                    Image digest
                  </dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    {d.image_digest ? (
                      <>
                        <Mono>{d.image_digest}</Mono>
                        <CopyButton value={d.image_digest} label="Copy" />
                      </>
                    ) : (
                      <span style={{ color: 'var(--color-ink-muted)' }}>
                        Not built yet — the digest appears once the build succeeds.
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              {d.error && (
                <div className="px-5 pb-5">
                  <div className="rounded-lg px-3 py-2.5 text-sm" style={{ background: '#fdf1f1', color: '#b91c1c', border: '1px solid #f5d5d5' }}>
                    {d.error}
                  </div>
                </div>
              )}
            </SectionCard>

            {/* Tabs */}
            <div className="mb-5 mt-6 flex gap-1 overflow-x-auto" style={{ borderBottom: '1px solid var(--color-line)' }}>
              {(['Build log', 'Provenance', 'SBOM'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors"
                  style={{
                    color: tab === t ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                    borderBottom: `2px solid ${tab === t ? 'var(--color-brand)' : 'transparent'}`,
                    marginBottom: -1,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === 'Build log' && (
              <div className="card overflow-hidden">
                <LogStream
                  url={deploymentLogsUrl(d.id, running)}
                  height={520}
                  emptyHint={
                    running
                      ? 'Build is in progress — output appears as the builder emits it.'
                      : 'This build has finished. Its log replays from the start; an empty view means nothing was captured.'
                  }
                />
              </div>
            )}

            {tab === 'Provenance' && <ProvenancePanel id={d.id} />}
            {tab === 'SBOM' && <SbomPanel id={d.id} />}
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}

/* ─────────────────────────────── Provenance ────────────────────────────── */

function ProvenancePanel({ id }: { id: string }) {
  const prov = useAsync(() => getBuildProvenance(id), [id]);

  if (prov.error) {
    const notFound = prov.error instanceof ApiError && prov.error.status === 404;
    return (
      <div className="card">
        <EmptyState
          icon="shield"
          title={notFound ? 'No provenance record' : 'Could not load provenance'}
          hint={
            notFound
              ? 'Provenance is written for successful builds. A failed or in-flight build has no record yet.'
              : prov.error.message
          }
        />
      </div>
    );
  }

  return (
    <AsyncBoundary state={prov} skeleton={<SkeletonBlock height={220} />}>
      {(p) => (
        <SectionCard title="Build provenance">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Field k="Source SHA-256" v={<Mono>{p.source_sha256.slice(0, 20)}…</Mono>} />
            <Field k="Commit" v={p.commit_sha ? <Mono>{p.commit_sha.slice(0, 12)}</Mono> : <Unpopulated />} />
            <Field k="Plan at build time" v={p.plan} />
            <Field k="Builder node" v={<Mono>{p.builder_node_id}</Mono>} />
            <Field k="Started" v={relativeTime(p.started_at)} />
            <Field k="Finished" v={relativeTime(p.finished_at)} />
            <Field k="BuildKit" v={p.buildkit_version || <Unpopulated />} />
            <Field k="Railpack" v={p.railpack_version || <Unpopulated />} />
            <Field k="Base digest" v={p.base_digest ? <Mono>{p.base_digest.slice(0, 20)}…</Mono> : <Unpopulated />} />
            <Field k="Runner digest" v={p.runner_digest ? <Mono>{p.runner_digest.slice(0, 20)}…</Mono> : <Unpopulated />} />
            {p.source_url && <Field k="Source" v={<Mono>{p.source_url}</Mono>} />}
          </dl>
          <div className="px-5 pb-5">
            <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
              Fields marked “not populated” have a column but no writer yet — the cosign signer and syft SBOM step fill
              them in a later phase. They are not missing data about your build.
            </p>
          </div>
        </SectionCard>
      )}
    </AsyncBoundary>
  );
}

function Unpopulated() {
  return (
    <span className="badge badge-muted" title="Column exists; the populator has not filled it yet">
      not populated
    </span>
  );
}

/* ────────────────────────────────── SBOM ───────────────────────────────── */

function SbomPanel({ id }: { id: string }) {
  const sbom = useAsync(() => getBuildSbom(id), [id]);

  if (sbom.error) {
    const notFound = sbom.error instanceof ApiError && sbom.error.status === 404;
    return (
      <div className="card">
        <EmptyState
          icon="shield"
          title={notFound ? 'No SBOM for this build' : 'Could not load the SBOM'}
          hint={
            notFound
              ? 'Software bills of materials are generated by the syft step, which does not run for every build yet.'
              : sbom.error.message
          }
        />
      </div>
    );
  }

  return (
    <AsyncBoundary state={sbom} skeleton={<SkeletonBlock height={220} />}>
      {(doc) => {
        const components = Array.isArray((doc as { components?: unknown[] }).components)
          ? ((doc as { components: { name?: string; version?: string; type?: string }[] }).components)
          : [];
        return (
          <SectionCard
            title="Software bill of materials"
            action={
              <a
                className="btn btn-secondary btn-sm"
                href={`/v1/builds/${id}/sbom`}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="external" size={13} /> Raw CycloneDX
              </a>
            }
          >
            {components.length === 0 ? (
              <EmptyState icon="databases" title="No components listed" hint="The SBOM document contains no component entries." />
            ) : (
              <table className="dtable">
                <thead>
                  <tr><th>Component</th><th>Version</th><th>Type</th></tr>
                </thead>
                <tbody>
                  {components.slice(0, 200).map((c, i) => (
                    <tr key={`${c.name}-${i}`}>
                      <td className="cell-primary">{c.name ?? '—'}</td>
                      <td><Mono>{c.version ?? '—'}</Mono></td>
                      <td>{c.type ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {components.length > 200 && (
              <div className="table-foot">
                <span>Showing the first 200 of {components.length} components — use the raw document for the full list.</span>
              </div>
            )}
          </SectionCard>
        );
      }}
    </AsyncBoundary>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>{k}</dt>
      <dd className="mt-1 font-medium" style={{ color: 'var(--color-ink)' }}>{v}</dd>
    </div>
  );
}
