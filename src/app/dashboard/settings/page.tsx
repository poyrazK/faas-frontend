'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  exportAccount, deleteAccount, restoreAccount, listAuditEvents,
  listSessions, revokeSession, revokeAllSessions,
  listApps, listInstallRepos, bindAppInstall, ApiError,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono, CopyButton } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState, SkeletonTable, Spinner } from '@/components/ui/States';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { PLANS, relativeTime } from '@/lib/format';

const KIND_LABEL: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'key.created': 'API key created',
  'key.deleted': 'API key revoked',
  'secret.set': 'Secret set',
  'secret.deleted': 'Secret deleted',
  'account.plan_changed': 'Plan changed',
  'account.deletion_scheduled': 'Account deletion staged',
  'account.deletion_restored': 'Account restored',
};

export default function SettingsPage() {
  const { account, refresh, signOut } = useAuth();
  const events = useAsync(() => listAuditEvents(25), []);
  const sessions = useAsync(listSessions, []);
  const toast = useToast();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!account) return null;
  const pending = account.status === 'deleted_pending';
  const plan = PLANS[account.plan];

  async function doExport() {
    setBusy('export');
    try {
      const data = await exportAccount();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gregale-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Account data exported.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account details, data export, and account lifecycle." />

      {pending && (
        <div
          className="mb-4 flex items-start gap-3 rounded-lg px-4 py-3"
          style={{ background: '#fdf6e7', border: '1px solid #f2e2bd' }}
        >
          <Icon name="alerts" size={16} style={{ color: '#a1650b', marginTop: 2 }} />
          <p className="text-sm" style={{ color: '#7c4f08' }}>
            This account is scheduled for deletion and will be purged after the 30-day grace period. Restore it below
            to cancel.
          </p>
        </div>
      )}

      <SectionCard title="Account">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5 text-sm sm:grid-cols-4">
          <Field k="Email" v={account.email} />
          <Field k="Plan" v={<Link href="/dashboard/plans" style={{ color: 'var(--color-brand)' }}>{plan.label}</Link>} />
          <Field k="Status" v={<span className={`badge ${pending ? 'badge-warn' : 'badge-brand'}`}>{account.status}</span>} />
          <Field k="Workflows" v={`${account.app_count} of ${account.limits.deployed_apps}`} />
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>Account ID</dt>
            <dd className="mt-1 flex items-center gap-2">
              <Mono>{account.id}</Mono>
              <CopyButton value={account.id} label="Copy" />
            </dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard className="mt-4" title="Connected sources">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: 'var(--color-surface-subtle)' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--color-ink)' }}>
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.72-4.04-1.6-4.04-1.6-.55-1.39-1.34-1.76-1.34-1.76-1.08-.75.08-.73.08-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.8 1.3 3.49.99.1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.3-1.55 3.3-1.23 3.3-1.23.64 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </span>
            <div>
              <div className="text-sm font-medium">GitHub</div>
              <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                {account.github_install_id
                  ? `App installed · installation ${account.github_install_id}`
                  : 'Not connected — deploy from the CLI or the console instead'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge ${account.github_install_id ? 'badge-brand' : 'badge-muted'}`}>
              {account.github_install_id ? 'Connected' : 'Not connected'}
            </span>
            {account.github_install_id ? (
              <button className="btn btn-secondary btn-sm" onClick={() => setBindOpen(true)}>
                <Icon name="deployments" size={13} /> Bind a repo
              </button>
            ) : (
              <a href="/v1/auth/github" className="btn btn-secondary btn-sm">
                <Icon name="external" size={13} /> Connect
              </a>
            )}
          </div>
        </div>

        {account.github_install_id && (
          <div className="px-5 pb-5">
            <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
              Binding a repository to a workflow lets pushes on the production branch trigger a deployment.
            </p>
          </div>
        )}
      </SectionCard>

      {/* The account carries the installation id as a string; the install
          endpoints take it as an int64. */}
      <BindRepoModal
        open={bindOpen}
        onClose={() => setBindOpen(false)}
        installationId={account.github_install_id ? Number(account.github_install_id) : null}
      />

      <SectionCard
        className="mt-4"
        title="Active sessions"
        action={
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy === 'revoke-all'}
            onClick={async () => {
              if (!confirm('Sign out of every device? This ends this session too, so you will be signed out here.')) return;
              setBusy('revoke-all');
              try {
                await revokeAllSessions();
                toast.success('All sessions revoked.');
                // revoke_all includes the caller's own session, so the cookie
                // is dead — go to login rather than leaving a broken console.
                await signOut();
                router.replace('/login');
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : 'Revoke failed.');
                setBusy(null);
              }
            }}
          >
            {busy === 'revoke-all' ? 'Revoking…' : 'Sign out everywhere'}
          </button>
        }
      >
        <AsyncBoundary
          state={sessions}
          isEmpty={(d) => d.sessions.length === 0}
          skeleton={<SkeletonTable cols={4} rows={3} />}
          empty={<EmptyState icon="user" title="No active sessions" />}
        >
          {(d) => (
            <table className="dtable">
              <thead>
                <tr><th>Device</th><th>IP address</th><th>Signed in</th><th>Last seen</th><th /></tr>
              </thead>
              <tbody>
                {d.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-primary">
                      <div className="max-w-[320px] truncate" title={s.issued_ua || undefined}>
                        {s.issued_ua || 'Unknown device'}
                      </div>
                      {s.current_session && <span className="badge badge-brand mt-1">This device</span>}
                    </td>
                    <td><Mono>{s.issued_ip || '—'}</Mono></td>
                    <td>{relativeTime(s.issued_at)}</td>
                    <td>{relativeTime(s.last_seen_at)}</td>
                    <td className="text-right">
                      {!s.current_session && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--color-danger)' }}
                          onClick={async () => {
                            try {
                              await revokeSession(s.id);
                              toast.success('Session revoked.');
                              sessions.reload();
                            } catch (err) {
                              toast.error(err instanceof ApiError ? err.message : 'Revoke failed.');
                            }
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncBoundary>
      </SectionCard>

      <SectionCard className="mt-4" title="Recent account activity">
        <AsyncBoundary
          state={events}
          isEmpty={(d) => d.events.length === 0}
          skeleton={<SkeletonTable cols={3} rows={4} />}
          empty={<EmptyState icon="bell" title="No activity recorded" />}
        >
          {(d) => (
            <table className="dtable">
              <thead><tr><th>Event</th><th>Actor</th><th>When</th></tr></thead>
              <tbody>
                {d.events.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-primary">{KIND_LABEL[e.kind] ?? e.kind}</td>
                    <td>{e.actor}</td>
                    <td>{relativeTime(e.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncBoundary>
      </SectionCard>

      <SectionCard className="mt-4" title="Data export (GDPR)">
        <div className="px-5 py-5">
          <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            Download everything held about your account — workflows, deployments, usage, domains, cron jobs, keys, and
            sealed secret envelopes.
          </p>
          <button className="btn btn-secondary mt-4" onClick={doExport} disabled={busy === 'export'}>
            <Icon name="deployments" size={14} style={{ transform: 'rotate(180deg)' }} />
            {busy === 'export' ? 'Preparing…' : 'Export account data'}
          </button>
        </div>
      </SectionCard>

      <div className="card mt-4 p-5" style={{ borderColor: '#f3d3d3' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-danger)' }}>Danger zone</h2>
        {pending ? (
          <>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
              Your account is scheduled for deletion with a 30-day grace period. You can restore it any time before then.
            </p>
            <button
              className="btn btn-primary mt-4"
              onClick={async () => {
                setBusy('restore');
                try {
                  await restoreAccount();
                  await refresh();
                  toast.success('Account restored.');
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : 'Restore failed.');
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === 'restore' ? 'Restoring…' : 'Restore account'}
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
              Staging deletion moves your account to <Mono>deleted_pending</Mono> for 30 days, after which everything is
              permanently purged.
            </p>
            <button className="btn btn-danger mt-4" onClick={() => setConfirmDelete(true)}>
              Stage account deletion
            </button>
          </>
        )}
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Stage account deletion"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                setBusy('delete');
                try {
                  await deleteAccount();
                  toast.success('Account staged for deletion.');
                  setConfirmDelete(false);
                  await signOut();
                  router.replace('/login');
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : 'Deletion failed.');
                  setBusy(null);
                }
              }}
            >
              {busy === 'delete' ? 'Staging…' : 'Confirm deletion'}
            </button>
          </>
        }
      >
        <p className="text-sm" style={{ color: 'var(--color-ink-soft)' }}>
          Your account enters a 30-day grace period. During that time you can restore it or export your data. After 30
          days every workflow, snapshot and secret is permanently deleted.
        </p>
      </Modal>
    </div>
  );
}

/* ─────────────────────────── Bind repo modal ───────────────────────────── */

/**
 * Picks a repo from the account's GitHub App installation and binds it to a
 * workflow. Repos load lazily on open, so a Settings visit doesn't hit GitHub
 * for every page view.
 */
function BindRepoModal({
  open,
  onClose,
  installationId,
}: {
  open: boolean;
  onClose: () => void;
  installationId: number | null;
}) {
  const toast = useToast();
  const apps = useAsync(listApps, []);
  const repos = useAsync(
    () => (open && installationId ? listInstallRepos(installationId) : Promise.resolve([])),
    [open, installationId],
  );

  const [slug, setSlug] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = (repos.data ?? []).find((r) => r.full_name === repo);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!installationId) return;
    setBusy(true);
    try {
      await bindAppInstall(slug, installationId, repo, branch.trim() || undefined);
      toast.success(`${repo} bound to ${slug}.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not bind the repository.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={520}
      title="Bind a repository"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="bind-repo" type="submit" disabled={busy || !slug || !repo}>
            {busy ? 'Binding…' : 'Bind repository'}
          </button>
        </>
      }
    >
      <form id="bind-repo" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Workflow</label>
          <select className="field" value={slug} onChange={(e) => setSlug(e.target.value)} required>
            <option value="">Select a workflow…</option>
            {(apps.data ?? []).map((a) => (
              <option key={a.id} value={a.slug}>{a.slug}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Repository</label>
          {repos.error ? (
            <p className="text-sm" style={{ color: 'var(--color-danger)' }}>
              Could not list repositories: {repos.error.message}
            </p>
          ) : repos.loading ? (
            <div className="flex items-center gap-2 py-2 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              <Spinner size={14} /> Loading repositories…
            </div>
          ) : (repos.data ?? []).length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              The installation can&apos;t see any repositories. Grant the Gregale GitHub App access to a repo, then
              reopen this dialog.
            </p>
          ) : (
            <select
              className="field"
              value={repo}
              onChange={(e) => {
                setRepo(e.target.value);
                setBranch('');
              }}
              required
            >
              <option value="">Select a repository…</option>
              {(repos.data ?? []).map((r) => (
                <option key={r.id} value={r.full_name}>
                  {r.full_name}
                  {r.private ? ' (private)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="label">Production branch</label>
          <input
            className="field mono"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={selected?.default_branch ?? 'default branch'}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
            Leave empty to use the repository&apos;s default branch
            {selected ? ` (${selected.default_branch})` : ''}.
          </p>
        </div>
      </form>
    </Modal>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>{k}</dt>
      <dd className="mt-1 font-medium" style={{ color: 'var(--color-ink)' }}>{v}</dd>
    </div>
  );
}
