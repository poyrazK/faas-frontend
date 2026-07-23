'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { approveCliAuth, getApiUrl } from '@/lib/api';

function CliAuthContent() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'authorizing' | 'success' | 'error'>('idle');
  const [authResult, setAuthResult] = useState<{ email?: string; token?: string; error?: string }>({});

  useEffect(() => {
    const codeParam = searchParams.get('code');
    if (codeParam) {
      setCode(codeParam);
    }
  }, [searchParams]);

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setStatus('authorizing');
    const res = await approveCliAuth(code.trim());
    if (res.success) {
      setStatus('success');
      setAuthResult({ email: res.email, token: res.token });
    } else {
      setStatus('error');
      setAuthResult({ error: res.error || 'Invalid or expired authorization code' });
    }
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
        maxWidth: '480px',
        width: '100%',
        background: '#1E293B',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '2.5rem',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ width: '36px', height: '36px', background: '#22C55E', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: '#000' }}>
            F
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>CLI Authorization</h1>
            <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: 0 }}>Authorize <code>faas</code> CLI session</p>
          </div>
        </div>

        {status === 'idle' && (
          <form onSubmit={handleApprove}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#CBD5E1', marginBottom: '0.5rem', fontWeight: 600 }}>
                Authorization Code from Terminal
              </label>
              <input 
                type="text" 
                value={code} 
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. WXYZ-1234"
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  background: '#0F172A',
                  border: '1px solid #475569',
                  borderRadius: '6px',
                  color: '#F8FAFC',
                  fontSize: '1.1rem',
                  fontFamily: 'monospace',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  textAlign: 'center'
                }}
                required 
              />
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
              Approve CLI Session
            </button>
          </form>
        )}

        {status === 'authorizing' && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ color: '#22C55E', fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Verifying token with Control Plane...
            </div>
            <p style={{ fontSize: '0.85rem', color: '#94A3B8' }}>{getApiUrl()}</p>
          </div>
        )}

        {status === 'success' && (
          <div style={{ background: '#052E16', border: '1px solid #166534', padding: '1.5rem', borderRadius: '8px' }}>
            <div style={{ color: '#4ADE80', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
              ✓ Authorization Complete!
            </div>
            <p style={{ fontSize: '0.9rem', color: '#E2E8F0', marginBottom: '1rem' }}>
              Logged in as <strong>{authResult.email}</strong>. You can now close this tab and return to your terminal.
            </p>
            {authResult.token && (
              <div style={{ background: '#090D16', padding: '0.75rem', borderRadius: '4px', border: '1px solid #1E293B' }}>
                <span style={{ fontSize: '0.75rem', color: '#94A3B8', display: 'block', marginBottom: '0.25rem' }}>BEARER TOKEN ISSUED</span>
                <code style={{ fontSize: '0.8rem', color: '#4ADE80', wordBreak: 'break-all' }}>{authResult.token}</code>
              </div>
            )}
          </div>
        )}

        {status === 'error' && (
          <div>
            <div style={{ background: '#450A0A', border: '1px solid #991B1B', padding: '1.25rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
              <div style={{ color: '#FCA5A5', fontWeight: 700, marginBottom: '0.25rem' }}>
                ✗ Authorization Failed
              </div>
              <p style={{ fontSize: '0.85rem', color: '#FECACA', margin: 0 }}>{authResult.error}</p>
            </div>
            <button 
              onClick={() => setStatus('idle')}
              style={{
                width: '100%',
                padding: '0.65rem',
                background: '#334155',
                color: '#F8FAFC',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CliAuthPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#090D16', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading CLI Auth...
      </div>
    }>
      <CliAuthContent />
    </Suspense>
  );
}
