'use client';

import React, { useRef, useState } from 'react';
import { ApiError } from '@/lib/api';

/** Labelled input with an optional hint; `mono` for IDs and hashes. */
export function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono = false,
  disabled = false,
  inputMode,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  mono?: boolean;
  disabled?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
}) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`field field-sm ${mono ? 'font-mono' : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        inputMode={inputMode}
        maxLength={maxLength}
      />
      {hint && <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{hint}</p>}
    </div>
  );
}

/**
 * Server preview for a request body. The result is bound to the exact body
 * it was computed for: editing any input makes it outdated, and a response
 * for an older body is ignored.
 */
export function usePreview<Body, Result>(body: Body | null, run: (body: Body) => Promise<Result>) {
  const fingerprint = body === null ? null : JSON.stringify(body);
  const seq = useRef(0);
  const [preview, setPreview] = useState<{ fingerprint: string; result: Result } | null>(null);
  const [error, setError] = useState<{ fingerprint: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const runPreview = async () => {
    if (body === null || fingerprint === null) return;
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const result = await run(body);
      if (mine === seq.current) setPreview({ fingerprint, result });
    } catch (err) {
      if (mine === seq.current) setError({ fingerprint, message: (err as Error).message });
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };

  const reset = () => {
    seq.current += 1;
    setPreview(null);
    setError(null);
    setBusy(false);
  };

  return {
    fingerprint,
    /** The preview for the current inputs, or null. */
    result: preview && preview.fingerprint === fingerprint ? preview.result : null,
    /** A preview exists but the inputs changed since. */
    outdated: preview !== null && preview.fingerprint !== fingerprint,
    error: error && error.fingerprint === fingerprint ? error.message : null,
    busy,
    runPreview,
    reset,
  };
}

/** Turns the apply endpoints' conflict answers into the next step for the operator. */
export function applyError(err: unknown, conflict: string): Error {
  if (err instanceof ApiError && err.status === 409) return new Error(`${conflict} (${err.message})`);
  return err as Error;
}

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-ink-soft)]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-surface-subtle)] text-[11px]">
          {n}
        </span>
        {title}
      </div>
      {children}
    </div>
  );
}

export function Kv({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'danger' | 'success' }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--color-ink-muted)]">{label}</div>
      <div
        className={`mt-0.5 truncate font-mono text-xs font-semibold ${
          tone === 'danger' ? 'text-[var(--color-danger)]' : tone === 'success' ? 'text-[var(--color-brand-bright)]' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}
