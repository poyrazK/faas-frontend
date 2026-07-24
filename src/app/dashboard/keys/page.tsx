'use client';

import React, { useState } from 'react';
import { listKeys, createKey, deleteKey, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, CopyButton } from '@/components/ui/bits';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { relativeTime } from '@/lib/format';

export default function KeysPage() {
  const keys = useAsync(listKeys, []);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

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

  return (
    <div>
      <PageHeader
        title="API keys"
        subtitle="Bearer tokens for the CLI and CI/CD. The plaintext is shown once."
        actions={<button className="btn btn-primary" onClick={() => setOpen(true)}>+ New key</button>}
      />

      <div className="card overflow-hidden">
        <AsyncBoundary
          state={keys}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState icon="🔑" title="No API keys" hint="Mint a key to deploy from the CLI or CI." action={<button className="btn btn-primary" onClick={() => setOpen(true)}>New key</button>} />}
          skeleton={<SkeletonTable cols={3} rows={3} />}
        >
          {(list) => (
            <table className="dtable">
              <thead>
                <tr><th>Label</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th></tr>
              </thead>
              <tbody>
                {list.map((k) => (
                  <tr key={k.id}>
                    <td className="font-semibold">{k.label || <span style={{ color: 'var(--color-ink-muted)' }}>untitled</span>}</td>
                    <td><Mono>{k.prefix}…</Mono></td>
                    <td>{relativeTime(k.created_at)}</td>
                    <td>{relativeTime(k.last_used_at)}</td>
                    <td className="text-right">
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-danger)' }}
                        onClick={async () => {
                          try {
                            await deleteKey(k.id);
                            toast.success('Key revoked.');
                            keys.reload();
                          } catch (err) {
                            toast.error(err instanceof ApiError ? err.message : 'Revoke failed.');
                          }
                        }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <div className="rounded-lg p-3" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
              <p className="text-xs font-semibold" style={{ color: '#b45309' }}>
                Copy this now — it will never be shown again.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="mono flex-1 break-all rounded-lg p-3 text-sm" style={{ background: 'var(--color-surface-subtle)', border: '1px solid var(--color-line)' }}>
                {revealed}
              </code>
              <CopyButton value={revealed} />
            </div>
          </div>
        ) : (
          <form id="add-key" onSubmit={submit}>
            <label className="label">Label</label>
            <input className="field" placeholder="ci-deploy" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} required />
          </form>
        )}
      </Modal>
    </div>
  );
}
