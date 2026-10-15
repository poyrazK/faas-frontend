'use client';

import { useCallback, useEffect, useState } from 'react';

// Serial polling surfaces stale data and stops on unmount; a failed refresh
// must never leave release controls enabled against an apparently fresh row.
export function useHostingQuery<T>(fetcher: (signal: AbortSignal) => Promise<T>, interval = 10000) {
  const [state, setState] = useState<{ data: T | null; error: Error | null; observedAt: string | null }>({ data: null, error: null, observedAt: null });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await fetcher(controller.signal);
        if (!controller.signal.aborted) setState({ data, error: null, observedAt: new Date().toISOString() });
      } catch (error) {
        if (!controller.signal.aborted) setState((current) => ({ ...current, error: error instanceof Error ? error : new Error('Could not refresh hosting data.') }));
      } finally {
        if (!controller.signal.aborted && interval > 0) timer = setTimeout(poll, interval);
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [fetcher, interval, nonce]);
  return { ...state, refresh };
}
