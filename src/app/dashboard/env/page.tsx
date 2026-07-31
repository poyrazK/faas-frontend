'use client';

/* ==========================================================================
   Env Vars — now writable through /v1/apps/{slug}/env (#395).

   Two things this page has to keep straight:

   • Values are plaintext by contract. The list response returns key names and
     timestamps only, so an existing value cannot be displayed — editing one
     means replacing it, exactly like a secret, even though it isn't sealed.
   • Env vars are NOT secrets. The banner points anything credential-shaped at
     the Secrets page, which is sealed at rest.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { listApps, listEnv, setEnv, deleteEnv, type AppEnvList, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, SearchInput, FilterSelect, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { TableFooter } from '@/components/ui/Panels';
import { usePage } from '@/lib/usePaged';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

interface Row {
  slug: string;
  key: string;
  created_at: string;
  updated_at: string;
}

/**
 * The env API is per-app with no account-wide variant, so this still fans out.
 * Unlike the old Workers/Secrets fan-out the failure mode is kept visible:
 * a workflow whose env could not be read is named rather than silently empty.
 */
async function loadEnv(): Promise<{ rows: Row[]; quota: Map<string, AppEnvList>; failed: string[] }> {
  const apps = await listApps();
  const failed: string[] = [];
  const quota = new Map<string, AppEnvList>();

  const results = await Promise.all(
    apps.map(async (a) => {
      try {
        const res = await listEnv(a.slug);
        quota.set(a.slug, res);
        return res.env.map((e) => ({ slug: a.slug, key: e.key, created_at: e.created_at, updated_at: e.updated_at }));
      } catch {
        failed.push(a.slug);
        return [];
      }
    }),
  );

  return { rows: results.flat(), quota, failed };
}

export default function EnvVarsPage() {
  const data = useAsync(loadEnv, []);
  const apps = useAsync(listApps, []);
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [open, setOpen] = useState(false);
  const [formSlug, setFormSlug] = useState('');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => data.data?.rows ?? [], [data.data]);

  const filtered = rows.filter((r) => {
    if (query && !`${r.key} ${r.slug}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (scope !== 'all' && r.slug !== scope) return false;
    return true;
  });

  function openCreate() {
    setFormSlug('');
    setKey('');
    setValue('');
    setEditing(false);
    setOpen(true);
  }

  function openEdit(r: Row) {
    setFormSlug(r.slug);
    setKey(r.key);
    setValue('');
    setEditing(true);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await setEnv(formSlug, key.trim(), value);
      toast.success(`${key.trim()} saved to ${formSlug}.`);
      setOpen(false);
      data.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the variable.');
    } finally {
      setBusy(false);
    }
  }

  const pg = usePage(filtered, 15);

  return (
    <div>
      <PageHeader
        title="Env Vars"
        subtitle="Plaintext configuration injected into your microVMs."
        actions={
          <button className="btn btn-primary" onClick={openCreate} disabled={!apps.data?.length}>
            <Icon name="plus" size={14} /> New Variable
          </button>
        }
      />

      <div
        className="mb-4 flex items-start gap-3 rounded-lg px-4 py-3"
        style={{ background: 'var(--color-brand-softer)', border: '1px solid var(--color-brand-line)' }}
      >
        <Icon name="help" size={16} style={{ color: 'var(--color-brand-bright)', marginTop: 2, flex: 'none' }} />
        <p className="text-sm" style={{ color: 'var(--color-ink-soft)' }}>
          Env vars are stored as plaintext by contract and are meant for non-sensitive configuration. For API tokens,
          connection strings and anything else credential-shaped use{' '}
          <Link href="/dashboard/secrets" className="font-medium" style={{ color: 'var(--color-brand)' }}>
            Secrets
          </Link>
          , which are sealed at rest. Values are never returned by the API, so changing one means replacing it.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search env vars…" className="w-full max-w-xs" />
          <div className="ml-auto">
            <FilterSelect
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'All Workflows' },
                ...(apps.data ?? []).map((a) => ({ value: a.slug, label: a.slug })),
              ]}
            />
          </div>
        </div>

        <AsyncBoundary
          state={data}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={4} rows={4} />}
          empty={
            query || scope !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No variable matches these filters." />
            ) : (
              <EmptyState
                icon="env"
                title="No environment variables"
                hint="Set configuration your workflows read from the environment at boot."
                action={
                  <button className="btn btn-primary" onClick={openCreate} disabled={!apps.data?.length}>
                    New Variable
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
                      <th>Key</th>
                      <th>Workflow</th>
                      <th>Value</th>
                      <th>Created</th>
                      <th>Updated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pg.items.map((r) => (
                      <tr key={`${r.slug}:${r.key}`}>
                        <td className="mono cell-primary">{r.key}</td>
                        <td>
                          <Link href={`/dashboard/workflows/${r.slug}`} style={{ color: 'var(--color-brand)' }}>
                            {r.slug}
                          </Link>
                        </td>
                        <td>
                          <span className="badge badge-muted" title="The API never returns stored values">
                            not returned
                          </span>
                        </td>
                        <td>{relativeTime(r.created_at)}</td>
                        <td>{relativeTime(r.updated_at)}</td>
                        <td>
                          <RowMenu>
                            <RowMenuItem onClick={() => openEdit(r)}>Replace value</RowMenuItem>
                            <RowMenuItem
                              danger
                              onClick={async () => {
                                if (!confirm(`Delete ${r.key} from ${r.slug}?`)) return;
                                try {
                                  await deleteEnv(r.slug, r.key);
                                  toast.success(`${r.key} deleted.`);
                                  data.reload();
                                } catch (err) {
                                  toast.error(err instanceof ApiError ? err.message : 'Delete failed.');
                                }
                              }}
                            >
                              Delete variable
                            </RowMenuItem>
                          </RowMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TableFooter
                from={pg.from}
                to={pg.to}
                total={pg.total}
                noun="env vars"
                page={pg.page}
                pageCount={pg.pageCount}
                onPage={pg.setPage}
              />
            </>
          )}
        </AsyncBoundary>
      </div>

      {data.data && data.data.failed.length > 0 && (
        <p className="mt-3 text-xs" style={{ color: 'var(--color-warn)' }}>
          Could not read env vars for: {data.data.failed.join(', ')}.
        </p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Replace ${key}` : 'New environment variable'}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="set-env" type="submit" disabled={busy || !formSlug}>
              {busy ? 'Saving…' : editing ? 'Replace value' : 'Save variable'}
            </button>
          </>
        }
      >
        <form id="set-env" onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Workflow</label>
            <select
              className="field"
              value={formSlug}
              onChange={(e) => setFormSlug(e.target.value)}
              required
              disabled={editing}
            >
              <option value="">Select a workflow…</option>
              {(apps.data ?? []).map((a) => {
                const q = data.data?.quota.get(a.slug);
                return (
                  <option key={a.id} value={a.slug}>
                    {a.slug}
                    {q ? ` (${q.count}/${q.quota_max})` : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="label">Key</label>
            <input
              className="field mono"
              placeholder="LOG_LEVEL"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              pattern="^[A-Z][A-Z0-9_]*$"
              maxLength={128}
              required
              disabled={editing}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Uppercase letters, digits and underscores. Must start with a letter.
            </p>
          </div>
          <div>
            <label className="label">Value</label>
            <textarea className="field mono" rows={3} value={value} onChange={(e) => setValue(e.target.value)} required />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Stored verbatim as plaintext. Don&apos;t put credentials here — use a sealed secret instead.
            </p>
          </div>
        </form>
      </Modal>
    </div>
  );
}
