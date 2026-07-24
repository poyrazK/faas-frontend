'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { listApps, createApp, AppType, Runtime, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, StatusBadge, Mono } from '@/components/ui/bits';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

const RAM_OPTIONS = [128, 256, 512, 1024, 2048];

export default function AppsPage() {
  const apps = useAsync(listApps, []);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // form
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<AppType>('app');
  const [runtime, setRuntime] = useState<Runtime>('node22');
  const [ram, setRam] = useState(256);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSlug('');
    setType('app');
    setRuntime('node22');
    setRam(256);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createApp({ slug: slug.trim(), type, ram_mb: ram, ...(type === 'function' ? { runtime } : {}) });
      toast.success(`App “${slug.trim()}” created.`);
      setOpen(false);
      reset();
      apps.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create app.');
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = (apps.data ?? []).filter((a) => a.slug.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Apps"
        subtitle="Deploy and manage Firecracker microVM apps and functions."
        actions={<button className="btn btn-primary" onClick={() => setOpen(true)}>+ New app</button>}
      />

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <input
            className="field max-w-xs"
            placeholder="Search apps…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {apps.data && (
            <span className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              {filtered.length} of {apps.data.length}
            </span>
          )}
        </div>

        <AsyncBoundary
          state={apps}
          isEmpty={() => filtered.length === 0}
          empty={
            query ? (
              <EmptyState icon="🔍" title="No matches" hint={`Nothing matches “${query}”.`} />
            ) : (
              <EmptyState
                icon="🚀"
                title="No apps yet"
                hint="Create your first app to get a public HTTPS endpoint that scales to zero."
                action={<button className="btn btn-primary" onClick={() => setOpen(true)}>Create an app</button>}
              />
            )
          }
          skeleton={<SkeletonTable cols={5} rows={4} />}
        >
          {() => (
            <table className="dtable">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Type</th>
                  <th>Memory</th>
                  <th>Concurrency</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/dashboard/apps/${a.slug}`} className="font-semibold" style={{ color: 'var(--color-brand)' }}>
                        {a.slug}
                      </Link>
                    </td>
                    <td><Mono>{a.type}{a.runtime ? ` · ${a.runtime}` : ''}</Mono></td>
                    <td>{a.ram_mb} MB</td>
                    <td>{a.max_concurrency}</td>
                    <td><StatusBadge state={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncBoundary>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create app"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="create-app" type="submit" disabled={submitting || slug.trim().length < 3}>
              {submitting ? 'Creating…' : 'Create app'}
            </button>
          </>
        }
      >
        <form id="create-app" onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Slug</label>
            <input
              className="field"
              placeholder="hello-world"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              pattern="^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$"
              minLength={3}
              maxLength={40}
              required
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Lowercase letters, digits and hyphens. Becomes <Mono>{slug.trim() || 'slug'}.gregale.app</Mono>.
            </p>
          </div>

          <div>
            <label className="label">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(['app', 'function'] as AppType[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setType(t)}
                  className="rounded-lg border px-3 py-2 text-sm font-semibold capitalize"
                  style={{
                    borderColor: type === t ? 'var(--color-brand)' : 'var(--color-line)',
                    background: type === t ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                    color: type === t ? 'var(--color-brand-bright)' : 'var(--color-ink-soft)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {type === 'function' && (
            <div>
              <label className="label">Runtime</label>
              <select className="field" value={runtime} onChange={(e) => setRuntime(e.target.value as Runtime)}>
                <option value="node22">Node.js 22</option>
                <option value="python312">Python 3.12</option>
              </select>
            </div>
          )}

          <div>
            <label className="label">Memory</label>
            <select className="field" value={ram} onChange={(e) => setRam(Number(e.target.value))}>
              {RAM_OPTIONS.map((r) => (
                <option key={r} value={r}>{r} MB</option>
              ))}
            </select>
          </div>
        </form>
      </Modal>
    </div>
  );
}
