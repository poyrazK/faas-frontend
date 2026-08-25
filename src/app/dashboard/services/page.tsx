'use client';

/* ==========================================================================
   Services — scale-to-zero Firecracker microVMs and serverless functions.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  listApps, createApp, wakeApp, parkApp,
  getAppsMetrics, listDeployments, listAllInstances, isDegraded, AppType, Runtime, ApiError,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono, SearchInput, FilterSelect, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { StatTile, TableFooter } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon, type IconName } from '@/components/ui/Icons';
import { DegradedNotice } from '@/components/ui/DegradedNotice';
import { relativeTime } from '@/lib/format';
import { ms, compact } from '@/lib/series';

const RAM_OPTIONS = [128, 256, 512, 1024, 2048];
const PER_PAGE = 12;

type DeploySource = 'github' | 'cli' | 'docker';

export default function ServicesPage() {
  const apps = useAsync(listApps, [], 5000);
  const metrics = useAsync(() => getAppsMetrics('24h'), [], 10000);
  const deployments = useAsync(listDeployments, [], 5000);
  const instances = useAsync(() => listAllInstances(100), [], 3000);
  const toast = useToast();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);

  // Service creation form state
  const [slug, setSlug] = useState('');
  const [newType, setNewType] = useState<AppType>('app');
  const [deploySource, setDeploySource] = useState<DeploySource>('cli');
  const [githubRepo, setGithubRepo] = useState('');
  const [dockerImage, setDockerImage] = useState('');
  const [starterTemplate, setStarterTemplate] = useState('hello-node');
  const [runtime, setRuntime] = useState<Runtime>('node22');
  const [ram, setRam] = useState(256);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const degraded = isDegraded(metrics.data?.source);

  /** Newest deployment per app, for the "Last deployed" column. */
  const lastDeploy = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of deployments.data?.items ?? []) {
      const prev = map.get(d.app_id);
      if (!prev || Date.parse(d.created_at) > Date.parse(prev)) map.set(d.app_id, d.created_at);
    }
    return map;
  }, [deployments.data]);

  const enriched = useMemo(
    () =>
      (apps.data ?? []).map((a) => ({
        app: a,
        m: metrics.data?.apps?.[a.slug] ?? null,
        deployedAt: lastDeploy.get(a.id) ?? null,
      })),
    [apps.data, metrics.data, lastDeploy],
  );

  const filtered = useMemo(
    () =>
      enriched.filter(({ app }) => {
        if (query && !app.slug.toLowerCase().includes(query.toLowerCase())) return false;
        if (type !== 'all' && app.type !== type) return false;
        if (status !== 'all' && !app.status.toLowerCase().includes(status)) return false;
        return true;
      }),
    [enriched, query, type, status],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  // Summary Metrics Calculation
  const totalRequests = useMemo(
    () => Object.values(metrics.data?.apps ?? {}).reduce((s, m) => s + (m.request_count || 0), 0),
    [metrics.data],
  );
  const liveAppIds = useMemo(() => {
    const set = new Set<string>();
    for (const inst of instances.data?.instances ?? []) {
      if (inst.state.toLowerCase().includes('run')) {
        set.add(inst.app_id);
      }
    }
    return set;
  }, [instances.data]);

  const runningCount = useMemo(
    () => (instances.data?.instances ?? []).filter((i) => i.state.toLowerCase().includes('run')).length,
    [instances.data],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleanedSlug = slug.trim().toLowerCase();
    if (!cleanedSlug) return;

    setSubmitting(true);
    try {
      await createApp({
        slug: cleanedSlug,
        type: newType,
        ram_mb: ram,
        ...(newType === 'function' ? { runtime } : {}),
      });

      toast.success(`Service “${cleanedSlug}” created.`);
      setOpen(false);
      setSlug('');
      router.push(`/dashboard/services/${cleanedSlug}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create service.');
    } finally {
      setSubmitting(false);
    }
  }

  async function act(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name);
    try {
      await fn();
      toast.success(ok);
      apps.reload();
      instances.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `${name} failed.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Services"
        subtitle="Deploy and manage your scale-to-zero serverless microVMs and functions."
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Icon name="plus" size={14} /> Create service
          </button>
        }
      />

      {degraded && metrics.data && <DegradedNotice source={metrics.data.source} onRetry={metrics.reload} />}

      {/* Top Stat Summary Tiles */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Services" value={apps.data?.length ?? 0} sub="registered microVM workloads" />
        <StatTile label="Live microVMs" value={runningCount} sub="currently resident in memory" color="var(--color-brand-bright)" />
        <StatTile label="Requests (24h)" value={compact(totalRequests)} sub="measured at gateway" />
        <StatTile
          label="Idle services"
          value={Math.max(0, (apps.data?.length ?? 0) - runningCount)}
          sub="0 MB resident memory (scale-to-zero)"
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Search services…" className="w-full max-w-xs" />
          <div className="ml-auto flex items-center gap-2">
            <FilterSelect
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'run', label: 'Running' },
                { value: 'park', label: 'Parked' },
                { value: 'fail', label: 'Failed' },
              ]}
            />
            <FilterSelect
              value={type}
              onChange={(v) => { setType(v); setPage(1); }}
              options={[
                { value: 'all', label: 'All Types' },
                { value: 'app', label: 'App' },
                { value: 'function', label: 'Function' },
              ]}
            />
          </div>
        </div>

        <AsyncBoundary
          state={apps}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={6} rows={5} />}
          empty={
            query || status !== 'all' || type !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No service matches these filters." />
            ) : (
              <EmptyState
                icon="workflows"
                title="No services yet"
                hint="Create a service to deploy your app or function to Firecracker microVMs."
                action={
                  <button className="btn btn-primary" onClick={() => setOpen(true)}>
                    <Icon name="plus" size={14} /> Create service
                  </button>
                }
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
                      <th>Service</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Requests (24h)</th>
                      <th>p95</th>
                      <th>Error rate</th>
                      <th>Memory</th>
                      <th>Last deployed</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(({ app, m, deployedAt }) => (
                      <tr key={app.id}>
                        <td>
                          <Link href={`/dashboard/services/${app.slug}`} className="flex items-center gap-2.5">
                            <span
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                              style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand-bright)' }}
                            >
                              <Icon name={app.type === 'function' ? 'bolt' : 'workflows'} size={14} />
                            </span>
                            <span className="font-medium" style={{ color: 'var(--color-ink)' }}>{app.slug}</span>
                          </Link>
                        </td>
                        <td>
                          {app.type === 'function' ? `Function · ${app.runtime ?? '—'}` : 'HTTPS App'}
                        </td>
                        <td><StatusBadge state={app.status} hasLiveInstance={liveAppIds.has(app.id)} isDeployed={Boolean(deployedAt)} evictionPriority={app.eviction_priority} /></td>
                        <td>{m ? compact(m.request_count) : '—'}</td>
                        <td>{m ? ms(m.latency_p95_ms) : '—'}</td>
                        <td style={m && m.error_rate_pct > 0 ? { color: 'var(--color-danger)' } : undefined}>
                          {m ? `${m.error_rate_pct.toFixed(2)}%` : '—'}
                        </td>
                        <td>{app.ram_mb} MB</td>
                        <td>{relativeTime(deployedAt)}</td>
                        <td>
                          <RowMenu>
                            <RowMenuItem onClick={() => router.push(`/dashboard/services/${app.slug}`)}>Open Service</RowMenuItem>
                            <RowMenuItem
                              onClick={() => act('wake', () => wakeApp(app.slug), `${app.slug} waking.`)}
                            >
                              Wake now
                            </RowMenuItem>
                            <RowMenuItem
                              onClick={() => act('park', () => parkApp(app.slug), `${app.slug} parked.`)}
                            >
                              Park
                            </RowMenuItem>
                          </RowMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TableFooter
                from={(current - 1) * PER_PAGE + 1}
                to={(current - 1) * PER_PAGE + visible.length}
                total={filtered.length}
                noun="services"
                page={current}
                pageCount={pageCount}
                onPage={setPage}
              />
            </>
          )}
        </AsyncBoundary>
      </div>

      {busy && (
        <p className="mt-3 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
          Working…
        </p>
      )}

      {/* ── Enhanced Create Service Modal ────────────────────────────────────── */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create Service"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="create-service" type="submit" disabled={submitting || slug.trim().length < 3}>
              {submitting ? 'Creating…' : 'Create service'}
            </button>
          </>
        }
      >
        <form id="create-service" onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Service Name</label>
            <input
              className="field mono"
              placeholder="api-user-service"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              pattern="^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$"
              minLength={3}
              maxLength={40}
              required
            />
            <p className="mt-1.5 text-xs flex items-center gap-1" style={{ color: 'var(--color-brand)' }}>
              <Icon name="globe" size={12} />
              Public URL: <Mono>https://{slug.trim() || 'name'}.apps.gregale.dev</Mono>
            </p>
          </div>

          <div>
            <label className="label">Service Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewType('app')}
                className="flex flex-col items-start rounded-lg border p-3 text-left transition-all"
                style={{
                  borderColor: newType === 'app' ? 'var(--color-brand)' : 'var(--color-line)',
                  background: newType === 'app' ? 'var(--color-brand-softer)' : 'var(--color-surface)',
                }}
              >
                <span className="font-semibold text-sm" style={{ color: newType === 'app' ? 'var(--color-brand-bright)' : 'var(--color-ink)' }}>
                  HTTPS App
                </span>
                <span className="text-xs mt-0.5" style={{ color: 'var(--color-ink-muted)' }}>
                  Long-running HTTP server or container workload
                </span>
              </button>

              <button
                type="button"
                onClick={() => setNewType('function')}
                className="flex flex-col items-start rounded-lg border p-3 text-left transition-all"
                style={{
                  borderColor: newType === 'function' ? 'var(--color-brand)' : 'var(--color-line)',
                  background: newType === 'function' ? 'var(--color-brand-softer)' : 'var(--color-surface)',
                }}
              >
                <span className="font-semibold text-sm" style={{ color: newType === 'function' ? 'var(--color-brand-bright)' : 'var(--color-ink)' }}>
                  Serverless Function
                </span>
                <span className="text-xs mt-0.5" style={{ color: 'var(--color-ink-muted)' }}>
                  Event-driven request handler (Node, Python, Go)
                </span>
              </button>
            </div>
          </div>

          {/* Deployment Source Picker */}
          <div>
            <label className="label">Deployment Source</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'cli', label: 'CLI / Terminal', icon: 'terminal', hint: 'gregale deploy' },
                { id: 'github', label: 'GitHub Repository', icon: 'code', hint: 'Push-to-deploy' },
                { id: 'docker', label: 'Docker Image', icon: 'deployments', hint: 'OCI container' },
              ].map((src) => (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => setDeploySource(src.id as DeploySource)}
                  className="flex flex-col items-center justify-center rounded-lg border p-3 text-center transition-all"
                  style={{
                    borderColor: deploySource === src.id ? 'var(--color-brand)' : 'var(--color-line)',
                    background: deploySource === src.id ? 'var(--color-brand-softer)' : 'var(--color-surface)',
                  }}
                >
                  <Icon name={src.icon as IconName} size={18} style={{ color: deploySource === src.id ? 'var(--color-brand-bright)' : 'var(--color-ink-muted)' }} />
                  <span className="font-medium text-xs mt-1.5" style={{ color: deploySource === src.id ? 'var(--color-brand-bright)' : 'var(--color-ink)' }}>
                    {src.label}
                  </span>
                </button>
              ))}
            </div>

            {deploySource === 'github' && (
              <div className="mt-3 rounded-lg border p-3 space-y-2" style={{ background: 'var(--color-surface-subtle)', borderColor: 'var(--color-line)' }}>
                <label className="label text-xs">Repository (org/repo)</label>
                <input
                  type="text"
                  className="field mono text-xs"
                  placeholder="acme/user-service"
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                />
                <p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                  Pushes to <Mono>main</Mono> branch will automatically build and deploy.
                </p>
              </div>
            )}

            {deploySource === 'docker' && (
              <div className="mt-3 rounded-lg border p-3 space-y-2" style={{ background: 'var(--color-surface-subtle)', borderColor: 'var(--color-line)' }}>
                <label className="label text-xs">Container Image Reference</label>
                <input
                  type="text"
                  className="field mono text-xs"
                  placeholder="docker.io/myorg/myapp:latest"
                  value={dockerImage}
                  onChange={(e) => setDockerImage(e.target.value)}
                />
                <p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                  Pulled directly into the microVM rootfs on cold wake.
                </p>
              </div>
            )}

            {deploySource === 'cli' && (
              <div className="mt-3 rounded-lg border p-3 space-y-2" style={{ background: 'var(--color-surface-subtle)', borderColor: 'var(--color-line)' }}>
                <label className="label text-xs">Starter Template</label>
                <select className="field text-xs" value={starterTemplate} onChange={(e) => setStarterTemplate(e.target.value)}>
                  <option value="hello-node">hello-node (Node.js HTTP service)</option>
                  <option value="hello-python">hello-python (Python FastAPI service)</option>
                  <option value="hello-go">hello-go (Go static binary)</option>
                  <option value="cron-example">cron-example (Scheduled background job)</option>
                </select>
                <div className="mt-2 rounded p-2 text-xs mono" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)' }}>
                  $ gregale deploy --name {slug.trim() || 'my-service'} --template={starterTemplate}
                </div>
              </div>
            )}
          </div>

          {newType === 'function' && (
            <div>
              <label className="label">Runtime</label>
              <select className="field" value={runtime} onChange={(e) => setRuntime(e.target.value as Runtime)}>
                <option value="node22">Node.js 22</option>
                <option value="python312">Python 3.12</option>
              </select>
            </div>
          )}

          <div>
            <label className="label">Memory Allocation</label>
            <div className="flex items-center gap-2">
              {RAM_OPTIONS.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setRam(r)}
                  className="flex-1 rounded-md border py-1.5 text-xs font-semibold"
                  style={{
                    borderColor: ram === r ? 'var(--color-brand)' : 'var(--color-line)',
                    background: ram === r ? 'var(--color-brand-softer)' : 'var(--color-surface)',
                    color: ram === r ? 'var(--color-brand-bright)' : 'var(--color-ink-soft)',
                  }}
                >
                  {r} MB
                </button>
              ))}
            </div>
          </div>

          <div
            className="rounded-lg p-3 text-xs flex items-start gap-2"
            style={{ background: 'var(--color-brand-softer)', border: '1px solid var(--color-brand-line)', color: 'var(--color-ink-soft)' }}
          >
            <Icon name="help" size={15} style={{ color: 'var(--color-brand-bright)', marginTop: 1, flex: 'none' }} />
            <span>
              This service will scale to zero when idle (0 resident RAM) and wake on demand in &lt;350ms.
            </span>
          </div>
        </form>
      </Modal>
    </div>
  );
}
