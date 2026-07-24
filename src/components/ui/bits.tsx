'use client';

import React, { useState } from 'react';
import { stateBadge } from '@/lib/format';

export function StatusBadge({ state }: { state: string }) {
  const b = stateBadge(state);
  return (
    <span className={`badge ${b.cls}`}>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${b.live ? 'live-dot' : ''}`}
        style={{ background: 'currentColor' }}
      />
      {b.label}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}

/** Inline "code" pill for slugs, ids, digests. */
export function Mono({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <code
      className={`mono text-xs rounded px-1.5 py-0.5 ${className}`}
      style={{ background: 'var(--color-surface-subtle)', border: '1px solid var(--color-line)' }}
    >
      {children}
    </code>
  );
}
