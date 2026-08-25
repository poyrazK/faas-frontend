'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { requestPasswordReset, PASSWORD_MIN_LENGTH, ApiError } from '@/lib/api';
import { Spinner } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';

type Mode = 'signin' | 'signup' | 'forgot';

function OperationsLoginInner() {
  const { account, loading, signIn, signUp } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/operations/overview';

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error' | 'sent'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!loading && account) router.replace(next);
  }, [loading, account, next, router]);

  const tooShort = mode === 'signup' && password.length > 0 && password.length < PASSWORD_MIN_LENGTH;

  function switchMode(m: Mode) {
    setMode(m);
    setStatus('idle');
    setMessage('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('submitting');
    setMessage('');

    try {
      if (mode === 'forgot') {
        await requestPasswordReset(email.trim());
        setStatus('sent');
        setMessage('If that operator address is registered, a reset link is on its way.');
        return;
      }

      const acct = mode === 'signup' ? await signUp(email.trim(), password) : await signIn(email.trim(), password);

      if (acct) {
        router.replace(next);
      } else {
        setStatus('error');
        setMessage('Authentication succeeded but session cookie was not established. Verify browser cookie permissions.');
      }
    } catch (err) {
      setStatus('error');
      setMessage(
        err instanceof ApiError
          ? err.message
          : mode === 'signup'
            ? 'Could not create operator account. Please try again.'
            : 'Sign-in failed. Operator access requires registration in FAAS_ADMIN_EMAILS.',
      );
    }
  }

  const heading =
    mode === 'signup'
      ? 'Create operator account'
      : mode === 'forgot'
        ? 'Reset operator password'
        : 'Sign in to Operations';

  const blurb =
    mode === 'signup'
      ? `Pick a password of at least ${PASSWORD_MIN_LENGTH} characters.`
      : mode === 'forgot'
        ? 'Enter your operator email and we’ll send a reset link.'
        : 'Access is restricted to authorized addresses listed in FAAS_ADMIN_EMAILS.';

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Form side */}
      <div className="flex items-center justify-center px-5 py-12" style={{ background: 'var(--color-surface)' }}>
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2">
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
            <span className="rounded bg-[var(--color-brand-bright)]/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand-bright)] border border-[var(--color-brand-bright)]/20">
              OPERATIONS
            </span>
          </div>

          <h1 className="mt-9 text-2xl font-bold tracking-tight">{heading}</h1>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            {blurb}
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-semibold">
                Operator Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                className="field"
                placeholder="operator@gregale.dev"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="password" className="text-xs font-semibold">
                    Password
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-xs font-medium text-[var(--color-brand-bright)] hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    className="field"
                    style={{ paddingRight: '2.5rem' }}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={mode === 'signup' ? PASSWORD_MIN_LENGTH : undefined}
                    maxLength={256}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1"
                    style={{ color: 'var(--color-ink-muted)' }}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Icon name={showPassword ? 'x' : 'user'} size={15} />
                  </button>
                </div>
                {mode === 'signup' && (
                  <p className="mt-1 text-xs" style={{ color: tooShort ? 'var(--color-warn)' : 'var(--color-ink-muted)' }}>
                    {tooShort
                      ? `${PASSWORD_MIN_LENGTH - password.length} more character${PASSWORD_MIN_LENGTH - password.length === 1 ? '' : 's'} needed`
                      : `At least ${PASSWORD_MIN_LENGTH} characters.`}
                  </p>
                )}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={status === 'submitting' || tooShort}
            >
              {status === 'submitting' ? <Spinner size={15} /> : null}
              {status === 'submitting'
                ? mode === 'signup'
                  ? 'Creating operator account…'
                  : mode === 'forgot'
                    ? 'Sending…'
                    : 'Signing in…'
                : mode === 'signup'
                  ? 'Create operator account'
                  : mode === 'forgot'
                    ? 'Send reset link'
                    : 'Sign in to Operations'}
            </button>
          </form>

          {message && (
            <div
              className="mt-4 rounded-lg px-3 py-2.5 text-sm"
              style={
                status === 'error'
                  ? { background: '#fdf1f1', color: '#b91c1c', border: '1px solid #f5d5d5' }
                  : { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }
              }
            >
              {message}
            </div>
          )}

          <div className="mt-6 text-center text-xs" style={{ color: 'var(--color-ink-muted)' }}>
            {mode === 'signin' && (
              <span>
                First-time operator setup?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="font-semibold text-[var(--color-brand-bright)] hover:underline"
                >
                  Create account
                </button>
              </span>
            )}
            {mode === 'signup' && (
              <span>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="font-semibold text-[var(--color-brand-bright)] hover:underline"
                >
                  Sign in
                </button>
              </span>
            )}
            {mode === 'forgot' && (
              <span>
                Remembered your password?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="font-semibold text-[var(--color-brand-bright)] hover:underline"
                >
                  Back to sign-in
                </button>
              </span>
            )}
          </div>

          <div className="mt-8 pt-4 border-t border-[var(--color-line)] text-center">
            <a
              href="https://gregale.dev/login"
              className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
            >
              ← Customer Developer Console Login
            </a>
          </div>
        </div>
      </div>

      {/* Brand side */}
      <div
        className="relative hidden flex-col justify-center px-12 lg:flex"
        style={{ background: 'var(--color-brand-softer)', borderLeft: '1px solid var(--color-line)' }}
      >
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative max-w-md">
          <span className="badge badge-brand mb-5">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
            Control Plane Fleet
          </span>
          <h2 className="text-3xl font-bold leading-tight tracking-tight">
            Bare-metal microVM observability & recovery controls.
          </h2>
          <p className="mt-4 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
            Real-time fleet admission ceilings, wake latency quantiles, live microVM force-parking, and platform-wide audit search.
          </p>
          <ul className="mt-7 space-y-3.5">
            {[
              ['bolt', 'Emergency Recovery Primitives', 'Asynchronously evict microVMs, invalidate warm snapshots, and sweep stuck builds.'],
              ['storage', 'Compute Host Telemetry', 'Bare-metal vCPU and RAM allocations with rolling p50/p95/p99 wake quantiles.'],
              ['shield', 'Regulator-Grade Audit Search', 'Global append-only audit trail with actor email and operator-only filters.'],
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

export default function OperationsLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner size={22} />
        </div>
      }
    >
      <OperationsLoginInner />
    </Suspense>
  );
}
