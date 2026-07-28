'use client';

/* ==========================================================================
   Env Vars — the plaintext environment baked into each workflow's manifest.

   These come back on the app record (App.manifest.env) and are set at deploy
   time from the project manifest, not through the REST API — so this view is
   read-only by design. Anything that shouldn't sit in plaintext belongs in
   Secrets, which is writable here.
   ========================================================================== */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { listApps } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, SearchInput, FilterSelect, CopyButton } from '@/components/ui/bits';
import { TableFooter } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';

export default function EnvVarsPage() {
  const apps = useAsync(listApps, []);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');

  const rows = useMemo(() => {
    const out: { slug: string; key: string; value: string }[] = [];
    for (const a of apps.data ?? []) {
      for (const [key, value] of Object.entries(a.manifest?.env ?? {})) {
        out.push({ slug: a.slug, key, value: String(value) });
      }
    }
    return out;
  }, [apps.data]);

  const filtered = rows.filter((r) => {
    if (query && !`${r.key} ${r.value} ${r.slug}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (scope !== 'all' && r.slug !== scope) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Env Vars"
        subtitle="Plaintext environment baked into each workflow at deploy time."
        actions={
          <Link href="/dashboard/secrets" className="btn btn-secondary">
            <Icon name="secrets" size={14} /> Manage secrets
          </Link>
        }
      />

      <div
        className="mb-4 flex items-start gap-3 rounded-lg px-4 py-3"
        style={{ background: 'var(--color-brand-softer)', border: '1px solid var(--color-brand-line)' }}
      >
        <Icon name="help" size={16} style={{ color: 'var(--color-brand-bright)', marginTop: 2 }} />
        <p className="text-sm" style={{ color: 'var(--color-ink-soft)' }}>
          Env vars are declared in your project manifest and applied on deploy, so they&apos;re read-only here. To change
          one, update the manifest and redeploy. For credentials use{' '}
          <Link href="/dashboard/secrets" className="font-medium" style={{ color: 'var(--color-brand)' }}>
            Secrets
          </Link>
          , which are sealed at rest and editable without a redeploy.
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
          state={apps}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={3} rows={4} />}
          empty={
            query || scope !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No env var matches these filters." />
            ) : (
              <EmptyState
                icon="env"
                title="No environment variables"
                hint="None of your workflows declare env vars in their manifest yet."
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
                      <th>Value</th>
                      <th>Workflow</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={`${r.slug}:${r.key}`}>
                        <td className="mono cell-primary">{r.key}</td>
                        <td className="mono max-w-[380px] truncate text-xs" title={r.value}>
                          {r.value}
                        </td>
                        <td>
                          <Link href={`/dashboard/workflows/${r.slug}`} style={{ color: 'var(--color-brand)' }}>{r.slug}</Link>
                        </td>
                        <td className="text-right">
                          <CopyButton value={`${r.key}=${r.value}`} label="Copy" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TableFooter from={1} to={filtered.length} total={filtered.length} noun="env vars" />
            </>
          )}
        </AsyncBoundary>
      </div>
    </div>
  );
}
