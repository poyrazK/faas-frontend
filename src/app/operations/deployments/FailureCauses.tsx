'use client';

import React, { useState } from 'react';
import type { FailureCause } from '@/lib/ops/deploymentFailures';
import { relativeTime } from '@/lib/format';
import { SectionCard } from '@/components/ui/Panels';

const COLLAPSED = 5;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Failed deployments grouped by cause, most frequent first, so a repeated
 * failure (a full builder disk, no node that fits) reads as one line with a
 * count instead of a page of near-identical rows. "Show" lists that cause's
 * deployments in the table below.
 */
export function FailureCauses({
  causes,
  total,
  truncated,
  selected,
  onSelect,
}: {
  causes: FailureCause[];
  /** Failed deployments the causes were grouped from. */
  total: number;
  /** apid had more failed deployments than one request returns. */
  truncated: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? causes : causes.slice(0, COLLAPSED);
  return (
    <SectionCard
      className="mb-4"
      title="Failure causes"
      action={
        <span className="text-[11px] text-[var(--color-ink-muted)]">
          {truncated ? `The latest ${total} failed deployments` : plural(total, 'failed deployment')}
        </span>
      }
    >
      <ul className="divide-y divide-[var(--color-line)]">
        {shown.map((cause) => {
          const count = cause.deployments.length;
          const active = cause.id === selected;
          return (
            <li
              key={cause.id}
              className={`flex flex-col gap-2 px-5 py-3 text-xs sm:flex-row sm:items-center sm:gap-4 ${active ? 'bg-[var(--color-surface-subtle)]' : ''}`}
            >
              <span className="text-lg font-semibold leading-none sm:w-10 sm:shrink-0 sm:text-right">{count}</span>
              <span className="min-w-0 flex-1 space-y-0.5">
                {cause.code && <span className="block font-mono text-[var(--color-danger)]">{cause.code}</span>}
                {/* A crash log can run to pages; the tooltip and "Show" have it in full. */}
                <span className="line-clamp-3 break-words font-mono text-[11px]" title={cause.example || undefined}>
                  {cause.message || <span className="font-sans text-[var(--color-ink-muted)]">No error was recorded</span>}
                </span>
                <span className="block text-[var(--color-ink-muted)]">
                  {plural(cause.apps, 'app')} · {plural(cause.accounts, 'account')} · latest {relativeTime(cause.latest)}
                </span>
              </span>
              <button
                type="button"
                className={`btn btn-xs self-start sm:self-center ${active ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={active}
                onClick={() => onSelect(cause.id)}
              >
                {active ? 'Shown below' : `Show ${count === 1 ? 'it' : `all ${count}`}`}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="table-foot">
        <span>Grouped by error code and message; sizes, counts, IDs and times are ignored.</span>
        {causes.length > COLLAPSED && (
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show fewer' : `Show all ${causes.length} causes`}
          </button>
        )}
      </div>
    </SectionCard>
  );
}
