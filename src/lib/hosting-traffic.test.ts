import { afterEach, expect, it, vi } from 'vitest';
import { getHostingTraffic } from './hosting';

afterEach(() => { vi.unstubAllGlobals(); });
it('reads only the selected site with credentials, no-store and a bounded signal', async () => {
  const fetcher = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  await getHostingTraffic('site/a');
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0][0]).toBe('/v1/internal/hosting/sites/site%2Fa/traffic');
  expect(calls[0][1].credentials).toBe('include');
  expect(calls[0][1].cache).toBe('no-store');
  expect(calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
