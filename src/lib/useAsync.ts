'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from './api';

export interface AsyncOptions<T> {
  /**
   * Polls only while this holds for the last answer; checked at each tick, so
   * turning polling on or off never costs a read of its own. For audited
   * reads that only need refreshing while something is in flight.
   */
  pollWhile?: (data: T | null) => boolean;
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  reload: () => void;
  setData: (v: T | null) => void;
  lastSuccessAt: number | null;
  stale: boolean;
}

/**
 * Runs an async fetcher on mount (and whenever `deps` change), exposing
 * loading / error / data plus a manual `reload`. The backbone of every
 * dashboard page so each one gets honest loading and error states.
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  pollIntervalMs?: number,
  options: AsyncOptions<T> = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  // The timer reads these at each tick instead of restarting when they change.
  const latest = useRef({ data, pollWhile: options.pollWhile });
  useEffect(() => {
    latest.current = { data, pollWhile: options.pollWhile };
  });

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
      }
    });
    const refresh = () => {
      setNow(Date.now());
      if (inFlight) return;
      inFlight = true;
      Promise.resolve().then(fetcher)
        .then((res) => {
          if (!cancelled) {
            const succeededAt = Date.now();
            setData(res);
            setError(null);
            setLastSuccessAt(succeededAt);
            setNow(succeededAt);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err as Error);
        })
        .finally(() => {
          inFlight = false;
          if (!cancelled) setLoading(false);
        });
    };
    queueMicrotask(() => { if (!cancelled) refresh(); });
    // Polls pause while the tab is hidden: several admin list reads are
    // audited as an operator viewing the account, so a background tab must
    // not keep recording views nobody made. Coming back refreshes at once.
    const hidden = () => typeof document !== 'undefined' && document.hidden;
    const wanted = () => {
      const { data: last, pollWhile } = latest.current;
      return !pollWhile || pollWhile(last);
    };
    let missedTick = false;
    const tick = () => {
      if (!wanted()) return;
      if (hidden()) {
        missedTick = true;
        return;
      }
      refresh();
    };
    const onVisible = () => {
      if (!hidden() && missedTick) {
        missedTick = false;
        refresh();
      }
    };
    const polling = !!pollIntervalMs && pollIntervalMs > 0;
    const timer = polling ? setInterval(tick, pollIntervalMs) : null;
    if (polling && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
      if (polling && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, pollIntervalMs, ...deps]);

  const polling = !!pollIntervalMs && (!options.pollWhile || options.pollWhile(data));
  const stale = data !== null && (error !== null || (polling && lastSuccessAt !== null && now - lastSuccessAt > 2 * pollIntervalMs));
  return { data, loading, error, reload, setData, lastSuccessAt, stale };
}
