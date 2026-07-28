'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { googleAuthUrl, githubAuthUrl, ApiError } from '@/lib/api';
import { Spinner } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';

function LoginInner() {
  const { account, loading, signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // Already signed in → bounce to the console.
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
        router.replace(next);
      } else {
        // POST succeeded but no session cookie (cookies blocked, or an
        // insecure-origin dev host where the Secure cookie is dropped).
        setStatus('error');
        setMessage('Signed in, but we couldn’t start your session. Make sure cookies are enabled and try again.');
      }
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Form side */}
      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="inline-block">
            <Image
              src="/gregale-logo-green-trans.png"
              alt="Gregale"
              width={150}
              height={40}
              style={{ height: 34, width: 'auto' }}
              priority
            />
          </Link>

          <h1 className="mt-9 text-2xl font-bold tracking-tight">Sign in to Gregale</h1>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            No password needed — enter your email and we&apos;ll start your session.
          </p>

          <div className="mt-7 grid gap-2.5">
            <a href={githubAuthUrl} className="btn btn-secondary w-full">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.72-4.04-1.6-4.04-1.6-.55-1.39-1.34-1.76-1.34-1.76-1.08-.75.08-.73.08-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.8 1.3 3.49.99.1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.3-1.55 3.3-1.23 3.3-1.23.64 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Continue with GitHub
            </a>
            <a href={googleAuthUrl} className="btn btn-secondary w-full">
              <svg width="17" height="17" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" />
                <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 010-4.2V7.06H2.18a11 11 0 000 9.88l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 002.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
              </svg>
              Continue with Google
            </a>
          </div>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1" style={{ background: 'var(--color-line)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>
              OR
            </span>
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
              {status === 'submitting' ? <Spinner size={15} /> : null}
              {status === 'submitting' ? 'Signing in…' : 'Continue with email'}
            </button>
          </form>

          {message && (
            <div
              className="mt-4 rounded-lg px-3 py-2.5 text-sm"
              style={
                status === 'error'
                  ? { background: '#fdf1f1', color: '#b91c1c', border: '1px solid #f5d5d5' }
                  : { background: 'var(--color-brand-soft)', color: 'var(--color-brand-bright)' }
              }
            >
              {message}
            </div>
          )}

          <p className="mt-8 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
            By continuing you agree to run workloads within your plan&apos;s limits.{' '}
            <Link href="/#pricing" style={{ color: 'var(--color-brand)' }}>
              See plans
            </Link>
          </p>
        </div>
      </div>

      {/* Brand side */}
      <div className="relative hidden flex-col justify-center px-12 lg:flex" style={{ background: 'var(--color-brand-softer)', borderLeft: '1px solid var(--color-line)' }}>
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative max-w-md">
          <span className="badge badge-brand mb-5">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
            Built on Firecracker
          </span>
          <h2 className="text-3xl font-bold leading-tight tracking-tight">
            Your apps park as snapshots and wake in under 350&nbsp;ms.
          </h2>
          <p className="mt-4 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
            No idle instances quietly billing you. A parked workflow holds zero resident memory — it exists as a memory
            snapshot on NVMe until the next request arrives.
          </p>
          <ul className="mt-7 space-y-3.5">
            {[
              ['bolt', 'Cold wake, not cold start', 'Memory, network and clock restore in one pipeline.'],
              ['shield', 'A microVM per tenant', 'Own uid, seccomp filter and cgroup — a real VM boundary.'],
              ['scale', 'Pay per running second', 'Plan RAM plus 8 MB per second. Parked costs nothing.'],
            ].map(([icon, title, body]) => (
              <li key={title} className="flex items-start gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-brand-bright)', border: '1px solid var(--color-brand-line)' }}
                >
                  <Icon name={icon as 'bolt'} size={15} />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                    {body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner size={22} />
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
