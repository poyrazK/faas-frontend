import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAsync, type AsyncState } from './useAsync';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('operator snapshot refresh', () => {
  let renderer: ReactTestRenderer | undefined;
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.useRealTimers();
  });

  it('preserves the last observation, reports a failed poll, and recovers on success', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const fetcher = vi.fn<() => Promise<number>>().mockResolvedValueOnce(7).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(9);
    let snapshot: AsyncState<number>;
    function Probe() { snapshot = useAsync(fetcher, [], 1000); return null; }
    await act(async () => { renderer = create(React.createElement(Probe)); });
    expect(snapshot!.data).toBe(7);
    const observedAt = snapshot!.lastSuccessAt;
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(snapshot!.data).toBe(7);
    expect(snapshot!.error?.message).toBe('offline');
    expect(snapshot!.stale).toBe(true);
    expect(snapshot!.lastSuccessAt).toBe(observedAt);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(snapshot!.data).toBe(9);
    expect(snapshot!.error).toBeNull();
    expect(snapshot!.stale).toBe(false);
    expect(snapshot!.lastSuccessAt).toBeGreaterThan(observedAt!);
  });

  it('marks overdue data stale and avoids overlapping polls', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const fetcher = vi.fn<() => Promise<number>>().mockResolvedValueOnce(7).mockImplementation(() => new Promise(() => {}));
    let snapshot: AsyncState<number>;
    function Probe() { snapshot = useAsync(fetcher, [], 1000); return null; }
    await act(async () => { renderer = create(React.createElement(Probe)); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(snapshot!.data).toBe(7);
    expect(snapshot!.stale).toBe(true);
  });
});
