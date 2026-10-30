'use client';

import React from 'react';
import type { PublicStatusEvent } from '@/lib/ops/status';
import { IMPACT_LABELS, placementText, publicCard, publicPlacement, publicTimeline } from '@/lib/ops/status-events';

/**
 * What customers will read: the overview card and the permalink timeline,
 * in the public page's wording (faas-web status-page.tsx), with the times in
 * UTC as the public page shows them. A content preview, not a pixel copy.
 */
export function StatusPreview({
  event,
  live = [],
  highlightUpdateId,
  now,
}: {
  event: PublicStatusEvent;
  live?: readonly { id: string; name: string }[];
  /** The timeline entry this write adds or changes. */
  highlightUpdateId?: string;
  now?: Date;
}) {
  const card = publicCard(event, live);
  const compact = publicPlacement(event, now) === 'history';
  const timeline = publicTimeline(event);
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Overview card</div>
        <div className="flex items-center justify-between gap-2">
          <span className="badge badge-neutral">{card.kindLabel}</span>
          <span className="text-[var(--color-ink-muted)]">{card.when}</span>
        </div>
        <div className="mt-2 text-sm font-semibold">{card.title}</div>
        {!compact && card.message && <p className="mt-1 whitespace-pre-wrap">{card.message}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <strong>{card.stateLabel}</strong>
          <span className="text-[var(--color-ink-muted)]">{card.components}</span>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Permalink page</div>
        <div className="text-sm font-semibold">{card.title}</div>
        <div className="text-[var(--color-ink-muted)]">
          {card.kindLabel} · {card.stateLabel} · Affected services: {card.components}
        </div>
        <ol className="mt-2 space-y-2 border-l border-[var(--color-line)] pl-3">
          {timeline.map((entry) => (
            <li
              key={entry.id}
              className={entry.id === highlightUpdateId ? 'rounded bg-[var(--color-warning-subtle)] p-1.5' : undefined}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <strong>{entry.state}</strong>
                <span className="text-[var(--color-ink-muted)]">{entry.when}</span>
              </div>
              <p className="whitespace-pre-wrap">{entry.message}</p>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-[var(--color-ink-muted)]">
        {placementText(event, now)} Impact recorded: {IMPACT_LABELS[event.impact] ?? event.impact}.
      </p>
    </div>
  );
}
