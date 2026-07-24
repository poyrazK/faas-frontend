'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAccount, fetchApiKeys, clearAuthToken, AccountModel } from '@/lib/api';

export default function ProfilePage() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountModel | null>(null);
  const [apiKeys, setApiKeys] = useState<{ id: string; name: string; prefix: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        const acctData = await getAccount();
        if (!acctData) {
          setError('Not authenticated. Please sign in.');
          setLoading(false);
          return;
        }
        setAccount(acctData);

        const keysData = await fetchApiKeys();
        if (keysData) {
          setApiKeys(keysData);
        }
      } catch (err: any) {
        setError(`Failed to load user profile: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  const handleSignOut = () => {
    clearAuthToken();
    router.push('/login');
  };

  const getInitial = (email?: string) => {
    if (!email) return 'U';
    return email.trim().charAt(0).toUpperCase();
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)', color: 'var(--text-primary)' }}>
      {/* Header / Navbar */}
      <header style={{ borderBottom: '1px solid var(--border-dim)', background: 'rgba(10, 15, 20, 0.8)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
            <img src="/gregale-logo-green-trans.png" alt="Gregale" style={{ height: '32px' }} />
            <span style={{ fontWeight: 800, fontSize: '1.2rem', color: '#FFF', letterSpacing: '-0.02em' }}>Gregale Console</span>
          </a>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <a href="/" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
              ← Return to Dashboard
            </a>
            <button onClick={handleSignOut} className="btn btn-danger btn-sm">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Profile Workspace */}
      <main style={{ maxWidth: '960px', margin: '2.5rem auto', padding: '0 1.5rem' }}>
        {loading && (
          <div style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading PostgreSQL user profile...
          </div>
        )}

        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '1.5rem', borderRadius: '12px', textAlign: 'center' }}>
            <h3 style={{ margin: 0, fontWeight: 700, fontSize: '1.1rem' }}>Authentication Error</h3>
            <p style={{ margin: '0.5rem 0 1rem 0' }}>{error}</p>
            <a href="/login" className="btn btn-gregale btn-sm" style={{ textDecoration: 'none' }}>Go to Sign In</a>
          </div>
        )}

        {account && !loading && (
          <div>
            {/* User Hero Banner */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: '16px', padding: '2rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
              {/* Avatar Circle */}
              <div style={{ 
                width: '72px', 
                height: '72px', 
                borderRadius: '50%', 
                background: 'linear-gradient(135deg, var(--gregale-green), #059669)', 
                color: '#FFF', 
                fontSize: '2rem', 
                fontWeight: 800, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                boxShadow: '0 8px 20px rgba(16, 185, 129, 0.3)',
                flexShrink: 0
              }}>
                {getInitial(account.email)}
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                  <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>{account.email}</h1>
                  <span style={{ 
                    background: account.plan === 'pro' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.1)', 
                    color: account.plan === 'pro' ? 'var(--gregale-green)' : 'var(--text-secondary)',
                    padding: '0.2rem 0.65rem',
                    borderRadius: '20px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textTransform: 'uppercase'
                  }}>
                    {account.plan} plan
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', fontFamily: 'var(--font-mono)' }}>
                  User ID: {account.id}
                </div>
              </div>

              <div>
                <button onClick={handleSignOut} className="btn btn-secondary btn-sm">
                  Sign Out
                </button>
              </div>
            </div>

            {/* Profile Grid Details */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
              {/* Account Status Card */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: '12px', padding: '1.5rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  Account Status
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--gregale-green)', textTransform: 'capitalize' }}>
                  ● {account.status}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                  PostgreSQL verified active state
                </div>
              </div>

              {/* Monthly Usage Card */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: '12px', padding: '1.5rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  Compute Usage
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#FFF' }}>
                  {account.usage_gb_hours || 0} GB-hours
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                  Included: {account.limits?.included_gb_hours || 5} GB-h / month
                </div>
              </div>

              {/* Memory Allocation Limits */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: '12px', padding: '1.5rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  Resource Quota Limits
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#FFF' }}>
                  {account.limits?.ram_mb || 128} MB RAM / MicroVM
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                  Max Concurrency: {account.limits?.max_concurrency || 1} MicroVMs
                </div>
              </div>
            </div>

            {/* Active API Keys Section */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: '12px', padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Registered API Keys</h3>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Active Bearer credentials issued from PostgreSQL store for this account.
                  </p>
                </div>
              </div>

              {apiKeys.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', border: '1px dashed var(--border-dim)', borderRadius: '8px' }}>
                  No extra API keys registered yet.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {apiKeys.map((key) => (
                    <div key={key.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-dim)', borderRadius: '8px' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{key.name || 'Web Console Key'}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                          Prefix: {key.prefix || 'fp_live_...'}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--gregale-green)', background: 'rgba(16, 185, 129, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                        ACTIVE
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
