import { afterEach, expect, it, vi } from 'vitest';
import { getHostingPreviewCapacity, hostingCapacityMatches } from './hosting';

afterEach(() => vi.unstubAllGlobals());
it('reads only the owned internal capacity snapshot without an idempotency key', async () => {
 const fetcher = vi.fn(async () => new Response('{}', {headers: {'Content-Type': 'application/json'}}));
 vi.stubGlobal('fetch', fetcher);
 await getHostingPreviewCapacity('site/escape');
 const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
 expect(calls[0][0]).toBe('/v1/internal/hosting/sites/site%2Fescape/preview-capacity');
 expect(calls[0][1]).toMatchObject({credentials: 'include', cache: 'no-store'});
 expect(calls[0][1].method || 'GET').toBe('GET');
 expect(new Headers(calls[0][1].headers).has('Idempotency-Key')).toBe(false);
});
it('rejects mismatched and inconsistent stored capacity evidence', () => {
 const valid = {site_id: 'site', limit: 8, previews: 2, reservations: 6, available: 0, observed_at: '2026-10-17T12:00:00Z'};
 expect(hostingCapacityMatches(valid, 'site')).toBe(true);
 for (const change of [{site_id: 'other'}, {reservations: 7}, {available: -1}, {previews: 1.5}, {limit: 0}, {observed_at: 'invalid'}]) {
  expect(hostingCapacityMatches({...valid, ...change}, 'site')).toBe(false);
 }
});
