'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  confirmMfa,
  enrollMfa,
  needsEnrollment,
  recoverMfa,
  setStepUpHandler,
  verifyMfa,
  type MfaEnrollment,
} from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { CopyButton } from '@/components/ui/bits';

type Mode = 'totp' | 'recovery' | 'enroll';

/**
 * Answers apid's second-factor gates on operator requests, then lets the
 * transport replay the original request with its original Idempotency-Key:
 * - step_up_required: the code is older than five minutes → enter a code;
 * - mfa_required on an mfa_pending session → enter a code (or set one up);
 * - mfa_required for an operator with no authenticator → enroll one here
 *   (QR code, secret, recovery codes), then confirm with a first code.
 * Concurrent requests share one prompt.
 */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('totp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (ok: boolean) => void } | null>(null);

  const startEnrollment = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await enrollMfa();
      setEnrollment(result);
      setSavedCodes(false);
      setCode('');
      setMode('enroll');
    } catch (err) {
      // 409: an authenticator is already enrolled; a code is what's needed.
      if (err instanceof ApiError && err.status === 409) setMode('totp');
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const requestStepUp = useCallback(
    (reason: ApiError): Promise<boolean> => {
      if (pending.current) return pending.current.promise;
      let resolve!: (ok: boolean) => void;
      const promise = new Promise<boolean>((r) => {
        resolve = r;
      });
      pending.current = { promise, resolve };
      setCode('');
      setError(null);
      setEnrollment(null);
      setMode('totp');
      setOpen(true);
      if (needsEnrollment(reason)) void startEnrollment();
      return promise;
    },
    [startEnrollment],
  );

  useEffect(() => {
    setStepUpHandler(requestStepUp);
    return () => setStepUpHandler(null);
  }, [requestStepUp]);

  const settle = useCallback((ok: boolean) => {
    const current = pending.current;
    pending.current = null;
    setOpen(false);
    setBusy(false);
    setCode('');
    setEnrollment(null);
    current?.resolve(ok);
  }, []);

  const cancel = useCallback(() => {
    if (!busy) settle(false);
  }, [busy, settle]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const digits = code.replace(/\D/g, '');
    if ((mode === 'totp' || mode === 'enroll') && digits.length !== 6) {
      setError('Enter the six-digit code from your authenticator app.');
      return;
    }
    if (mode === 'recovery' && !code.trim()) {
      setError('Enter one of your recovery codes.');
      return;
    }
    if (mode === 'enroll' && !savedCodes) {
      setError('Save your recovery codes first; they are shown only once.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'totp') await verifyMfa(digits);
      else if (mode === 'enroll') await confirmMfa(digits);
      else await recoverMfa(code.trim().toUpperCase());
      settle(true);
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof ApiError && err.status === 401
          ? 'That code was not accepted. Wait for the next code and try again.'
          : (err as Error).message,
      );
    }
  };

  const title = mode === 'enroll' ? 'Set up your authenticator' : "Confirm it's you";

  return (
    <>
      {children}
      <Modal open={open} onClose={cancel} title={title} width={mode === 'enroll' ? 520 : 420}>
        <form onSubmit={submit} className="space-y-4">
          {mode === 'enroll' ? (
            !enrollment ? (
              <p className="text-sm text-[var(--color-ink-soft)]">
                {busy ? 'Preparing a new authenticator…' : 'Platform operators need an authenticator app before they can act.'}
              </p>
            ) : (
              <EnrollmentSteps enrollment={enrollment} saved={savedCodes} onSaved={setSavedCodes} />
            )
          ) : (
            <p className="text-sm text-[var(--color-ink-soft)]">
              Operator changes need a fresh second factor (valid for five minutes). Your pending action resumes
              automatically once the code is accepted.
            </p>
          )}

          {(mode !== 'enroll' || enrollment) && (
            <label className="block">
              <span className="label">
                {mode === 'recovery' ? 'Recovery code' : mode === 'enroll' ? 'First code from the app' : 'Authenticator code'}
              </span>
              <input
                autoFocus
                className="field font-mono tracking-widest"
                inputMode={mode === 'recovery' ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                maxLength={mode === 'recovery' ? 64 : 6}
                value={code}
                onChange={(event) =>
                  setCode(mode === 'recovery' ? event.target.value : event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder={mode === 'recovery' ? 'XXXX-XXXX' : '123456'}
              />
            </label>
          )}

          {error && (
            <p role="alert" className="text-xs text-[var(--color-danger)]">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col items-start gap-1">
              {mode !== 'enroll' && (
                <button
                  type="button"
                  className="text-xs text-[var(--color-ink-muted)] underline-offset-2 hover:underline"
                  onClick={() => {
                    setMode((m) => (m === 'totp' ? 'recovery' : 'totp'));
                    setCode('');
                    setError(null);
                  }}
                >
                  {mode === 'totp' ? 'Use a recovery code' : 'Use authenticator app'}
                </button>
              )}
              {mode === 'totp' && (
                <button
                  type="button"
                  className="text-xs text-[var(--color-ink-muted)] underline-offset-2 hover:underline"
                  onClick={() => void startEnrollment()}
                  disabled={busy}
                >
                  No authenticator yet? Set one up
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={cancel} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || (mode === 'enroll' && !enrollment)}>
                {busy ? 'Verifying…' : mode === 'enroll' ? 'Confirm and continue' : 'Verify'}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}

function EnrollmentSteps({
  enrollment,
  saved,
  onSaved,
}: {
  enrollment: MfaEnrollment;
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        {enrollment.qr_code_png_base64 && (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URI from apid, not a remote image
          <img
            src={`data:image/png;base64,${enrollment.qr_code_png_base64}`}
            alt="QR code for your authenticator app"
            width={160}
            height={160}
            className="rounded-lg border border-[var(--color-line)] bg-white p-1"
          />
        )}
        <div className="min-w-0 space-y-2 text-xs text-[var(--color-ink-soft)]">
          <p>1. Scan the code with an authenticator app (1Password, Authy, Google Authenticator…).</p>
          <p>Can&apos;t scan? Enter this secret instead:</p>
          <div className="flex items-center gap-2">
            <code className="break-all rounded bg-[var(--color-surface-subtle)] px-2 py-1 font-mono text-[11px]">
              {enrollment.secret}
            </code>
            <CopyButton value={enrollment.secret} label="Copy" />
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-[#f2e2bd] bg-[var(--color-warning-subtle)] p-3 text-xs">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-semibold text-[var(--color-warning-bold)]">2. Save your recovery codes — shown only once</span>
          <CopyButton value={enrollment.recovery_codes.join('\n')} label="Copy all" />
        </div>
        <ul className="grid grid-cols-2 gap-1 font-mono">
          {enrollment.recovery_codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <label className="mt-3 flex items-center gap-2">
          <input type="checkbox" checked={saved} onChange={(event) => onSaved(event.target.checked)} />
          <span>I have stored these somewhere safe</span>
        </label>
      </div>
      <p className="text-xs text-[var(--color-ink-soft)]">3. Enter the first code your app shows to finish.</p>
    </div>
  );
}
