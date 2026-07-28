'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { listDomains, createDomain, deleteDomain, listApps, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, SearchInput, FilterSelect, CopyButton, RowMenu, RowMenuItem } from '@/components/ui/bits';
import { TableFooter } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';

export default function DomainsPage() {
  const domains = useAsync(listDomains, []);
  const apps = useAsync(listApps, []);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState('');
  const [appId, setAppId] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  const appSlug = (id: string) => apps.data?.find((a) => a.id === id)?.slug;

  const filtered = (domains.data ?? []).filter((d) => {
    if (query && !`${d.domain} ${appSlug(d.app_id) ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (status === 'verified' && !d.verified) return false;
    if (status === 'pending' && d.verified) return false;
    return true;
  });

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
        title="Domains"
        subtitle="Map your own hostnames to workflows with automatic TLS."
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Icon name="plus" size={14} /> New Domain
          </button>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search domains…" className="w-full max-w-xs" />
          <div className="ml-auto">
            <FilterSelect
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'verified', label: 'Verified' },
                { value: 'pending', label: 'Pending' },
              ]}
            />
          </div>
        </div>

        <AsyncBoundary
          state={domains}
          isEmpty={() => filtered.length === 0}
          skeleton={<SkeletonTable cols={4} rows={3} />}
          empty={
            query || status !== 'all' ? (
              <EmptyState icon="search" title="No matches" hint="No domain matches these filters." />
            ) : (
              <EmptyState
                icon="domains"
                title="No custom domains"
                hint="Bind a hostname like app.example.com and Gregale provisions the certificate for you."
                action={<button className="btn btn-primary" onClick={() => setOpen(true)}>New Domain</button>}
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
                      <th>Domain</th>
                      <th>Workflow</th>
                      <th>Status</th>
                      <th>TXT record</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => {
                      const slug = appSlug(d.app_id);
                      return (
                        <tr key={d.domain}>
                          <td>
                            <a
                              href={`https://${d.domain}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-2 font-medium"
                              style={{ color: 'var(--color-ink)' }}
                            >
                              <Icon name="globe" size={14} style={{ color: 'var(--color-ink-muted)' }} />
                              {d.domain}
                            </a>
                          </td>
                          <td>
                            {slug ? (
                              <Link href={`/dashboard/workflows/${slug}`} style={{ color: 'var(--color-brand)' }}>{slug}</Link>
                            ) : (
                              <Mono>{d.app_id.slice(0, 8)}</Mono>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${d.verified ? 'badge-brand' : 'badge-warn'}`}>
                              {d.verified ? 'Verified' : 'Pending DNS'}
                            </span>
                          </td>
                          <td>
                            {d.txt_record ? (
                              <div className="flex items-center gap-2">
                                <Mono>{d.txt_record.length > 28 ? d.txt_record.slice(0, 28) + '…' : d.txt_record}</Mono>
                                <CopyButton value={d.txt_record} label="Copy" />
                              </div>
                            ) : (
                              <span style={{ color: 'var(--color-ink-muted)' }}>—</span>
                            )}
                          </td>
                          <td>
                            <RowMenu>
                              {slug && <RowMenuItem onClick={() => location.assign(`/dashboard/workflows/${slug}`)}>Open workflow</RowMenuItem>}
                              <RowMenuItem
                                danger
                                onClick={async () => {
                                  if (!confirm(`Remove ${d.domain}?`)) return;
                                  try {
                                    await deleteDomain(d.domain);
                                    toast.success(`${d.domain} removed.`);
                                    domains.reload();
                                  } catch (err) {
                                    toast.error(err instanceof ApiError ? err.message : 'Remove failed.');
                                  }
                                }}
                              >
                                Remove domain
                              </RowMenuItem>
                            </RowMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TableFooter from={1} to={filtered.length} total={filtered.length} noun="domains" />
            </>
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
            <label className="label">Workflow</label>
            <select className="field" value={appId} onChange={(e) => setAppId(e.target.value)} required>
              <option value="">Select a workflow…</option>
              {(apps.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.slug}</option>
              ))}
            </select>
            {apps.data && apps.data.length === 0 && (
              <p className="mt-1 text-xs" style={{ color: 'var(--color-warn)' }}>Create a workflow first.</p>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
            After binding, add the returned TXT record at your DNS provider. Verification and certificate issuance
            happen automatically once the record propagates.
          </p>
        </form>
      </Modal>
    </div>
  );
}
