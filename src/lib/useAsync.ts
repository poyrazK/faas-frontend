'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiError } from './api';

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
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

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
    const timer = pollIntervalMs && pollIntervalMs > 0 ? setInterval(refresh, pollIntervalMs) : null;
    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, pollIntervalMs, ...deps]);

  const stale = data !== null && (error !== null || (!!pollIntervalMs && lastSuccessAt !== null && now - lastSuccessAt > 2 * pollIntervalMs));
  return { data, loading, error, reload, setData, lastSuccessAt, stale };
}
