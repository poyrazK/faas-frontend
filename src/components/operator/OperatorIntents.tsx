'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  getOperatorIntent,
  TERMINAL_INTENT_STATUSES,
  type OperatorIntentResponse,
  type OperatorIntentStatus,
} from '@/lib/api';

/**
 * Operator writes that act on running infrastructure (force park/restart/cold
 * boot, node drain/activate/retire) are accepted as intents and converge
 * asynchronously. This provider follows each one to a terminal state, keeps
 * the list across page navigation and reloads (sessionStorage), and records
 * polling failures on the row instead of hiding them.
 */
export interface TrackedIntent {
  intentId: string;
  kind: string;
  /** Human label of the target: instance id, app slug, node name. */
  target: string;
  status: OperatorIntentStatus;
  requestedAt: string;
  detail?: OperatorIntentResponse;
  pollError?: string;
  lastCheckedAt?: string;
}

interface OperatorIntentsApi {
  intents: TrackedIntent[];
  track: (intent: { intentId: string; kind: string; target: string }) => void;
  dismiss: (intentId: string) => void;
  clearFinished: () => void;
}

const STORAGE_KEY = 'gregale.ops.intents.v1';
const POLL_MS = 2000;
const MAX_TRACKED = 50;

const IntentsCtx = createContext<OperatorIntentsApi | null>(null);

export const isTerminalIntent = (status: OperatorIntentStatus) => TERMINAL_INTENT_STATUSES.includes(status);

function load(): TrackedIntent[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TrackedIntent[]) : [];
  } catch {
    return [];
  }
}

function save(intents: TrackedIntent[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intents));
  } catch {
    /* storage unavailable (private mode): tracking still works for this page */
  }
}

export function OperatorIntentsProvider({ children }: { children: React.ReactNode }) {
  const [intents, setIntents] = useState<TrackedIntent[]>([]);
  const intentsRef = useRef(intents);
  const hydrated = useRef(false);

  useEffect(() => {
    queueMicrotask(() => {
      setIntents(load());
      hydrated.current = true;
    });
  }, []);

  useEffect(() => {
    intentsRef.current = intents;
    if (hydrated.current) save(intents);
  }, [intents]);

  const hasPending = intents.some((intent) => !isTerminalIntent(intent.status));

  useEffect(() => {
    if (!hasPending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const pending = intentsRef.current.filter((intent) => !isTerminalIntent(intent.status));
      const results = await Promise.all(
        pending.map(async (intent) => {
          try {
            return { id: intent.intentId, detail: await getOperatorIntent(intent.intentId) };
          } catch (err) {
            return { id: intent.intentId, error: (err as Error).message };
          }
        }),
      );
      if (cancelled) return;
      const checkedAt = new Date().toISOString();
      setIntents((current) =>
        current.map((intent) => {
          const result = results.find((r) => r.id === intent.intentId);
          if (!result) return intent;
          if ('detail' in result && result.detail) {
            return { ...intent, status: result.detail.status, detail: result.detail, pollError: undefined, lastCheckedAt: checkedAt };
          }
          return { ...intent, pollError: result.error, lastCheckedAt: checkedAt };
        }),
      );
      // Skip ticks while the tab is hidden; the next visible tick catches up.
      timer = setTimeout(tick, POLL_MS);
    };

    const tick = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      void poll();
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasPending]);

  const track = useCallback((intent: { intentId: string; kind: string; target: string }) => {
    setIntents((current) =>
      [
        { ...intent, status: 'pending' as const, requestedAt: new Date().toISOString() },
        ...current.filter((existing) => existing.intentId !== intent.intentId),
      ].slice(0, MAX_TRACKED),
    );
  }, []);

  const dismiss = useCallback((intentId: string) => {
    setIntents((current) => current.filter((intent) => intent.intentId !== intentId));
  }, []);

  const clearFinished = useCallback(() => {
    setIntents((current) => current.filter((intent) => !isTerminalIntent(intent.status)));
  }, []);

  const api = useMemo(() => ({ intents, track, dismiss, clearFinished }), [intents, track, dismiss, clearFinished]);
  return <IntentsCtx.Provider value={api}>{children}</IntentsCtx.Provider>;
}

export function useOperatorIntents(): OperatorIntentsApi {
  const ctx = useContext(IntentsCtx);
  if (!ctx) throw new Error('useOperatorIntents must be used inside <OperatorIntentsProvider>');
  return ctx;
}

const STATUS_BADGE: Record<OperatorIntentStatus, string> = {
  pending: 'badge-neutral',
  running: 'badge-warning',
  succeeded: 'badge-success',
  failed: 'badge-danger',
  cancelled: 'badge-neutral',
  outcome_unknown: 'badge-warning',
};

export function IntentStatusBadge({ status }: { status: OperatorIntentStatus }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? 'badge-neutral'}`}>{status.replace('_', ' ')}</span>;
}

/** Plain-language result of a finished (or stuck) intent. */
export function intentOutcome(intent: TrackedIntent): string {
  const detail = intent.detail;
  if (intent.pollError && !isTerminalIntent(intent.status)) return `Status check failing: ${intent.pollError}`;
  if (detail?.error) return detail.error;
  switch (intent.status) {
    case 'pending':
      return 'Queued for the scheduler.';
    case 'running':
      return detail?.park_execution ? `Park phase: ${detail.park_execution.phase}` : 'In progress.';
    case 'succeeded':
      if (detail?.park_execution?.cold_boot_required) return 'Parked; the next wake will cold boot.';
      if (detail?.snap_ids_marked_stale?.length) return `${detail.snap_ids_marked_stale.length} snapshot(s) marked stale.`;
      if (detail?.cold_boot_generation) return `Cold-boot generation ${detail.cold_boot_generation} published.`;
      return 'Completed.';
    case 'cancelled':
      return 'Cancelled before it ran.';
    case 'outcome_unknown':
      return 'The worker lost track of this action. Check the target before retrying.';
    default:
      return 'Failed.';
  }
}
