'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { requestPasswordReset, ApiError } from '@/lib/api';
import { Spinner } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icons';

function OperationsLoginInner() {
  const { account, loading, signIn, signUp } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/operations/overview';

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error' | 'sent'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!loading && account) {
      router.replace(next);
    }
  }, [loading, account, next, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('submitting');
    setMessage('');

    try {
      if (mode === 'forgot') {
        await requestPasswordReset(email.trim());
        setStatus('sent');
        setMessage('If that operator address is registered, a password reset link has been dispatched.');
        return;
      }

      const acct = mode === 'signup'
        ? await signUp(email.trim(), password)
        : await signIn(email.trim(), password);

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
            ? 'Failed to create operator account. Please verify credentials.'
            : 'Invalid credentials. Operator access requires registration in FAAS_ADMIN_EMAILS.',
      );
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070a12] p-4 text-slate-100 selection:bg-cyan-500/30">
      <div className="w-full max-w-md">
        {/* Top Branding Card */}
        <div className="rounded-2xl border border-slate-800 bg-[#090d16]/90 p-8 shadow-[0_0_50px_rgba(6,182,212,0.06)] backdrop-blur-xl">
          <div className="text-center">
            <div className="flex justify-center">
              <Image
                src="/gregale-logo-green-trans.png"
                alt="Gregale"
                width={140}
                height={35}
                style={{ height: 30, width: 'auto' }}
                priority
              />
            </div>

            <div className="mt-4 flex items-center justify-center gap-2">
              <span className="rounded bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-400 border border-cyan-500/30">
                Mission Control
              </span>
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-emerald-400 border border-emerald-500/30">
                Operations Portal
              </span>
            </div>

            <h1 className="mt-4 text-xl font-bold tracking-tight text-white">
              {mode === 'signup'
                ? 'Register Operator Account'
                : mode === 'forgot'
                  ? 'Operator Password Reset'
                  : 'Operator Authentication'}
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              Access is restricted to addresses listed in{' '}
              <code className="font-mono text-cyan-300">FAAS_ADMIN_EMAILS</code>
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">
                Operator Email Address
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@gregale.dev"
                className="w-full rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">
                    Master Password
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot');
                        setMessage('');
                        setStatus('idle');
                      }}
                      className="text-[11px] text-cyan-400 hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 pr-10 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
                  >
                    <Icon name={showPassword ? 'x' : 'user'} size={14} />
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {status === 'submitting' && <Spinner size={16} />}
              <span>
                {status === 'submitting'
                  ? 'Verifying Operator…'
                  : mode === 'signup'
                    ? 'Create Operator Account'
                    : mode === 'forgot'
                      ? 'Dispatch Reset Link'
                      : 'Access Mission Control'}
              </span>
            </button>
          </form>

          {/* Feedback message */}
          {message && (
            <div
              className={`mt-4 rounded-lg p-3 text-xs ${
                status === 'error'
                  ? 'border border-red-500/30 bg-red-950/40 text-red-300'
                  : 'border border-emerald-500/30 bg-emerald-950/40 text-emerald-300'
              }`}
            >
              {message}
            </div>
          )}

          {/* Toggle Signin / Signup */}
          <div className="mt-6 border-t border-slate-800 pt-4 text-center text-xs text-slate-400">
            {mode === 'signin' ? (
              <span>
                First-time operator setup?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setMessage('');
                    setStatus('idle');
                  }}
                  className="font-semibold text-cyan-400 hover:underline"
                >
                  Create account
                </button>
              </span>
            ) : (
              <span>
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setMessage('');
                    setStatus('idle');
                  }}
                  className="font-semibold text-cyan-400 hover:underline"
                >
                  Sign in
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Bottom Switch Link */}
        <div className="mt-4 text-center">
          <a
            href="https://gregale.dev/login"
            className="text-xs text-slate-500 hover:text-slate-400 transition-colors"
          >
            ← Switch to Developer Console Login (gregale.dev)
          </a>
        </div>
      </div>
    </div>
  );
}

export default function OperationsLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#070a12]">
          <Spinner size={24} />
        </div>
      }
    >
      <OperationsLoginInner />
    </Suspense>
  );
}
