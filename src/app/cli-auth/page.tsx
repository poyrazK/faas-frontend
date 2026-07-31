'use client';

/* ==========================================================================
   CLI Device Authorization Page (/cli-auth?code=XXXX-NNNN)

   Triggered by `gregale login` (or `faas login`). The CLI mints an 8-character
   code and opens this page in the user's browser.

   Security & Auth Flow:
   1. Visitor lands on /cli-auth?code=ABCD-1234
   2. Page initializes CSRF session via /api/cli-auth?code=... on mount
   3. If visitor is signed in → One-click "Authorize CLI as <email>" button
   4. If visitor is NOT signed in → Prompts for Email + Password authentication
      (or OAuth), verifying account ownership BEFORE claiming the CLI code!
   ========================================================================== */

import React, { Suspense, useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { googleAuthUrl, githubAuthUrl, PASSWORD_MIN_LENGTH, ApiError } from '@/lib/api';
import { Spinner } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';

function CliAuthInner() {
  const { account, loading, signIn, signUp } = useAuth();
  const searchParams = useSearchParams();
  const rawCodeParam = searchParams.get('code') || '';

  // Format code cleanly (e.g. ABCD-1234)
  const normalizedCode = rawCodeParam
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

  const formattedCode =
    normalizedCode.length === 8
      ? `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`
      : rawCodeParam.trim();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [csrfToken, setCsrfToken] = useState('');
  const [initLoading, setInitLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Fetch CSRF token & initialize session cookie from backend on mount
  useEffect(() => {
    if (normalizedCode.length !== 8) {
      setInitLoading(false);
      return;
    }

    async function initCsrf() {
      try {
        const res = await fetch(`/api/cli-auth?code=${normalizedCode}`, { cache: 'no-store' });
        const html = await res.text();
        const match = html.match(/name="csrf_token"\s+value="([^"]+)"/);
        if (match && match[1]) {
          setCsrfToken(match[1]);
        }
      } catch (err) {
        console.error('Failed to initialize CLI auth session:', err);
      } finally {
        setInitLoading(false);
      }
    }

    initCsrf();
  }, [normalizedCode]);

  const isValidCode = normalizedCode.length === 8;

  // Handle guest authentication first, then submit CLI authorization form
  async function handleGuestAuthAndAuthorize(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || !isValidCode) return;

    setSubmitting(true);
    setErrorMsg('');

    try {
      // 1. Authenticate guest user (Sign in or Sign up)
      if (authMode === 'signup') {
        await signUp(email.trim(), password);
      } else {
        await signIn(email.trim(), password);
      }

      // 2. Submit native CLI claim form after successful login
      const formEl = document.getElementById('cli-auth-native-form') as HTMLFormElement;
      if (formEl) {
        formEl.submit();
      }
    } catch (err) {
      setSubmitting(false);
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : authMode === 'signup'
          ? 'Could not create account. Please check your details and try again.'
          : 'Invalid email or password. Please try again.'
      );
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Main Content Side */}
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

          <div className="mt-8">
            <span className="badge badge-brand mb-3">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
              CLI Device Login
            </span>
            <h1 className="text-2xl font-bold tracking-tight">Authorize CLI Session</h1>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              Your terminal requested authorization to access your Gregale account.
            </p>
          </div>

          {/* Device Code Badge */}
          <div
            className="my-6 flex flex-col items-center justify-center rounded-xl p-5 text-center"
            style={{
              background: 'var(--color-brand-softer)',
              border: '1px solid var(--color-brand-line)',
            }}
          >
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-ink-muted)' }}>
              Confirmation Code
            </span>
            <div className="mt-2 font-mono text-3xl font-bold tracking-widest" style={{ color: 'var(--color-brand-bright)' }}>
              {formattedCode || '--------'}
            </div>
            {!isValidCode && (
              <p className="mt-2 text-xs text-rose-500 font-medium">
                Invalid or missing code in URL parameters.
              </p>
            )}
          </div>

          {loading || initLoading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Spinner size={24} />
              <p className="mt-3 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                Loading authentication status…
              </p>
            </div>
          ) : account ? (
            /* Authenticated User View — Secure Single Click */
            <form id="cli-auth-native-form" method="POST" action="/api/cli-auth" className="space-y-4">
              <input type="hidden" name="code" value={normalizedCode} />
              <input type="hidden" name="csrf_token" value={csrfToken} />
              <input type="hidden" name="email" value={account.email} />

              <div
                className="rounded-lg p-3.5 text-sm"
                style={{
                  background: 'var(--color-surface-subtle)',
                  border: '1px solid var(--color-line)',
                }}
              >
                <span className="text-xs block font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                  Authenticated Account
                </span>
                <span className="font-semibold text-sm block mt-0.5" style={{ color: 'var(--color-brand-bright)' }}>
                  {account.email}
                </span>
              </div>

              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={!isValidCode || !csrfToken}
              >
                Authorize CLI as {account.email}
              </button>
            </form>
          ) : (
            /* Guest User View — Requires Password or OAuth Verification */
            <div className="space-y-4">
              <div className="grid gap-2.5">
                <a href={githubAuthUrl} className="btn btn-secondary w-full">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.72-4.04-1.6-4.04-1.6-.55-1.39-1.34-1.76-1.34-1.76-1.08-.75.08-.73.08-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.8 1.3 3.49.99.1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.3-1.55 3.3-1.23 3.3-1.23.64 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  Authorize with GitHub
                </a>
                <a href={googleAuthUrl} className="btn btn-secondary w-full">
                  <svg width="17" height="17" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" />
                    <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 010-4.2V7.06H2.18a11 11 0 000 9.88l3.66-2.84z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 002.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
                  </svg>
                  Authorize with Google
                </a>
              </div>

              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1" style={{ background: 'var(--color-line)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                  OR EMAIL & PASSWORD
                </span>
                <span className="h-px flex-1" style={{ background: 'var(--color-line)' }} />
              </div>

              {/* Native form for POST to /api/cli-auth */}
              <form id="cli-auth-native-form" method="POST" action="/api/cli-auth" className="hidden">
                <input type="hidden" name="code" value={normalizedCode} />
                <input type="hidden" name="csrf_token" value={csrfToken} />
                <input type="hidden" name="email" value={email} />
              </form>

              {/* User interactive login/signup form */}
              <form onSubmit={handleGuestAuthAndAuthorize} className="space-y-3">
                <div>
                  <label className="label" htmlFor="email">
                    Account Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    className="field"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <div className="flex items-baseline justify-between">
                    <label className="label" htmlFor="password">
                      Password
                    </label>
                    <button
                      type="button"
                      className="mb-1 text-xs font-medium"
                      style={{ color: 'var(--color-brand)' }}
                      onClick={() => {
                        setAuthMode((m) => (m === 'signin' ? 'signup' : 'signin'));
                        setErrorMsg('');
                      }}
                    >
                      {authMode === 'signin' ? 'New account? Sign up' : 'Existing account? Sign in'}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      className="field"
                      style={{ paddingRight: '2.5rem' }}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={authMode === 'signup' ? `At least ${PASSWORD_MIN_LENGTH} characters` : 'Enter your account password'}
                      minLength={authMode === 'signup' ? PASSWORD_MIN_LENGTH : undefined}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1"
                      style={{ color: 'var(--color-ink-muted)' }}
                    >
                      <Icon name={showPassword ? 'x' : 'user'} size={15} />
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary w-full mt-2"
                  disabled={submitting || !isValidCode || !email || !password || !csrfToken}
                >
                  {submitting ? <Spinner size={15} /> : null}
                  {submitting
                    ? 'Authenticating & Authorizing…'
                    : authMode === 'signup'
                    ? 'Create Account & Authorize CLI'
                    : 'Sign In & Authorize CLI'}
                </button>
              </form>
            </div>
          )}

          {errorMsg && (
            <div
              className="mt-4 rounded-lg px-3 py-2.5 text-sm"
              style={{ background: '#fdf1f1', color: '#b91c1c', border: '1px solid #f5d5d5' }}
              role="alert"
            >
              {errorMsg}
            </div>
          )}

          <p className="mt-6 text-xs text-center" style={{ color: 'var(--color-ink-faint)' }}>
            Never share this code with anyone. Confirming this request grants terminal access to your Gregale account.
          </p>
        </div>
      </div>

      {/* Brand Side */}
      <div
        className="relative hidden flex-col justify-center px-12 lg:flex"
        style={{ background: 'var(--color-brand-softer)', borderLeft: '1px solid var(--color-line)' }}
      >
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative max-w-md">
          <span className="badge badge-brand mb-5">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
            Developer-First CLI
          </span>
          <h2 className="text-3xl font-bold leading-tight tracking-tight">
            Deploy microVM workloads in seconds directly from terminal.
          </h2>
          <p className="mt-4 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
            Once authorized, your CLI will store a secure device credential locally. You can deploy functions, monitor logs, and manage secrets with simple terminal commands.
          </p>

          <div
            className="mt-6 rounded-xl p-4 font-mono text-xs leading-relaxed"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-line)',
              color: 'var(--color-ink-soft)',
            }}
          >
            <div className="flex items-center gap-2 mb-2 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80 inline-block" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80 inline-block" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80 inline-block" />
              <span className="ml-2 font-sans font-medium text-[11px]">terminal</span>
            </div>
            <div>
              <span style={{ color: 'var(--color-brand-bright)' }}>$</span> gregale deploy --template hello-node
            </div>
            <div className="mt-1 text-emerald-400 font-medium">✓ Function deployed to https://hello-node.apps.gregale.dev</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CliAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner size={22} />
        </div>
      }
    >
      <CliAuthInner />
    </Suspense>
  );
}
