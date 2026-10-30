'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, recoverMfa, setStepUpHandler, verifyMfa } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';

/**
 * Answers the backend's 403 step_up_required on operator writes: asks for a
 * TOTP (or recovery) code, refreshes the session's five-minute step-up stamp,
 * and lets the transport replay the original request with its original
 * Idempotency-Key. Concurrent writes share one prompt.
 */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (ok: boolean) => void } | null>(null);

  const requestStepUp = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current.promise;
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => {
      resolve = r;
    });
    pending.current = { promise, resolve };
    setMode('totp');
    setCode('');
    setError(null);
    setOpen(true);
    return promise;
  }, []);

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
    current?.resolve(ok);
  }, []);

  const cancel = useCallback(() => {
    if (!busy) settle(false);
  }, [busy, settle]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = mode === 'totp' ? code.replace(/\D/g, '') : code.trim().toUpperCase();
    if (mode === 'totp' && value.length !== 6) {
      setError('Enter the six-digit code from your authenticator app.');
      return;
    }
    if (mode === 'recovery' && !value) {
      setError('Enter one of your recovery codes.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'totp') await verifyMfa(value);
      else await recoverMfa(value);
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

  return (
    <>
      {children}
      <Modal open={open} onClose={cancel} title="Confirm it's you" width={420}>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-[var(--color-ink-soft)]">
            Operator changes need a fresh second factor (valid for five minutes). Your pending action resumes
            automatically once the code is accepted.
          </p>
          <label className="block">
            <span className="label">{mode === 'totp' ? 'Authenticator code' : 'Recovery code'}</span>
            <input
              autoFocus
              className="field font-mono tracking-widest"
              inputMode={mode === 'totp' ? 'numeric' : 'text'}
              autoComplete="one-time-code"
              maxLength={mode === 'totp' ? 6 : 64}
              value={code}
              onChange={(event) =>
                setCode(mode === 'totp' ? event.target.value.replace(/\D/g, '').slice(0, 6) : event.target.value)
              }
              placeholder={mode === 'totp' ? '123456' : 'XXXX-XXXX'}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-[var(--color-danger)]">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
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
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={cancel} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                {busy ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
