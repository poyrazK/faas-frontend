'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/bits';
import { AsyncBoundary, Spinner } from '@/components/ui/States';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import { 
  listOrgMembers, listOrgInvitations, addOrgMember, 
  removeOrgMember, updateOrgMemberRole, revokeOrgInvitation, ApiError 
} from '@/lib/api';

export default function OrgSettingsPage() {
  const { activeOrg, account } = useAuth();
  const router = useRouter();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'developer'>('developer');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const members = useAsync(async () => activeOrg ? (await listOrgMembers(activeOrg.slug)).members : [], [activeOrg?.slug]);
  const invites = useAsync(async () => activeOrg ? (await listOrgInvitations(activeOrg.slug)).invitations : [], [activeOrg?.slug]);

  // If there's no active org, they shouldn't be on this page.
  if (!activeOrg) {
    if (typeof window !== 'undefined') router.replace('/dashboard/settings');
    return <div className="p-10 text-center text-sm text-[var(--color-ink-muted)]">Redirecting...</div>;
  }

  const canManage = activeOrg.role === 'owner' || activeOrg.role === 'admin';

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInviteToken(null);
    try {
      const res = await addOrgMember(activeOrg.slug, inviteEmail, inviteRole);
      setInviteToken(res.token);
      setInviteEmail('');
      setInviteRole('developer');
      await invites.reload();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to send invite');
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (userId: string, role: 'admin' | 'developer') => {
    try {
      await updateOrgMemberRole(activeOrg.slug, userId, role);
      await members.reload();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to update role');
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    try {
      await removeOrgMember(activeOrg.slug, userId);
      await members.reload();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to remove member');
    }
  };

  const handleRevoke = async (token: string) => {
    try {
      await revokeOrgInvitation(activeOrg.slug, token);
      await invites.reload();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to revoke invite');
    }
  };

  return (
    <div>
      <PageHeader title={`${activeOrg.name} Settings`} subtitle={`Manage members and roles for ${activeOrg.slug}`} />

      {/* Members List */}
      <h3 className="text-lg font-semibold mb-3">Members</h3>
      <div className="card mb-8">
        <AsyncBoundary state={members} skeleton={<div className="p-4"><Spinner /></div>}>
          {(mems) => (
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--color-surface-subtle)] border-b border-[var(--color-line)]">
                <tr>
                  <th className="px-4 py-2 font-semibold">User</th>
                  <th className="px-4 py-2 font-semibold">Role</th>
                  <th className="px-4 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {mems.map((m) => (
                  <tr key={m.user_id} className="border-b border-[var(--color-line)] last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{m.email}</div>
                      <div className="text-xs text-[var(--color-ink-muted)]">Joined {new Date(m.joined_at).toLocaleDateString()}</div>
                    </td>
                    <td className="px-4 py-3">
                      {canManage && m.role !== 'owner' && m.user_id !== account?.id ? (
                        <select 
                          className="field px-2 py-1 text-xs" 
                          value={m.role} 
                          onChange={(e) => handleRoleChange(m.user_id, e.target.value as 'admin' | 'developer')}
                        >
                          <option value="admin">Admin</option>
                          <option value="developer">Developer</option>
                        </select>
                      ) : (
                        <span className="capitalize text-xs font-semibold px-2 py-1 bg-[var(--color-surface-subtle)] rounded">{m.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage && m.role !== 'owner' && m.user_id !== account?.id && (
                        <button onClick={() => handleRemove(m.user_id)} className="text-[var(--color-danger)] text-xs font-semibold hover:underline">
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncBoundary>
      </div>

      {/* Pending Invitations */}
      {canManage && (
        <>
          <h3 className="text-lg font-semibold mb-3">Pending Invitations</h3>
          <div className="card mb-8">
            <AsyncBoundary state={invites} skeleton={<div className="p-4"><Spinner /></div>}>
              {(invs) => invs.length === 0 ? (
                <div className="p-4 text-sm text-[var(--color-ink-muted)]">No pending invitations.</div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-[var(--color-surface-subtle)] border-b border-[var(--color-line)]">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Email</th>
                      <th className="px-4 py-2 font-semibold">Role</th>
                      <th className="px-4 py-2 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invs.map((inv) => (
                      <tr key={inv.token} className="border-b border-[var(--color-line)] last:border-0">
                        <td className="px-4 py-3">{inv.email}</td>
                        <td className="px-4 py-3 capitalize text-xs">{inv.role}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleRevoke(inv.token)} className="text-[var(--color-danger)] text-xs font-semibold hover:underline">
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

          {/* Invite Form */}
          <h3 className="text-lg font-semibold mb-3">Invite Member</h3>
          <div className="card p-4 max-w-xl">
            <form onSubmit={handleInvite} className="mt-4">
              {inviteToken && (
                <div className="mb-4 rounded bg-green-50 p-4 border border-green-200 text-green-900 text-sm">
                  <strong>Invitation generated!</strong> Send this link to your colleague:
                  <div className="mt-2 flex gap-2">
                    <input 
                      type="text" 
                      readOnly 
                      className="field w-full text-xs" 
                      value={`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${inviteToken}`} 
                      onClick={(e) => e.currentTarget.select()}
                    />
                  </div>
                </div>
              )}
              {error && <div className="mb-4 text-sm text-[var(--color-danger)]">{error}</div>}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold mb-1 text-[var(--color-ink-muted)] uppercase tracking-wider">Email Address</label>
                  <input type="email" required className="field w-full" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@example.com" />
                </div>
                <div className="w-32">
                  <label className="block text-xs font-semibold mb-1 text-[var(--color-ink-muted)] uppercase tracking-wider">Role</label>
                  <select className="field w-full" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'admin' | 'developer')}>
                    <option value="developer">Developer</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <button type="submit" disabled={busy || !inviteEmail} className="btn btn-secondary text-sm">
                {busy ? 'Sending...' : 'Send Invitation'}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
