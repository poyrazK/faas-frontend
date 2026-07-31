'use client';

/* ==========================================================================
   Workflow detail — the template's tabbed record page.

   Tabs are local state rather than nested routes: every tab reads from the
   same app record and they share the header actions, so a route boundary
   would only cost a refetch.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getApp, updateApp, deleteApp, renameApp, wakeApp, parkApp, rollbackApp,
  listInstances, listSecrets, setSecret, deleteSecret, listAppDeployments,
  listDomains, listCrons, listInvocations, getAppMetrics, isDegraded, appLogsUrl,
  deployImage, deploySource, invokeApp, invokeAppAsync, type InvokeResult, ApiError,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono, CopyButton, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { SectionCard, StatTile } from '@/components/ui/Panels';
import { AreaChart } from '@/components/ui/Chart';
import { AsyncBoundary, EmptyState, SkeletonTable, SkeletonBlock, Spinner } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { LogStream } from '@/components/LogStream';
import { DegradedNotice } from '@/components/ui/DegradedNotice';
import { relativeTime } from '@/lib/format';
import { invocationsByDay, totals, compact, ms } from '@/lib/series';

const TABS = ['Overview', 'Test', 'Deployments', 'Instances', 'Logs', 'Secrets', 'Configuration', 'Domains', 'Triggers'] as const;
type Tab = (typeof TABS)[number];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export default function WorkflowDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const toast = useToast();

  const app = useAsync(() => getApp(slug), [slug]);
  const instances = useAsync(() => listInstances(slug), [slug]);
  const secrets = useAsync(() => listSecrets(slug), [slug]);
  const deployments = useAsync(() => listAppDeployments(slug), [slug]);
  const domains = useAsync(listDomains, []);
  const crons = useAsync(listCrons, []);
  const invocations = useAsync(() => listInvocations(200), []);
  const metrics = useAsync(() => getAppMetrics(slug, '24h'), [slug]);

  const [tab, setTab] = useState<Tab>('Overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [secretOpen, setSecretOpen] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [secretVal, setSecretVal] = useState('');
  const [renameTo, setRenameTo] = useState('');

  // Deploy
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployMode, setDeployMode] = useState<'image' | 'source'>('image');
  const [image, setImage] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [isDockerfile, setIsDockerfile] = useState(false);

  // Test panel
  const [testMethod, setTestMethod] = useState('POST');
  const [testPath, setTestPath] = useState('/');
  const [testBody, setTestBody] = useState('{\n  "hello": "world"\n}');
  const [testAsync, setTestAsync] = useState(false);
  const [testResult, setTestResult] = useState<InvokeResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const mine = useMemo(
    () => (invocations.data?.invocations ?? []).filter((r) => r.app_id === app.data?.id),
    [invocations.data, app.data],
  );
  const series = useMemo(() => invocationsByDay(mine, 7), [mine]);
  const stats = useMemo(() => totals(mine), [mine]);

  const myDomains = (domains.data ?? []).filter((d) => d.app_id === app.data?.id);
  const myCrons = (crons.data ?? []).filter((c) => c.app_id === app.data?.id);

  async function act(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name);
    try {
      await fn();
      toast.success(ok);
      app.reload();
      instances.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `${name} failed.`);
    } finally {
      setBusy(null);
    }
  }

  async function runDeploy(e: React.FormEvent) {
    e.preventDefault();
    setBusy('deploy');
    try {
      const dep =
        deployMode === 'image'
          ? await deployImage(slug, image.trim())
          : await deploySource(slug, sourceFile!, {
              dockerfile: isDockerfile,
              kind: app.data?.type,
              runtime: app.data?.runtime ?? undefined,
            });
      // 202 Accepted: the build is queued, not finished. Send the user
      // straight to the build log rather than implying the deploy is done.
      toast.success('Build queued.');
      setDeployOpen(false);
      setImage('');
      setSourceFile(null);
      deployments.reload();
      router.push(`/dashboard/deployments/${dep.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not start the deployment.');
    } finally {
      setBusy(null);
    }
  }

  async function runTest(e: React.FormEvent) {
    e.preventDefault();
    setBusy('test');
    setTestResult(null);
    setTestError(null);
    try {
      let payload: Record<string, unknown> | undefined;
      if (testBody.trim()) {
        try {
          payload = JSON.parse(testBody) as Record<string, unknown>;
        } catch {
          setTestError('Payload must be valid JSON.');
          return;
        }
      }
      const input = { method: testMethod, path: testPath.trim() || '/', payload };
      const res = testAsync ? await invokeAppAsync(slug, input) : await invokeApp(slug, input);
      setTestResult(res);
      invocations.reload();
    } catch (err) {
      // 504 is a long-poll timeout, not a failure: the invocation is still
      // running and its row can be read back later.
      if (err instanceof ApiError && err.status === 504) {
        setTestError(
          'The request exceeded the long-poll window (30s on paid plans, 5s on Free). The invocation is still running — check Recent dispatches for its result.',
        );
      } else {
        setTestError(err instanceof ApiError ? err.message : 'Invoke failed.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function saveSecret(e: React.FormEvent) {
    e.preventDefault();
    setBusy('secret');
    try {
      await setSecret(slug, secretKey.trim(), secretVal);
      toast.success(`Secret ${secretKey.trim()} saved.`);
      setSecretOpen(false);
      setSecretKey('');
      setSecretVal('');
      secrets.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save secret.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <Link
        href="/dashboard/workflows"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: 'var(--color-ink-muted)' }}
      >
        <Icon name="chevronLeft" size={14} /> Workflows
      </Link>

      <AsyncBoundary state={app} skeleton={<SkeletonBlock height={120} />}>
        {(a) => (
          <>
            <PageHeader
              title={a.slug}
              subtitle={
                a.type === 'function'
                  ? `Function · ${a.runtime ?? 'runtime unset'} · ${a.ram_mb} MB`
                  : `HTTPS App · ${a.ram_mb} MB · max ${a.max_concurrency} concurrent`
              }
              actions={
                <>
                  <a href={a.url} target="_blank" rel="noreferrer" className="btn btn-secondary">
                    <Icon name="external" size={14} /> Open
                  </a>
                  <button className="btn btn-secondary" onClick={() => setTab('Test')}>
                    <Icon name="play" size={13} /> Test
                  </button>
                  <button className="btn btn-primary" onClick={() => setDeployOpen(true)}>
                    <Icon name="deployments" size={14} /> Deploy
                  </button>
                  <button className="btn btn-secondary" disabled={!!busy} onClick={() => act('wake', () => wakeApp(slug), 'Wake requested.')}>
                    <Icon name="bolt" size={14} /> Wake
                  </button>
                  <RowMenu>
                    <RowMenuItem onClick={() => act('park', () => parkApp(slug), 'Parked to snapshot.')}>Park now</RowMenuItem>
                    <RowMenuItem onClick={() => act('rollback', () => rollbackApp(slug), 'Rolled back to previous deployment.')}>
                      Roll back
                    </RowMenuItem>
                    <RowMenuItem onClick={() => { setRenameTo(a.slug); setTab('Configuration'); }}>Rename</RowMenuItem>
                    <RowMenuItem danger onClick={() => setConfirmDelete(true)}>Delete workflow</RowMenuItem>
                  </RowMenu>
                </>
              }
            />

            {/* Tabs */}
            <div className="mb-5 flex gap-1 overflow-x-auto" style={{ borderBottom: '1px solid var(--color-line)' }}>
              {TABS.map((t) => (
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

            {/* ── Overview ────────────────────────────────────────────── */}
            {tab === 'Overview' && (
              <div className="space-y-4">
                <SectionCard title="Endpoint">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <a href={a.url} target="_blank" rel="noreferrer" className="mono text-sm font-medium" style={{ color: 'var(--color-brand)' }}>
                      {a.url}
                    </a>
                    <div className="flex items-center gap-2">
                      <StatusBadge state={a.status} />
                      <CopyButton value={a.url} label="Copy URL" />
                    </div>
                  </div>
                </SectionCard>

                {isDegraded(metrics.data?.source) && metrics.data && (
                  <DegradedNotice source={metrics.data.source} onRetry={metrics.reload} />
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatTile
                    label="Requests (24h)"
                    value={metrics.data ? compact(metrics.data.request_count) : '—'}
                    sub="measured at the gateway"
                  />
                  <StatTile
                    label="p95 latency"
                    value={metrics.data ? ms(metrics.data.latency_p95_ms) : '—'}
                    sub={metrics.data ? `p50 ${ms(metrics.data.latency_p50_ms)} · p99 ${ms(metrics.data.latency_p99_ms)}` : undefined}
                  />
                  <StatTile
                    label="Error rate"
                    value={metrics.data ? `${metrics.data.error_rate_pct.toFixed(2)}%` : '—'}
                    color="var(--color-chart-alt)"
                    sub={metrics.data ? `${metrics.data.cold_start_pct.toFixed(1)}% cold starts` : undefined}
                  />
                  <StatTile
                    label="Live instances"
                    value={instances.data ? instances.data.length : '—'}
                    sub={`min ${a.min_instances} kept warm`}
                  />
                </div>

                <SectionCard
                  title="Dispatched work (7 days)"
                  action={
                    <span className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                      {stats.failed > 0 ? `${stats.failed} failed · ` : ''}avg {ms(stats.avgCompletionMs)}
                    </span>
                  }
                  bodyClassName="p-4"
                >
                  {mine.length === 0 ? (
                    <EmptyState
                      icon="spark"
                      title="No dispatched invocations"
                      hint="Queue jobs, cron runs and async invokes for this workflow show up here. HTTPS requests are measured separately, in the tiles above."
                    />
                  ) : (
                    <AreaChart points={series} height={230} valueLabel="Dispatches" format={(n) => compact(n)} />
                  )}
                </SectionCard>

                <SectionCard title="Details">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5 text-sm sm:grid-cols-4">
                    <Detail k="Runtime" v={a.runtime ?? (a.type === 'app' ? 'container image' : '—')} />
                    <Detail k="Memory" v={`${a.ram_mb} MB`} />
                    <Detail k="Max concurrency" v={String(a.max_concurrency)} />
                    <Detail k="Min instances" v={String(a.min_instances)} />
                    <Detail k="Idle timeout" v={a.idle_timeout_s != null ? `${a.idle_timeout_s}s` : 'platform default'} />
                    <Detail k="Workflow ID" v={<Mono>{a.id.slice(0, 16)}…</Mono>} />
                    <Detail k="Entrypoint" v={<Mono>{a.manifest?.entrypoint?.join(' ') || '—'}</Mono>} />
                    <Detail k="Health check" v={a.manifest?.healthz ? <Mono>{a.manifest.healthz}</Mono> : 'none'} />
                  </dl>
                </SectionCard>
              </div>
            )}

            {/* ── Test ───────────────────────────────────────────────── */}
            {tab === 'Test' && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <SectionCard title="Invoke this workflow">
                  <form onSubmit={runTest} className="space-y-4 px-5 py-5">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="label">Method</label>
                        <select className="field" value={testMethod} onChange={(e) => setTestMethod(e.target.value)}>
                          {HTTP_METHODS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="label">Path</label>
                        <input className="field mono" value={testPath} onChange={(e) => setTestPath(e.target.value)} placeholder="/" />
                      </div>
                    </div>

                    <div>
                      <label className="label">Payload (JSON)</label>
                      <textarea className="field mono" rows={8} value={testBody} onChange={(e) => setTestBody(e.target.value)} />
                      <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                        Leave empty to send no body.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="seg">
                        <button type="button" data-active={!testAsync} onClick={() => setTestAsync(false)}>
                          Wait for result
                        </button>
                        <button type="button" data-active={testAsync} onClick={() => setTestAsync(true)}>
                          Fire and forget
                        </button>
                      </div>
                      <button className="btn btn-primary" type="submit" disabled={busy === 'test'}>
                        {busy === 'test' ? <Spinner size={14} /> : <Icon name="play" size={13} />}
                        {busy === 'test' ? 'Invoking…' : 'Send'}
                      </button>
                    </div>

                    <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                      {testAsync
                        ? 'Returns immediately with an invocation id; the result lands in the invocations table.'
                        : 'The server long-polls until the run finishes — up to 30s on paid plans, 5s on Free.'}
                    </p>
                  </form>
                </SectionCard>

                <SectionCard title="Response">
                  {testError ? (
                    <div className="px-5 py-5">
                      <div
                        className="rounded-lg px-3 py-2.5 text-sm"
                        style={{ background: '#fdf6e7', color: '#7c4f08', border: '1px solid #f2e2bd' }}
                      >
                        {testError}
                      </div>
                    </div>
                  ) : testResult ? (
                    <div className="px-5 py-5">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <StatusBadge state={testResult.status} />
                        <Mono>{testResult.id.slice(0, 16)}</Mono>
                        <CopyButton value={testResult.id} label="Copy id" />
                      </div>
                      {testResult.result ? (
                        <pre
                          className="mono overflow-auto rounded-lg px-4 py-3 text-xs leading-relaxed"
                          style={{ background: 'var(--color-surface-code)', color: '#e7e5e1', maxHeight: 340 }}
                        >
                          {JSON.stringify(testResult.result, null, 2)}
                        </pre>
                      ) : (
                        <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                          {testResult.status === 'pending' || testResult.status === 'dispatching'
                            ? 'Queued. The result appears in the invocations table once the drain runs it.'
                            : 'The run returned no body.'}
                        </p>
                      )}
                    </div>
                  ) : (
                    <EmptyState
                      icon="play"
                      title="No invocation yet"
                      hint="Send a request to see the response the workflow returns."
                    />
                  )}
                </SectionCard>
              </div>
            )}

            {/* ── Deployments ─────────────────────────────────────────── */}
            {tab === 'Deployments' && (
              <SectionCard
                title="Deployment history"
                action={
                  <button className="btn btn-secondary btn-sm" onClick={() => deployments.reload()}>
                    <Icon name="refresh" size={13} /> Refresh
                  </button>
                }
              >
                <AsyncBoundary
                  state={deployments}
                  isEmpty={(d) => d.items.length === 0}
                  skeleton={<SkeletonTable cols={4} rows={4} />}
                  empty={<EmptyState icon="deployments" title="No deployments" hint="Deploy with the CLI or push to a connected repo." />}
                >
                  {(d) => (
                    <table className="dtable">
                      <thead>
                        <tr><th>Deployment</th><th>Kind</th><th>Image digest</th><th>Status</th><th>Created</th></tr>
                      </thead>
                      <tbody>
                        {d.items.map((dep) => (
                          <tr key={dep.id}>
                            <td className="cell-primary">
                              <Link href={`/dashboard/deployments/${dep.id}`} style={{ color: 'var(--color-brand)' }}>
                                <Mono>{dep.id.slice(0, 12)}</Mono>
                              </Link>
                            </td>
                            <td>{dep.kind}</td>
                            <td className="mono text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                              {dep.image_digest ? dep.image_digest.slice(0, 20) + '…' : '—'}
                            </td>
                            <td>
                              <StatusBadge state={dep.status} />
                              {dep.error && <div className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>{dep.error}</div>}
                            </td>
                            <td>{relativeTime(dep.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </AsyncBoundary>
              </SectionCard>
            )}

            {/* ── Instances ───────────────────────────────────────────── */}
            {tab === 'Instances' && (
              <SectionCard
                title="Live microVMs"
                action={
                  <button className="btn btn-secondary btn-sm" onClick={() => instances.reload()}>
                    <Icon name="refresh" size={13} /> Refresh
                  </button>
                }
              >
                <AsyncBoundary
                  state={instances}
                  isEmpty={(d) => d.length === 0}
                  skeleton={<SkeletonTable cols={4} rows={2} />}
                  empty={<EmptyState icon="workers" title="No live instances" hint="This workflow is parked. It cold-wakes on the next request." />}
                >
                  {(list) => (
                    <table className="dtable">
                      <thead>
                        <tr><th>Instance</th><th>State</th><th>Memory</th><th>Started</th><th>Last request</th></tr>
                      </thead>
                      <tbody>
                        {list.map((i) => (
                          <tr key={i.id}>
                            <td className="cell-primary"><Mono>{i.id.slice(0, 12)}</Mono></td>
                            <td><StatusBadge state={i.state} /></td>
                            <td>{i.ram_mb} MB</td>
                            <td>{relativeTime(i.started_at)}</td>
                            <td>{relativeTime(i.last_request_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </AsyncBoundary>
              </SectionCard>
            )}

            {/* ── Logs ────────────────────────────────────────────────── */}
            {tab === 'Logs' && (
              <div className="card overflow-hidden">
                <LogStream url={appLogsUrl(slug, true)} emptyHint={`Waiting for ${slug} to write to stdout or stderr.`} />
              </div>
            )}

            {/* ── Secrets ─────────────────────────────────────────────── */}
            {tab === 'Secrets' && (
              <SectionCard
                title="Sealed secrets"
                action={
                  <button className="btn btn-primary btn-sm" onClick={() => setSecretOpen(true)}>
                    <Icon name="plus" size={13} /> Add secret
                  </button>
                }
              >
                <AsyncBoundary
                  state={secrets}
                  isEmpty={(d) => d.secrets.length === 0}
                  skeleton={<SkeletonTable cols={3} rows={3} />}
                  empty={<EmptyState icon="secrets" title="No secrets" hint="Sealed values injected into the guest environment at boot." />}
                >
                  {(data) => (
                    <>
                      <table className="dtable">
                        <thead><tr><th>Key</th><th>Created</th><th>Updated</th><th /></tr></thead>
                        <tbody>
                          {data.secrets.map((s) => (
                            <tr key={s.key}>
                              <td className="mono cell-primary">{s.key}</td>
                              <td>{relativeTime(s.created_at)}</td>
                              <td>{relativeTime(s.updated_at)}</td>
                              <td className="text-right">
                                <button
                                  className="btn btn-ghost btn-sm"
                                  style={{ color: 'var(--color-danger)' }}
                                  onClick={async () => {
                                    try {
                                      await deleteSecret(slug, s.key);
                                      toast.success(`Secret ${s.key} deleted.`);
                                      secrets.reload();
                                    } catch (err) {
                                      toast.error(err instanceof ApiError ? err.message : 'Delete failed.');
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="table-foot">
                        <span>{data.count} of {data.quota_max} allowed on this plan</span>
                      </div>
                    </>
                  )}
                </AsyncBoundary>
              </SectionCard>
            )}

            {/* ── Configuration ───────────────────────────────────────── */}
            {tab === 'Configuration' && (
              <div className="space-y-4">
                <SectionCard title="Scaling">
                  <div className="space-y-4 px-5 py-5">
                    <ConfigRow
                      label="Memory"
                      hint="RAM allocated to each microVM. Capped by your plan."
                      control={
                        <select
                          className="field"
                          style={{ width: 140 }}
                          value={a.ram_mb}
                          onChange={(e) => act('ram', () => updateApp(slug, { ram_mb: Number(e.target.value) }), 'Memory updated.')}
                        >
                          {[128, 256, 512, 1024, 2048].map((r) => (
                            <option key={r} value={r}>{r} MB</option>
                          ))}
                        </select>
                      }
                    />
                    <ConfigRow
                      label="Min instances"
                      hint="Keep one warm to skip the cold wake — it bills continuously."
                      control={
                        <div className="seg">
                          {[0, 1].map((n) => (
                            <button
                              key={n}
                              data-active={a.min_instances === n}
                              onClick={() => act('min', () => updateApp(slug, { min_instances: n }), n === 0 ? 'Scales to zero when idle.' : 'Keeping one instance warm.')}
                            >
                              {n === 0 ? 'Scale to zero' : 'Always warm'}
                            </button>
                          ))}
                        </div>
                      }
                    />
                    <ConfigRow
                      label="Max concurrency"
                      hint="Simultaneous in-flight requests per workflow."
                      control={
                        <input
                          className="field"
                          style={{ width: 140 }}
                          type="number"
                          min={1}
                          defaultValue={a.max_concurrency}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v && v !== a.max_concurrency) act('conc', () => updateApp(slug, { max_concurrency: v }), 'Concurrency updated.');
                          }}
                        />
                      }
                    />
                    <ConfigRow
                      label="Idle timeout"
                      hint="Seconds of inactivity before the microVM parks to a snapshot."
                      control={
                        <input
                          className="field"
                          style={{ width: 140 }}
                          type="number"
                          min={1}
                          defaultValue={a.idle_timeout_s ?? undefined}
                          placeholder="default"
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v && v !== a.idle_timeout_s) act('idle', () => updateApp(slug, { idle_timeout_s: v }), 'Idle timeout updated.');
                          }}
                        />
                      }
                    />
                  </div>
                </SectionCard>

                <SectionCard title="Rename">
                  <div className="flex flex-wrap items-end gap-3 px-5 py-5">
                    <div className="flex-1" style={{ minWidth: 220 }}>
                      <label className="label">New name</label>
                      <input
                        className="field"
                        value={renameTo}
                        placeholder={a.slug}
                        onChange={(e) => setRenameTo(e.target.value.toLowerCase())}
                        pattern="^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$"
                      />
                      <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                        The public URL changes with the name. Update DNS and clients before renaming.
                      </p>
                    </div>
                    <button
                      className="btn btn-secondary"
                      disabled={!renameTo || renameTo === a.slug || !!busy}
                      onClick={async () => {
                        setBusy('rename');
                        try {
                          await renameApp(slug, renameTo);
                          toast.success(`Renamed to ${renameTo}.`);
                          router.replace(`/dashboard/workflows/${renameTo}`);
                        } catch (err) {
                          toast.error(err instanceof ApiError ? err.message : 'Rename failed.');
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Rename workflow
                    </button>
                  </div>
                </SectionCard>

                <div className="card p-5" style={{ borderColor: '#f3d3d3' }}>
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--color-danger)' }}>Danger zone</h2>
                  <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
                    Deleting removes <Mono>{a.slug}</Mono>, its snapshots and its deployment history. This cannot be undone.
                  </p>
                  <button className="btn btn-danger mt-4" onClick={() => setConfirmDelete(true)}>
                    Delete workflow
                  </button>
                </div>
              </div>
            )}

            {/* ── Domains ─────────────────────────────────────────────── */}
            {tab === 'Domains' && (
              <SectionCard
                title="Custom domains"
                action={<Link href="/dashboard/domains" className="btn btn-secondary btn-sm">Manage domains</Link>}
              >
                {myDomains.length === 0 ? (
                  <EmptyState
                    icon="domains"
                    title="No custom domains"
                    hint={`This workflow serves on ${a.url}. Bind your own hostname to front it.`}
                    action={<Link href="/dashboard/domains" className="btn btn-primary">Add domain</Link>}
                  />
                ) : (
                  <table className="dtable">
                    <thead><tr><th>Domain</th><th>Verification</th><th>TXT record</th></tr></thead>
                    <tbody>
                      {myDomains.map((d) => (
                        <tr key={d.domain}>
                          <td className="cell-primary">{d.domain}</td>
                          <td><span className={`badge ${d.verified ? 'badge-brand' : 'badge-warn'}`}>{d.verified ? 'Verified' : 'Pending'}</span></td>
                          <td>{d.txt_record ? <Mono>{d.txt_record}</Mono> : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </SectionCard>
            )}

            {/* ── Triggers ────────────────────────────────────────────── */}
            {tab === 'Triggers' && (
              <SectionCard
                title="Cron triggers"
                action={<Link href="/dashboard/crons" className="btn btn-secondary btn-sm">Manage cron jobs</Link>}
              >
                {myCrons.length === 0 ? (
                  <EmptyState
                    icon="crons"
                    title="No triggers"
                    hint="Schedule a recurring request to this workflow on a cron expression."
                    action={<Link href="/dashboard/crons" className="btn btn-primary">Add cron job</Link>}
                  />
                ) : (
                  <table className="dtable">
                    <thead><tr><th>Schedule</th><th>Path</th><th>Status</th><th>Last fired</th></tr></thead>
                    <tbody>
                      {myCrons.map((c) => (
                        <tr key={c.id}>
                          <td><Mono>{c.schedule}</Mono></td>
                          <td><Mono>{c.path}</Mono></td>
                          <td><span className={`badge ${c.enabled ? 'badge-brand' : 'badge-muted'}`}>{c.enabled ? 'Active' : 'Paused'}</span></td>
                          <td>{relativeTime(c.last_fired_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </SectionCard>
            )}
          </>
        )}
      </AsyncBoundary>

      {/* Deploy */}
      <Modal
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
        width={560}
        title={`Deploy ${slug}`}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeployOpen(false)}>Cancel</button>
            <button
              className="btn btn-primary"
              form="deploy-form"
              type="submit"
              disabled={busy === 'deploy' || (deployMode === 'image' ? !image.trim() : !sourceFile)}
            >
              {busy === 'deploy' ? 'Starting build…' : 'Start deployment'}
            </button>
          </>
        }
      >
        <form id="deploy-form" onSubmit={runDeploy} className="space-y-4">
          <div className="seg w-full">
            <button
              type="button"
              className="flex-1"
              data-active={deployMode === 'image'}
              onClick={() => setDeployMode('image')}
            >
              Prebuilt image
            </button>
            <button
              type="button"
              className="flex-1"
              data-active={deployMode === 'source'}
              onClick={() => setDeployMode('source')}
            >
              Source upload
            </button>
          </div>

          {deployMode === 'image' ? (
            <div>
              <label className="label">OCI image reference</label>
              <input
                className="field mono"
                placeholder="registry.example.com/app@sha256:…"
                value={image}
                onChange={(e) => setImage(e.target.value)}
              />
              <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                Digest-pinned references are strongly preferred — a mutable tag makes the deployed bytes
                unreproducible.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="label">Source tarball</label>
                <input
                  className="field"
                  type="file"
                  accept=".tar,.tar.gz,.tgz,application/gzip,application/x-tar"
                  onChange={(e) => setSourceFile(e.target.files?.[0] ?? null)}
                />
                <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                  {sourceFile
                    ? `${sourceFile.name} · ${(sourceFile.size / 1024 / 1024).toFixed(1)} MB`
                    : 'Plan-capped at 100 MB on Free and Hobby, 250 MB on Pro and Scale.'}
                </p>
              </div>
              <label className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
                <input
                  type="checkbox"
                  checked={isDockerfile}
                  onChange={(e) => setIsDockerfile(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  Build from a Dockerfile in the archive
                  <span className="block text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                    Otherwise the builder auto-detects the runtime from the source.
                  </span>
                </span>
              </label>
            </>
          )}

          <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
            Deploying queues a build — it does not complete inline. You&apos;ll be taken to the build log to watch it.
          </p>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete workflow"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                setBusy('delete');
                try {
                  await deleteApp(slug);
                  toast.success('Workflow deleted.');
                  router.replace('/dashboard/workflows');
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : 'Delete failed.');
                  setBusy(null);
                  setConfirmDelete(false);
                }
              }}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
            </button>
          </>
        }
      >
        <p className="text-sm" style={{ color: 'var(--color-ink-soft)' }}>
          This permanently deletes <Mono>{slug}</Mono>, its snapshots and deployment history. This cannot be undone.
        </p>
      </Modal>

      {/* Add secret */}
      <Modal
        open={secretOpen}
        onClose={() => setSecretOpen(false)}
        title="Add secret"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setSecretOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="add-secret" type="submit" disabled={busy === 'secret'}>
              {busy === 'secret' ? 'Saving…' : 'Save secret'}
            </button>
          </>
        }
      >
        <form id="add-secret" onSubmit={saveSecret} className="space-y-4">
          <div>
            <label className="label">Key</label>
            <input
              className="field mono"
              placeholder="DATABASE_URL"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value.toUpperCase())}
              pattern="^[A-Z][A-Z0-9_]*$"
              required
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Uppercase letters, digits and underscores. Must start with a letter.
            </p>
          </div>
          <div>
            <label className="label">Value</label>
            <textarea className="field mono" rows={3} value={secretVal} onChange={(e) => setSecretVal(e.target.value)} required />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Sealed at rest. The plaintext is never shown again after saving.
            </p>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>{k}</dt>
      <dd className="mt-1 font-medium" style={{ color: 'var(--color-ink)' }}>{v}</dd>
    </div>
  );
}

function ConfigRow({ label, hint, control }: { label: string; hint: string; control: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>{hint}</div>
      </div>
      {control}
    </div>
  );
}
