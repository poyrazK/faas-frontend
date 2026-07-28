'use client';

/* ==========================================================================
   Small shared primitives: page headers, status pills, inline code, form
   controls with the template's chrome. Anything that renders a container or
   a panel lives in Panels.tsx instead.
   ========================================================================== */

import React, { useState } from 'react';
import { stateBadge } from '@/lib/format';
import { Icon } from './Icons';

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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-bold leading-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      {copied ? 'Copied' : label}
    </button>
  );
}

/** Inline "code" pill for slugs, ids, digests. */
export function Mono({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <code
      className={`mono rounded px-1.5 py-0.5 text-xs ${className}`}
      style={{ background: 'var(--color-surface-subtle)', border: '1px solid var(--color-line)' }}
    >
      {children}
    </code>
  );
}

/** Search box with the leading magnifier the template puts on every list. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`search-wrap ${className}`}>
      <Icon name="search" size={14} />
      <input
        className="field field-sm"
        style={{ paddingTop: '0.44rem', paddingBottom: '0.44rem' }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Compact filter dropdown ("All Status", "All Types"). */
export function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      className="field field-sm"
      style={{ width: 'auto', paddingRight: '1.75rem' }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The "↑ 12.4%" chip beside a stat. Direction sets the colour, and for error
 * metrics `invert` flips it so a rising error rate reads red, not green.
 */
export function Delta({
  pct,
  direction,
  invert = false,
}: {
  pct: number;
  direction: 'up' | 'down' | 'flat';
  invert?: boolean;
}) {
  if (direction === 'flat') {
    return (
      <span className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>
        no change
      </span>
    );
  }
  const good = invert ? direction === 'down' : direction === 'up';
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium"
      style={{ color: good ? 'var(--color-brand-bright)' : 'var(--color-danger)' }}
    >
      <Icon name={direction === 'up' ? 'arrowUp' : 'arrowDown'} size={11} strokeWidth={2.2} />
      {pct.toFixed(1)}%
    </span>
  );
}

/** Row overflow menu trigger. Kept dumb — pages own the menu contents. */
export function RowMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-end">
      <button className="btn-icon" onClick={() => setOpen((o) => !o)} aria-label="Row actions" aria-expanded={open}>
        <Icon name="dots" size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="card absolute right-0 top-9 z-50 min-w-[160px] overflow-hidden py-1"
            style={{ boxShadow: 'var(--shadow-pop)' }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

export function RowMenuItem({
  onClick,
  danger = false,
  children,
}: {
  onClick?: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-surface-subtle)]"
      style={{ color: danger ? 'var(--color-danger)' : 'var(--color-ink-soft)' }}
    >
      {children}
    </button>
  );
}
