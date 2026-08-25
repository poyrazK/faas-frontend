'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { getInvitation, acceptInvitation, OrgInvitation } from '@/lib/api';
import Link from 'next/link';

export default function JoinPage() {
  const params = useParams();
  const token = params.token as string;
  const { account, signOut } = useAuth();
  
  const [invitation, setInvitation] = useState<OrgInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    getInvitation(token)
      .then(setInvitation)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Invalid or expired invitation'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    setError('');
    try {
      await acceptInvitation(token);
      // Hard redirect to dashboard to force a full reload and repopulate contexts
      if (typeof window !== 'undefined') window.location.href = '/dashboard';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
      setAccepting(false);
    }
  };

  if (loading) {
    return <div className="p-10 text-center text-sm text-[var(--color-ink-muted)]">Loading invitation...</div>;
  }

  return (
    <div className="mx-auto max-w-md pt-32 px-4">
      <div className="card p-8 text-center" style={{ boxShadow: 'var(--shadow-pop)' }}>
        {error ? (
          <div>
            <h2 className="text-xl font-bold mb-4">Invitation Not Found</h2>
            <p className="text-sm text-[var(--color-danger)] mb-6">{error}</p>
            <Link href="/dashboard" className="btn btn-primary">Go to Dashboard</Link>
          </div>
        ) : invitation ? (
          <div>
            <div className="mb-4 text-4xl">👋</div>
            <h2 className="text-2xl font-bold mb-2">You&apos;ve been invited!</h2>
            <p className="text-[var(--color-ink-muted)] mb-8 text-sm">
              You have been invited to join an organization as a <span className="font-semibold capitalize text-[var(--color-ink)]">{invitation.role}</span>.
            </p>
            
            {!account ? (
              <div className="space-y-4">
                <p className="text-sm text-[var(--color-ink-muted)]">Please sign in to accept this invitation.</p>
                <Link href={`/login?next=/join/${token}`} className="btn btn-primary block w-full text-center py-2">
                  Sign In to Accept
                </Link>
              </div>
            ) : account.email !== invitation.email ? (
              <div className="space-y-4">
                <p className="text-sm text-[var(--color-danger)] font-semibold p-3 bg-red-50 rounded">
                  This invitation was sent to {invitation.email}, but you are currently logged in as {account.email}.
                </p>
                <button onClick={signOut} className="btn block w-full py-2">
                  Sign out
                </button>
              </div>
            ) : (
              <button 
                onClick={handleAccept} 
                disabled={accepting} 
                className={`btn btn-primary w-full py-2 ${accepting ? 'opacity-50' : ''}`}
              >
                {accepting ? 'Accepting...' : 'Accept Invitation'}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
