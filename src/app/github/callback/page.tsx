'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getApiUrl } from '@/lib/api';

function GitHubCallbackContent() {
  const searchParams = useSearchParams();
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [repos, setRepos] = useState<Array<{ id: number; name: string; full_name: string; default_branch: string }>>([
    { id: 101, name: 'faas-api', full_name: 'poyrazK/faas-api', default_branch: 'main' },
    { id: 102, name: 'auth-service', full_name: 'poyrazK/auth-service', default_branch: 'main' },
    { id: 103, name: 'payment-webhook', full_name: 'poyrazK/payment-webhook', default_branch: 'master' },
  ]);
  const [selectedRepo, setSelectedRepo] = useState<string>('poyrazK/faas-api');
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    const instId = searchParams.get('installation_id') || searchParams.get('code');
    if (instId) {
      setInstallationId(instId);
    }
  }, [searchParams]);

  const handleLinkRepo = (e: React.FormEvent) => {
    e.preventDefault();
    setLinked(true);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-dark, #090D16)',
      color: 'var(--text-primary, #F8FAFC)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <div style={{
        maxWidth: '520px',
        width: '100%',
        background: '#1E293B',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '2.5rem',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ width: '36px', height: '36px', background: '#0F172A', border: '1px solid #475569', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: '#FFF' }}>
            GH
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>GitHub App Connected</h1>
            <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: 0 }}>
              {installationId ? `Installation ID: ${installationId}` : 'Select a repository to link push-to-deploy'}
            </p>
          </div>
        </div>

        {!linked ? (
          <form onSubmit={handleLinkRepo}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#CBD5E1', marginBottom: '0.5rem', fontWeight: 600 }}>
                Select Authorized Repository
              </label>
              <select
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: '#0F172A',
                  border: '1px solid #475569',
                  borderRadius: '6px',
                  color: '#F8FAFC',
                  fontSize: '0.95rem'
                }}
              >
                {repos.map(r => (
                  <option key={r.id} value={r.full_name}>
                    {r.full_name} (branch: {r.default_branch})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ background: '#0F172A', padding: '1rem', borderRadius: '6px', border: '1px solid #334155', marginBottom: '1.5rem', fontSize: '0.82rem', color: '#94A3B8' }}>
              ℹ️ Pushes to <code>main</code> branch will trigger automatic MicroVM snapshot builds via <code>githubd</code> webhook listener.
            </div>

            <button 
              type="submit" 
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#22C55E',
                color: '#090D16',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer'
              }}
            >
              Link {selectedRepo} &amp; Enable Push-to-Deploy
            </button>
          </form>
        ) : (
          <div style={{ background: '#052E16', border: '1px solid #166534', padding: '1.5rem', borderRadius: '8px' }}>
            <div style={{ color: '#4ADE80', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
              ✓ Repository Linked Successfully!
            </div>
            <p style={{ fontSize: '0.9rem', color: '#E2E8F0', marginBottom: '1.25rem' }}>
              Linked <strong>{selectedRepo}</strong> to FaaS deployment pipeline.
            </p>
            <a 
              href="/"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '0.75rem',
                background: '#22C55E',
                color: '#090D16',
                borderRadius: '6px',
                fontWeight: 700,
                textDecoration: 'none'
              }}
            >
              Return to Console
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GitHubCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#090D16', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading GitHub Connection...
      </div>
    }>
      <GitHubCallbackContent />
    </Suspense>
  );
}
