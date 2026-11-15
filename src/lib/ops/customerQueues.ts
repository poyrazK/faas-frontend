'use client';

/* ==========================================================================
   The two customer queues an operator should notice without opening them:
   open stuck-customer signals and this operator's unread support updates.
   Both refresh every minute while the tab is visible. A queue the operator
   cannot read (not on the support roster, or an older apid) is null, so the
   console hides it instead of showing 0.
   ========================================================================== */

import { useEffect, useState } from 'react';
import { ATTENTION_LIST_MAX, listAttention } from './accountHealth';
import { getSupportNotifications } from './supportInbox';

export const CUSTOMER_QUEUES_POLL_MS = 60_000;

export interface StuckCount {
  signals: number;
  accounts: number;
  /** The list is capped; there may be more. */
  capped: boolean;
}

export interface CustomerQueues {
  stuck: StuckCount | null;
  unread: number | null;
}

export async function loadStuckCount(): Promise<StuckCount> {
  const res = await listAttention({ state: 'open', limit: ATTENTION_LIST_MAX });
  return {
    signals: res.items.length,
    accounts: new Set(res.items.map((s) => s.account_id)).size,
    capped: res.items.length >= (res.limit || ATTENTION_LIST_MAX),
  };
}

export const loadUnreadSupport = async () => (await getSupportNotifications(true)).unread_count;

/** "200+" when the list was capped. */
export const formatStuck = (s: StuckCount) => `${s.signals}${s.capped ? '+' : ''}`;

export function useCustomerQueues(enabled = true): CustomerQueues {
  const [queues, setQueues] = useState<CustomerQueues>({ stuck: null, unread: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      const [stuck, unread] = await Promise.allSettled([loadStuckCount(), loadUnreadSupport()]);
      if (cancelled) return;
      setQueues((current) => ({
        // A failed refresh keeps the last good count.
        stuck: stuck.status === 'fulfilled' ? stuck.value : current.stuck,
        unread: unread.status === 'fulfilled' ? unread.value : current.unread,
      }));
    };
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, CUSTOMER_QUEUES_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return queues;
}
