'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getApp, listInstances, listSecrets, setSecret, deleteSecret,
  wakeApp, parkApp, deleteApp, rollbackApp, updateApp, ApiError,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono, CopyButton } from '@/components/ui/bits';
import { AsyncBoundary, EmptyState, SkeletonTable, Spinner } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { relativeTime } from '@/lib/format';

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-line)' }}>
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function AppDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const toast = useToast();

  const app = useAsync(() => getApp(slug), [slug]);
  const instances = useAsync(() => listInstances(slug), [slug]);
  const secrets = useAsync(() => listSecrets(slug), [slug]);

  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [secretOpen, setSecretOpen] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [secretVal, setSecretVal] = useState('');

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
      <div className="mb-4">
        <Link href="/dashboard/apps" className="text-sm font-semibold" style={{ color: 'var(--color-ink-muted)' }}>← Apps</Link>
      </div>

      <AsyncBoundary state={app} skeleton={<SkeletonTable cols={2} rows={3} />}>
        {(a) => (
          <>
            <PageHeader
              title={a.slug}
              subtitle={a.type === 'function' ? `Function · ${a.runtime}` : 'App'}
              actions={
                <>
                  <button className="btn btn-secondary" disabled={!!busy} onClick={() => act('wake', () => wakeApp(slug), 'Wake requested.')}>
                    {busy === 'wake' ? <Spinner size={14} /> : null} Wake
                  </button>
                  <button className="btn btn-secondary" disabled={!!busy} onClick={() => act('park', () => parkApp(slug), 'App parked to disk.')}>
                    {busy === 'park' ? <Spinner size={14} /> : null} Park
                  </button>
                  <button className="btn btn-secondary" disabled={!!busy} onClick={() => act('rollback', () => rollbackApp(slug), 'Rolled back to previous deployment.')}>
                    Rollback
                  </button>
                  <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
                </>
              }
            />

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Left column: config + endpoint */}
              <div className="space-y-6 lg:col-span-2">
                <Section title="Endpoint">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <a href={a.url} target="_blank" rel="noreferrer" className="mono text-sm font-semibold" style={{ color: 'var(--color-brand)' }}>
                      {a.url}
                    </a>
                    <div className="flex items-center gap-2">
                      <StatusBadge state={a.status} />
                      <CopyButton value={a.url} label="Copy URL" />
                    </div>
                  </div>
                </Section>

                <Section title="Configuration">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5 text-sm sm:grid-cols-4">
                    {[
                      ['Memory', `${a.ram_mb} MB`],
                      ['Max concurrency', String(a.max_concurrency)],
                      ['Min instances', String(a.min_instances)],
                      ['Idle timeout', a.idle_timeout_s != null ? `${a.idle_timeout_s}s` : 'default'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-muted)' }}>{k}</dt>
                        <dd className="mt-1 font-semibold">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="flex gap-2 px-5 pb-5">
                    <ScaleButton label="Set min instances 1" onClick={() => act('scale', () => updateApp(slug, { min_instances: 1 }), 'Keeping one warm instance.')} disabled={!!busy} />
                    <ScaleButton label="Scale to zero" onClick={() => act('scale', () => updateApp(slug, { min_instances: 0 }), 'App will scale to zero when idle.')} disabled={!!busy} />
                  </div>
                </Section>

                <Section title="Live instances" action={<button className="btn btn-ghost btn-sm" onClick={() => instances.reload()}>Refresh</button>}>
                  <AsyncBoundary
                    state={instances}
                    isEmpty={(d) => d.length === 0}
                    empty={<EmptyState icon="💤" title="No live instances" hint="This app is parked. It will cold-wake on the next request." />}
                    skeleton={<SkeletonTable cols={3} rows={2} />}
                  >
                    {(list) => (
                      <table className="dtable">
                        <thead>
                          <tr><th>Instance</th><th>State</th><th>Memory</th><th>Last request</th></tr>
                        </thead>
                        <tbody>
                          {list.map((i) => (
                            <tr key={i.id}>
                              <td><Mono>{i.id.slice(0, 12)}</Mono></td>
                              <td><StatusBadge state={i.state} /></td>
                              <td>{i.ram_mb} MB</td>
                              <td>{relativeTime(i.last_request_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </AsyncBoundary>
                </Section>
              </div>

              {/* Right column: secrets */}
              <div className="space-y-6">
                <Section title="Secrets" action={<button className="btn btn-primary btn-sm" onClick={() => setSecretOpen(true)}>+ Add</button>}>
                  <AsyncBoundary
                    state={secrets}
                    isEmpty={(d) => d.secrets.length === 0}
                    empty={<EmptyState icon="🔐" title="No secrets" hint="Sealed env vars injected into the guest at boot." />}
                    skeleton={<SkeletonTable cols={2} rows={3} />}
                  >
                    {(data) => (
                      <ul className="divide-y" style={{ borderColor: 'var(--color-line)' }}>
                        {data.secrets.map((s) => (
                          <li key={s.key} className="flex items-center justify-between px-5 py-3">
                            <div>
                              <div className="mono text-sm font-semibold">{s.key}</div>
                              <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>sealed · {relativeTime(s.updated_at)}</div>
                            </div>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--color-danger)' }}
                              onClick={() =>
                                act('secret-del', () => deleteSecret(slug, s.key), `Secret ${s.key} deleted.`).then(() => secrets.reload())
                              }
                            >
                              Delete
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </AsyncBoundary>
                </Section>
              </div>
            </div>
          </>
        )}
      </AsyncBoundary>

      {/* Delete confirmation */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete app"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                setBusy('delete');
                try {
                  await deleteApp(slug);
                  toast.success('App deleted.');
                  router.replace('/dashboard/apps');
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
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>Uppercase letters, digits, underscore. Must start with a letter.</p>
          </div>
          <div>
            <label className="label">Value</label>
            <textarea className="field mono" rows={3} value={secretVal} onChange={(e) => setSecretVal(e.target.value)} required />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>Sealed at rest. The plaintext is never shown again after saving.</p>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function ScaleButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button className="btn btn-secondary btn-sm" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
