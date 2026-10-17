import { afterEach, expect, it, vi } from 'vitest';
import { cancelHostingCIRun } from './hosting';

afterEach(() => vi.unstubAllGlobals());
it('cancels only the exact run using operator session auth without a replay key', async () => {
 const fetcher = vi.fn(async () => new Response('{}', {headers: {'Content-Type': 'application/json'}}));
 vi.stubGlobal('fetch', fetcher);
 await cancelHostingCIRun('site/escape', 'run/escape');
 const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
 expect(calls[0][0]).toBe('/v1/internal/hosting/sites/site%2Fescape/ci/run%2Fescape/cancel');
 expect(calls[0][1]).toMatchObject({method: 'POST', credentials: 'include', cache: 'no-store'});
 expect(new Headers(calls[0][1].headers).has('Idempotency-Key')).toBe(false);
});
it('does not automatically retry protected or uncertain cancellation', async () => {
 const fetcher = vi.fn(async () => new Response(JSON.stringify({detail: 'Run protected.'}), {status: 409, headers: {'Content-Type': 'application/json'}}));
 vi.stubGlobal('fetch', fetcher);
 await expect(cancelHostingCIRun('site', 'run')).rejects.toMatchObject({status: 409});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
