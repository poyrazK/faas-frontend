'use client';

import React from 'react';
import { TICKET_STATUS_LABELS } from '@/lib/ops/supportInbox';
import { Mono } from '@/components/ui/bits';
import { shortId } from '@/components/operator/EntityId';

export function StatusBadge({ status }: { status: string }) {
  const tone = status === 'open' ? 'badge-warning' : status === 'pending' ? 'badge-info' : 'badge-neutral';
  return <span className={`badge ${tone}`}>{TICKET_STATUS_LABELS[status] ?? status}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const tone = priority === 'urgent' ? 'badge-danger' : priority === 'high' ? 'badge-warning' : 'badge-neutral';
  return <span className={`badge ${tone}`}>{priority}</span>;
}

export function Assignee({ id, me }: { id?: string; me?: string }) {
  if (!id) return <span className="text-[var(--color-ink-muted)]">Unassigned</span>;
  if (me && id.replaceAll('-', '') === me.replaceAll('-', '')) return <span className="font-medium">You</span>;
  return (
    <span title={id}>
      <Mono>{shortId(id)}</Mono>
    </span>
  );
}
