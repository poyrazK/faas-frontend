'use client';

import React, { useState } from 'react';
import { listDomains, createDomain, deleteDomain, listApps, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono } from '@/components/ui/bits';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export default function DomainsPage() {
  const domains = useAsync(listDomains, []);
  const apps = useAsync(listApps, []);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState('');
  const [appId, setAppId] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createDomain(domain.trim(), appId);
      toast.success(`${domain.trim()} bound. Add the TXT record to verify.`);
      setOpen(false);
      setDomain('');
      domains.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not bind domain.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Custom domains"
        subtitle="Map your own domains to apps with automatic TLS."
        actions={<button className="btn btn-primary" onClick={() => setOpen(true)}>+ Add domain</button>}
      />

      <div className="card overflow-hidden">
        <AsyncBoundary
          state={domains}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState icon="🌐" title="No custom domains" hint="Bind a domain like app.example.com and we'll provision a Let's Encrypt certificate." action={<button className="btn btn-primary" onClick={() => setOpen(true)}>Add domain</button>} />}
          skeleton={<SkeletonTable cols={3} rows={3} />}
        >
          {(list) => (
            <table className="dtable">
              <thead>
                <tr><th>Domain</th><th>Verification</th><th>TXT record</th><th></th></tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.domain}>
                    <td className="font-semibold">{d.domain}</td>
                    <td>
                      <span className={`badge ${d.verified ? 'badge-brand' : 'badge-warn'}`}>
                        {d.verified ? 'Verified' : 'Pending'}
                      </span>
                    </td>
                    <td>{d.txt_record ? <Mono>{d.txt_record}</Mono> : <span style={{ color: 'var(--color-ink-muted)' }}>—</span>}</td>
                    <td className="text-right">
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-danger)' }}
                        onClick={async () => {
                          try {
                            await deleteDomain(d.domain);
                            toast.success(`${d.domain} removed.`);
                            domains.reload();
                          } catch (err) {
                            toast.error(err instanceof ApiError ? err.message : 'Remove failed.');
                          }
                        }}
                      >
                        Remove
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
        onClose={() => setOpen(false)}
        title="Add custom domain"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" form="add-domain" type="submit" disabled={busy || !appId}>
              {busy ? 'Binding…' : 'Bind domain'}
            </button>
          </>
        }
      >
        <form id="add-domain" onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Domain</label>
            <input className="field" placeholder="app.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} required />
          </div>
          <div>
            <label className="label">Target app</label>
            <select className="field" value={appId} onChange={(e) => setAppId(e.target.value)} required>
              <option value="">Select an app…</option>
              {(apps.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.slug}</option>
              ))}
            </select>
            {apps.data && apps.data.length === 0 && (
              <p className="mt-1 text-xs" style={{ color: 'var(--color-warn)' }}>Create an app first.</p>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
