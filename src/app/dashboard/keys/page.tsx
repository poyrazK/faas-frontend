'use client';

import React, { useState } from 'react';
import { listKeys, createKey, deleteKey, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, CopyButton, SearchInput, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { TableFooter } from '@/components/ui/Panels';
import { usePage } from '@/lib/usePaged';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

export default function KeysPage() {
  const keys = useAsync(listKeys, []);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filtered = (keys.data ?? []).filter((k) =>
    query ? `${k.label ?? ''} ${k.prefix}`.toLowerCase().includes(query.toLowerCase()) : true,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await createKey(label.trim());
      setRevealed(created.plaintext ?? null);
      setLabel('');
      keys.reload();
      if (!created.plaintext) toast.info('Key created.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create key.');
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    setOpen(false);
    setRevealed(null);
    setLabel('');
  }

  const pg = usePage(filtered, 15);

  return (
    <div>
      <PageHeader
        title="API Keys"
        subtitle="Bearer tokens for the CLI and CI. The plaintext is shown once."
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Icon name="plus" size={14} /> New API Key
          </button>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search keys…" className="w-full max-w-xs" />
        </div>

        <AsyncBoundary
          state={keys}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={4} rows={3} />}
          empty={
            query ? (
              <EmptyState icon="search" title="No matches" hint={`Nothing matches “${query}”.`} />
            ) : (
              <EmptyState
                icon="keys"
                title="No API keys"
                hint="Mint a key to deploy from the CLI or a CI pipeline."
                action={<button className="btn btn-primary" onClick={() => setOpen(true)}>New API Key</button>}
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
                      <th>Label</th>
                      <th>Key</th>
                      <th>Created</th>
                      <th>Last used</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pg.items.map((k) => (
                      <tr key={k.id}>
                        <td className="cell-primary">
                          {k.label || <span style={{ color: 'var(--color-ink-muted)' }}>untitled</span>}
                        </td>
                        <td><Mono>{k.prefix}…</Mono></td>
                        <td>{relativeTime(k.created_at)}</td>
                        <td>
                          {k.last_used_at ? (
                            relativeTime(k.last_used_at)
                          ) : (
                            <span className="badge badge-muted">never used</span>
                          )}
                        </td>
                        <td>
                          <RowMenu>
                            <RowMenuItem
                              danger
                              onClick={async () => {
                                if (!confirm(`Revoke ${k.label || k.prefix}? Anything using it stops working immediately.`)) return;
                                try {
                                  await deleteKey(k.id);
                                  toast.success('Key revoked.');
                                  keys.reload();
                                } catch (err) {
                                  toast.error(err instanceof ApiError ? err.message : 'Revoke failed.');
                                }
                              }}
                            >
                              Revoke key
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
                noun="API keys"
                page={pg.page}
                pageCount={pg.pageCount}
                onPage={pg.setPage}
              />
            </>
          )}
        </AsyncBoundary>
      </div>

      <Modal
        open={open}
        onClose={closeModal}
        title={revealed ? 'Copy your API key' : 'Create API key'}
        footer={
          revealed ? (
            <button className="btn btn-primary" onClick={closeModal}>Done</button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" form="add-key" type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create key'}
              </button>
            </>
          )
        }
      >
        {revealed ? (
          <div className="space-y-3">
            <div className="rounded-lg p-3" style={{ background: '#fdf6e7', border: '1px solid #f2e2bd' }}>
              <p className="text-xs font-semibold" style={{ color: '#a1650b' }}>
                Copy this now — it will never be shown again.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code
                className="mono flex-1 break-all rounded-lg p-3 text-sm"
                style={{ background: 'var(--color-surface-subtle)', border: '1px solid var(--color-line)' }}
              >
                {revealed}
              </code>
              <CopyButton value={revealed} />
            </div>
          </div>
        ) : (
          <form id="add-key" onSubmit={submit}>
            <label className="label">Label</label>
            <input
              className="field"
              placeholder="ci-deploy"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={100}
              required
              autoFocus
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              Name it after where it runs, so you know what breaks when you revoke it.
            </p>
          </form>
        )}
      </Modal>
    </div>
  );
}
