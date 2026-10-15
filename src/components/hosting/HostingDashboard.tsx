'use client';

import { useCallback, useState } from 'react';
import {
  getHostingCapabilities, listHostingSites, listHostingProjects, listHostingEnvironments, createHostingSite,
  type HostingCapabilities, type HostingProject, type HostingSite,
} from '@/lib/hosting';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useHostingQuery } from '@/lib/useHostingQuery';
import { PageHeader } from '@/components/ui/bits';
import { ErrorState, EmptyState, Spinner } from '@/components/ui/States';
import { HostingSiteDetail } from './HostingSiteDetail';

export function HostingDashboard() {
  const capabilities = useHostingQuery(getHostingCapabilities, 30000);
  if (capabilities.error) {
    const code = capabilities.error instanceof ApiError ? capabilities.error.code : '';
    return <><PageHeader title="Frontend Hosting" subtitle="Internal pilot" />
      {code === 'frontend_hosting_disabled' && <p className="card p-4 text-sm">Frontend hosting is disabled on this control plane. An operator can enable the pilot in Runtime Configuration after its providers are configured.</p>}
      <ErrorState error={capabilities.error} onRetry={capabilities.refresh} /></>;
  }
  if (!capabilities.data) return <div className="flex items-center gap-2 p-6"><Spinner /> Checking hosting access…</div>;
  return <HostingInventory capabilities={capabilities.data} />;
}

function HostingInventory({ capabilities }: { capabilities: HostingCapabilities }) {
  const { account } = useAuth();
  const inventory = useHostingQuery(listHostingSites);
  const projects = useHostingQuery(listHostingProjects, 30000);
  const [project, setProject] = useState('');
  const [environment, setEnvironment] = useState('');
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const sites = inventory.data ?? [];
  const visible = sites.filter((site) => (!project || site.project_id === project) && (!environment || site.environment === environment));
  const environments = [...new Set(sites.filter((site) => !project || site.project_id === project).map((site) => site.environment))].sort();
  const stale = !!inventory.error || !!projects.error;
  const projectName = (id: string) => projects.data?.find((item) => item.id === id)?.slug ?? id;
  return <div className="space-y-5">
    <PageHeader title="Frontend Hosting" subtitle="Internal pilot · prebuilt static sites" actions={<>
      <button className="btn btn-secondary btn-sm" onClick={() => { inventory.refresh(); projects.refresh(); }}>Refresh</button>
      <button className="btn btn-primary btn-sm" disabled={stale || !inventory.data || !projects.data?.length || sites.length >= capabilities.sites_per_account} onClick={() => setCreating((value) => !value)}>{creating ? 'Close form' : 'Create site'}</button>
    </>} />
    <p className="text-sm text-[var(--color-ink-muted)]">Sites belong to {account?.email}&apos;s account. Site visits require a separate Cloudflare Access sign-in.</p>
    {inventory.error && <QueryError error={inventory.error} retry={inventory.refresh} />}
    {projects.error && <QueryError error={projects.error} retry={projects.refresh} />}
    {projects.data?.length === 0 && <p className="card p-4 text-sm">Create a project in the customer console or CLI first, then return here to add its frontend.</p>}
    {sites.length >= capabilities.sites_per_account && <p className="card p-4 text-sm">The internal pilot permits {capabilities.sites_per_account} sites per account. Deleting sites count until cleanup finishes.</p>}
    {creating && projects.data && <CreateSiteForm key={project} projects={projects.data} initialProject={project} limits={capabilities} disabled={stale} onCreated={(site) => { setCreating(false); setSelected(site.id); inventory.refresh(); }} />}
    <section className="card overflow-hidden" aria-label="Hosting sites">
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] p-4">
        <label className="text-xs font-medium">Project<select aria-label="Filter by project" className="field mt-1" value={project} onChange={(event) => { setProject(event.target.value); setEnvironment(''); }}>
          <option value="">All projects</option>{projects.data?.map((item) => <option key={item.id} value={item.id}>{item.slug}</option>)}
        </select></label>
        <label className="text-xs font-medium">Environment<select aria-label="Filter by environment" className="field mt-1" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
          <option value="">All environments</option>{environments.map((item) => <option key={item}>{item}</option>)}
        </select></label>
        <span className="ml-auto text-xs text-[var(--color-ink-muted)]">{sites.length} / {capabilities.sites_per_account} sites</span>
      </div>
      {!inventory.data && !inventory.error ? <div className="flex items-center gap-2 p-6"><Spinner /> Loading sites…</div> : visible.length === 0 ? <EmptyState title="No sites here yet" hint="Create a site, then select its built output directory to deploy." /> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="bg-[var(--color-surface-subtle)] text-xs text-[var(--color-ink-muted)]"><tr>{['Site', 'Project / environment', 'Intent', 'Release', ''].map((name, index) => <th className="p-3 font-medium" key={index}>{name}</th>)}</tr></thead>
        <tbody>{visible.map((site) => <tr key={site.id} className="border-t border-[var(--color-line)]">
          <td className="p-3"><div className="font-semibold">{site.name}</div><div className="text-xs text-[var(--color-ink-muted)]">{site.hostname}</div></td>
          <td className="p-3">{projectName(site.project_id)}<div className="text-xs text-[var(--color-ink-muted)]">{site.environment}</div></td>
          <td className="p-3"><span className={`badge ${site.status === 'deleting' || site.suspended ? 'badge-warning' : 'badge-neutral'}`}>{site.status === 'deleting' ? 'Deleting' : site.suspended ? 'Suspended' : 'Enabled'}</span></td>
          <td className="p-3 font-mono text-xs">{site.active_release_id ? site.active_release_id.slice(0, 8) : 'No release'}</td>
          <td className="p-3 text-right"><button className="btn btn-secondary btn-sm" onClick={() => setSelected(site.id)} aria-label={`Manage ${site.name}`} aria-pressed={selected === site.id}>Manage</button></td>
        </tr>)}</tbody>
      </table></div>}
      <p className="border-t border-[var(--color-line)] p-3 text-xs text-[var(--color-ink-muted)]">Intent describes the requested state. Open a site to see publication progress.</p>
    </section>
    {selected && <HostingSiteDetail key={selected} id={selected} limits={capabilities} inventoryStale={stale} onChange={inventory.refresh} onClose={() => { setSelected(''); inventory.refresh(); }} />}
  </div>;
}

function CreateSiteForm({ projects, initialProject, limits, disabled, onCreated }: {
  projects: HostingProject[]; initialProject: string; limits: HostingCapabilities; disabled: boolean; onCreated: (site: HostingSite) => void;
}) {
  const [project, setProject] = useState(initialProject || projects[0]?.id || '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = projects.find((item) => item.id === project);
  return <section className="card space-y-4 p-5" aria-label="Create hosting site"><h2 className="font-semibold">Create site</h2>
    <label className="block text-sm">Project<select className="field mt-1" value={project} onChange={(event) => setProject(event.target.value)} disabled={busy || disabled}>
      {projects.map((item) => <option key={item.id} value={item.id}>{item.slug}</option>)}
    </select></label>
    {selected && <CreateEnvironmentForm key={selected.id} project={selected.slug} disabled={busy || disabled} name={name} setName={setName} limits={limits} submit={async (environment) => {
      setBusy(true); setError(null);
      try { onCreated(await createHostingSite(selected.slug, environment, name)); }
      catch (error) { setError(error instanceof Error ? error.message + ' Refresh sites before retrying an uncertain creation.' : 'Site creation failed.'); }
      finally { setBusy(false); }
    }} />}
    {busy && <p role="status" className="text-sm">Creating site…</p>}
    {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
  </section>;
}

function CreateEnvironmentForm({ project, disabled, name, setName, limits, submit }: {
  project: string; disabled: boolean; name: string; setName: (name: string) => void; limits: HostingCapabilities; submit: (environment: string) => Promise<void>;
}) {
  const fetcher = useCallback((signal: AbortSignal) => listHostingEnvironments(project, signal), [project]);
  const environments = useHostingQuery(fetcher, 30000);
  const [choice, setChoice] = useState('');
  const environment = choice || environments.data?.find((item) => item.slug === 'production')?.slug || environments.data?.[0]?.slug || '';
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!disabled && !environments.error && environments.data?.some((item) => item.slug === environment)) void submit(environment); }}>
    {environments.error && <QueryError error={environments.error} retry={environments.refresh} />}
    <label className="block text-sm">Environment<select className="field mt-1" value={environment} onChange={(event) => setChoice(event.target.value)} disabled={disabled || !environments.data || !!environments.error} required>
      {!environments.data?.length && <option value="">{environments.data ? 'No registered environments' : 'Loading environments…'}</option>}
      {environments.data?.map((item) => <option key={item.id} value={item.slug}>{item.slug}</option>)}
    </select></label>
    <label className="block text-sm">Site name<input className="field mt-1" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={limits.name_max_bytes} value={name} onChange={(event) => setName(event.target.value)} placeholder="support-portal" disabled={disabled} /></label>
    <p className="text-xs text-[var(--color-ink-muted)]">Use lowercase letters, numbers, and hyphens. A private site URL is assigned automatically.</p>
    <button className="btn btn-primary btn-sm" disabled={disabled || !!environments.error || !environment}>Create site</button>
  </form>;
}

export function QueryError({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="card flex flex-wrap items-center justify-between gap-3 border-[var(--color-danger)] p-4 text-sm" role="alert">
    <p>{error.message} Data may be stale; changes are paused.</p><button className="btn btn-secondary btn-sm" onClick={retry}>Retry refresh</button>
  </div>;
}
