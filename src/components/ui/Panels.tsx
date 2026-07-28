'use client';

/* ==========================================================================
   Containers: stat tiles, section cards, table footers, and the "no backend
   for this yet" panel.

   `Unavailable` matters more than it looks. The template's sidebar advertises
   surfaces the control plane has no endpoint for (object storage, managed
   databases, distributed traces, alert rules, PDF invoices). Rather than
   inventing numbers for those pages, they render this panel: the real chrome,
   an explicit statement that the data isn't wired yet, and the API surface a
   reader would need to look for once it is.
   ========================================================================== */

import React from 'react';
import Link from 'next/link';
import { Icon, type IconName } from './Icons';
import { Sparkline } from './Chart';
import { Delta } from './bits';
import type { Point } from '@/lib/series';

/* ────────────────────────────── Stat tile ─────────────────────────────── */

export function StatTile({
  label,
  value,
  sub,
  series,
  trend,
  invertTrend = false,
  color = 'var(--color-chart)',
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  series?: Point[];
  trend?: { pct: number; direction: 'up' | 'down' | 'flat' } | null;
  invertTrend?: boolean;
  color?: string;
}) {
  return (
    <div className="card p-5">
      <div className="text-[13px] font-medium" style={{ color: 'var(--color-ink-muted)' }}>
        {label}
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-bold leading-none tracking-tight">{value}</span>
            {trend && <Delta {...trend} invert={invertTrend} />}
          </div>
          {sub && (
            <div className="mt-2 truncate text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              {sub}
            </div>
          )}
        </div>
        {series && series.length > 1 && (
          <div className="w-24 shrink-0 sm:w-28">
            <Sparkline points={series} height={38} color={color} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Section card ───────────────────────────── */

export function SectionCard({
  title,
  action,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`card overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2 className="card-title">{title}</h2> : title}
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

/* ──────────────────────────── Table footer ────────────────────────────── */

/**
 * "Showing 1 to 8 of 8 workflows" plus the pager. Pass `page`/`onPage` only
 * when the caller actually paginates; otherwise the arrows are omitted.
 */
export function TableFooter({
  from,
  to,
  total,
  noun,
  page,
  pageCount,
  onPage,
}: {
  from: number;
  to: number;
  total: number;
  noun: string;
  page?: number;
  pageCount?: number;
  onPage?: (p: number) => void;
}) {
  const paged = page != null && pageCount != null && onPage != null;
  return (
    <div className="table-foot">
      <span>
        {total === 0 ? `No ${noun}` : `Showing ${from} to ${to} of ${total} ${noun}`}
      </span>
      {paged && pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button
            className="btn-icon btn-icon-bordered"
            style={{ width: 28, height: 28 }}
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <Icon name="chevronLeft" size={14} />
          </button>
          <span
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-2 text-xs font-medium"
            style={{ border: '1px solid var(--color-line)', color: 'var(--color-ink)' }}
          >
            {page}
          </span>
          <button
            className="btn-icon btn-icon-bordered"
            style={{ width: 28, height: 28 }}
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Unavailable panel ────────────────────────── */

/**
 * Honest placeholder for a template surface the backend doesn't serve.
 * `endpoint` names what a future implementation would call, so this doubles
 * as a to-do list for whoever wires the feature up.
 */
export function Unavailable({
  icon,
  title,
  what,
  endpoint,
  alternative,
}: {
  icon: IconName;
  title: string;
  what: string;
  endpoint?: string;
  alternative?: { href: string; label: string };
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-xl"
        style={{ background: 'var(--color-surface-subtle)', color: 'var(--color-ink-muted)' }}
      >
        <Icon name={icon} size={22} />
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm" style={{ color: 'var(--color-ink-muted)' }}>
        {what}
      </p>
      <span className="badge badge-muted mt-4">Not available yet</span>
      {endpoint && (
        <p className="mt-3 max-w-md text-xs" style={{ color: 'var(--color-ink-faint)' }}>
          The control plane exposes no {endpoint} endpoint today — this page will light up when it does.
        </p>
      )}
      {alternative && (
        <Link href={alternative.href} className="btn btn-secondary mt-5">
          {alternative.label}
          <Icon name="arrowRight" size={14} />
        </Link>
      )}
    </div>
  );
}

/* ─────────────────────── Horizontal distribution bar ──────────────────── */

/** The "Region Usage" / breakdown rows: label, meter, right-aligned value. */
export function MeterRow({
  label,
  value,
  pct,
  color = 'var(--color-brand)',
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  pct: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 truncate text-sm" style={{ color: 'var(--color-ink-soft)' }}>
        {label}
      </span>
      <span className="meter flex-1">
        <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </span>
      <span className="w-14 shrink-0 text-right text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
        {value}
      </span>
    </div>
  );
}
