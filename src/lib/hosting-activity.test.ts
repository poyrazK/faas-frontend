import { afterEach, expect, it, vi } from 'vitest';
import { listHostingActivity } from './hosting';

afterEach(() => vi.unstubAllGlobals());
it('reads one explicit page through the authenticated internal route without idempotency or mutations', async () => {
 const fetcher = vi.fn(async () => new Response('{}', {headers: {'Content-Type': 'application/json'}}));
 vi.stubGlobal('fetch', fetcher);
 const controller = new AbortController();
 await listHostingActivity('site/escape', 'cursor+?&', controller.signal);
 const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
 expect(calls[0][0]).toBe('/v1/internal/hosting/sites/site%2Fescape/runs?before=cursor%2B%3F%26');
 expect(calls[0][1]).toMatchObject({credentials: 'include', cache: 'no-store'});
 expect(calls[0][1].method || 'GET').toBe('GET');
 expect(calls[0][1].body).toBeUndefined();
 expect(new Headers(calls[0][1].headers).get('Idempotency-Key')).toBeNull();
 controller.abort(); expect(calls[0][1].signal!.aborted).toBe(true);
});
it('surfaces disabled or inconsistent activity without silently selecting another page', async () => {
 const fetcher = vi.fn(async () => new Response(JSON.stringify({code: 'hosting_conflict', detail: 'Refresh activity.'}), {status: 409, headers: {'Content-Type': 'application/json'}}));
 vi.stubGlobal('fetch', fetcher);
 await expect(listHostingActivity('site', 'original-cursor')).rejects.toMatchObject({status: 409});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
