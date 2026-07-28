'use client';

/* ==========================================================================
   Secrets — account-wide view over the per-app secret stores.

   The API is scoped per workflow (/v1/apps/{slug}/secrets), so this fans out
   and flattens. Values are sealed server-side and never returned, so there is
   deliberately no "reveal" affordance here: only set, replace and delete.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { listApps, listSecrets, setSecret, deleteSecret, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, SearchInput, FilterSelect, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { TableFooter } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

interface Row {
  key: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

async function loadSecrets(): Promise<{ rows: Row[]; quota: Map<string, { count: number; max: number }>; failed: string[] }> {
  const apps = await listApps();
  const failed: string[] = [];
  const quota = new Map<string, { count: number; max: number }>();

  const results = await Promise.all(
    apps.map(async (a) => {
      try {
        const res = await listSecrets(a.slug);
        quota.set(a.slug, { count: res.count, max: res.quota_max });
        return res.secrets.map((s) => ({ key: s.key, slug: a.slug, created_at: s.created_at, updated_at: s.updated_at }));
      } catch {
        failed.push(a.slug);
        return [];
      }
    }),
  );

  return { rows: results.flat(), quota, failed };
}

export default function SecretsPage() {
  const data = useAsync(loadSecrets, []);
  const apps = useAsync(listApps, []);
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [open, setOpen] = useState(false);
  const [formSlug, setFormSlug] = useState('');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => data.data?.rows ?? [], [data.data]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (query && !`${r.key} ${r.slug}`.toLowerCase().includes(query.toLowerCase())) return false;
        if (scope !== 'all' && r.slug !== scope) return false;
        return true;
      }),
    [rows, query, scope],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await setSecret(formSlug, key.trim(), value);
      toast.success(`Secret ${key.trim()} saved to ${formSlug}.`);
      setOpen(false);
      setKey('');
      setValue('');
      data.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save secret.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Secrets"
        subtitle="Sealed values injected into your microVMs at boot."
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={!apps.data?.length}>
            <Icon name="plus" size={14} /> New Secret
          </button>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search secrets…" className="w-full max-w-xs" />
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
              <EmptyState icon="search" title="No matches" hint="No secret matches these filters." />
            ) : (
              <EmptyState
                icon="secrets"
                title="No secrets"
                hint="Store API tokens and connection strings here. They're sealed at rest and injected into the guest environment."
                action={
                  <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={!apps.data?.length}>
                    New Secret
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
                    {filtered.map((r) => (
                      <tr key={`${r.slug}:${r.key}`}>
                        <td className="mono cell-primary">{r.key}</td>
                        <td>
                          <Link href={`/dashboard/workflows/${r.slug}`} style={{ color: 'var(--color-brand)' }}>{r.slug}</Link>
                        </td>
                        <td>
                          <span className="badge badge-muted">
                            <Icon name="secrets" size={11} /> sealed
                          </span>
                        </td>
                        <td>{relativeTime(r.created_at)}</td>
                        <td>{relativeTime(r.updated_at)}</td>
                        <td>
                          <RowMenu>
                            <RowMenuItem
                              onClick={() => {
                                setFormSlug(r.slug);
                                setKey(r.key);
                                setValue('');
                                setOpen(true);
                              }}
                            >
                              Replace value
                            </RowMenuItem>
                            <RowMenuItem
                              danger
                              onClick={async () => {
                                if (!confirm(`Delete ${r.key} from ${r.slug}?`)) return;
                                try {
                                  await deleteSecret(r.slug, r.key);
                                  toast.success(`${r.key} deleted.`);
                                  data.reload();
                                } catch (err) {
                                  toast.error(err instanceof ApiError ? err.message : 'Delete failed.');
                                }
                              }}
                            >
                              Delete secret
                            </RowMenuItem>
                          </RowMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TableFooter from={1} to={filtered.length} total={filtered.length} noun="secrets" />
            </>
          )}
        </AsyncBoundary>
      </div>

      {data.data && data.data.failed.length > 0 && (
        <p className="mt-3 text-xs" style={{ color: 'var(--color-warn)' }}>
          Could not read secrets for: {data.data.failed.join(', ')}.
        </p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={key ? `Set ${key}` : 'New secret'}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="add-secret" type="submit" disabled={busy || !formSlug}>
              {busy ? 'Saving…' : 'Save secret'}
            </button>
          </>
        }
      >
        <form id="add-secret" onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Workflow</label>
            <select className="field" value={formSlug} onChange={(e) => setFormSlug(e.target.value)} required>
              <option value="">Select a workflow…</option>
              {(apps.data ?? []).map((a) => {
                const q = data.data?.quota.get(a.slug);
                return (
                  <option key={a.id} value={a.slug}>
                    {a.slug}
                    {q ? ` (${q.count}/${q.max})` : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="label">Key</label>
            <input
              className="field mono"
              placeholder="DATABASE_URL"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              pattern="^[A-Z][A-Z0-9_]*$"
              required
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Uppercase letters, digits and underscores. Must start with a letter.
            </p>
          </div>
          <div>
            <label className="label">Value</label>
            <textarea className="field mono" rows={3} value={value} onChange={(e) => setValue(e.target.value)} required />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Sealed server-side immediately. The plaintext is never returned — replacing is the only way to change it.
            </p>
          </div>
        </form>
      </Modal>
    </div>
  );
}
