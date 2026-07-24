'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { exportAccount, deleteAccount, restoreAccount, ApiError } from '@/lib/api';
import { PageHeader, Mono } from '@/components/ui/bits';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { PLANS } from '@/lib/format';

export default function SettingsPage() {
  const { account, refresh, signOut } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!account) return null;
  const pending = account.status === 'deleted_pending';

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

      <div className="card p-6">
        <h2 className="text-sm font-semibold">Account</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase" style={{ color: 'var(--color-ink-muted)' }}>Email</dt>
            <dd className="mt-1 font-semibold">{account.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase" style={{ color: 'var(--color-ink-muted)' }}>Plan</dt>
            <dd className="mt-1 font-semibold">{PLANS[account.plan].label}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase" style={{ color: 'var(--color-ink-muted)' }}>Account ID</dt>
            <dd className="mt-1"><Mono>{account.id}</Mono></dd>
          </div>
        </dl>
      </div>

      <div className="card mt-6 p-6">
        <h2 className="text-sm font-semibold">Data export (GDPR)</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          Download everything we hold about your account — apps, deployments, usage, domains, crons, keys, and sealed secret envelopes.
        </p>
        <button className="btn btn-secondary mt-4" onClick={doExport} disabled={busy === 'export'}>
          {busy === 'export' ? 'Preparing…' : 'Export account data'}
        </button>
      </div>

      <div className="card mt-6 p-6" style={{ borderColor: '#fecaca' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-danger)' }}>Danger zone</h2>
        {pending ? (
          <>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
              Your account is scheduled for deletion (30-day grace period). You can restore it any time before then.
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
              Staging deletion moves your account to a <Mono>deleted_pending</Mono> state for 30 days, after which it is permanently purged.
            </p>
            <button className="btn btn-danger mt-4" onClick={() => setConfirmDelete(true)}>Stage account deletion</button>
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
          Your account enters a 30-day grace period. During that time you can restore or export your data. After 30 days everything is permanently deleted.
        </p>
      </Modal>
    </div>
  );
}
