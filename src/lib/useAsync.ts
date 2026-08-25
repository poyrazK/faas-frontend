'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  reload: () => void;
  setData: (v: T | null) => void;
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

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });
    fetcher()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err as Error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  // Background silent polling
  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    let cancelled = false;

    const timer = setInterval(() => {
      fetcher()
        .then((res) => {
          if (!cancelled) setData(res);
        })
        .catch(() => {});
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollIntervalMs, ...deps]);

  return { data, loading, error, reload, setData };
}
