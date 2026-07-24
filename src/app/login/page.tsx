'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { googleAuthUrl, githubAuthUrl, ApiError } from '@/lib/api';
import { Spinner } from '@/components/ui/States';

function LoginInner() {
  const { account, loading, signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // Already signed in → bounce to the dashboard.
  useEffect(() => {
    if (!loading && account) router.replace(next);
  }, [loading, account, next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('submitting');
    setMessage('');
    try {
      const acct = await signIn(email.trim());
      if (acct) {
        // Session cookie is live — go straight to the console.
        router.replace(next);
      } else {
        // POST succeeded but no session cookie (e.g. cookies blocked, or
        // insecure-origin dev where the Secure cookie is dropped).
        setStatus('error');
        setMessage('Signed in, but we couldn’t start your session. Make sure cookies are enabled and try again.');
      }
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: 'var(--color-surface-subtle)' }}>
      <div className="card w-full max-w-md p-8">
        <div className="mb-7 text-center">
          <Link href="/" className="inline-block">
            <Image src="/gregale-logo-green-trans.png" alt="Gregale" width={150} height={40} style={{ height: 38, width: 'auto', margin: '0 auto' }} priority />
          </Link>
          <h1 className="mt-5 text-xl font-bold">Sign in to Gregale</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>Scale-to-zero Firecracker MicroVM cloud</p>
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          <a href={githubAuthUrl} className="btn btn-secondary w-full">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.72-4.04-1.6-4.04-1.6-.55-1.39-1.34-1.76-1.34-1.76-1.08-.75.08-.73.08-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.8 1.3 3.49.99.1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.3-1.55 3.3-1.23 3.3-1.23.64 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
            Continue with GitHub
          </a>
          <a href={googleAuthUrl} className="btn btn-secondary w-full">
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" /><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 010-4.2V7.06H2.18a11 11 0 000 9.88l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 002.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" /></svg>
            Continue with Google
          </a>
        </div>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1" style={{ background: 'var(--color-line)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--color-ink-muted)' }}>OR</span>
          <span className="h-px flex-1" style={{ background: 'var(--color-line)' }} />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="field"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={status === 'submitting'}>
            {status === 'submitting' ? <Spinner size={16} /> : null}
            {status === 'submitting' ? 'Signing in…' : 'Continue with email'}
          </button>
        </form>

        {message && (
          <div
            className="mt-4 rounded-lg px-3 py-2.5 text-sm"
            style={
              status === 'error'
                ? { background: '#fef2f2', color: '#b91c1c' }
                : { background: 'var(--color-brand-soft)', color: 'var(--color-brand-bright)' }
            }
          >
            {message}
          </div>
        )}

        <p className="mt-6 text-center text-xs" style={{ color: 'var(--color-ink-muted)' }}>
          No password required — enter your email to sign in instantly.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Spinner size={22} /></div>}>
      <LoginInner />
    </Suspense>
  );
}
