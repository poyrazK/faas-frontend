import { afterEach, expect, it, vi } from 'vitest';
import { createHostingPreview, revokeHostingPreview, listHostingPreviews } from './hosting';

afterEach(() => { vi.unstubAllGlobals(); });
it('creates an immutable release binding and revokes with the reviewed generation through internal authenticated routes', async () => {
 const fetcher = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
 vi.stubGlobal('fetch', fetcher);
 await listHostingPreviews('site'); await createHostingPreview('site', 'staged-release', 300); await revokeHostingPreview('site', 'preview', 1);
 const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
 expect(calls.map(([path]) => path)).toEqual(['/v1/internal/hosting/sites/site/previews', '/v1/internal/hosting/sites/site/previews', '/v1/internal/hosting/sites/site/previews/preview']);
 expect(calls.map(([, init]) => init.credentials)).toEqual(['include', 'include', 'include']);
 expect(JSON.parse(calls[1][1].body as string)).toEqual({ release_id: 'staged-release', ttl_seconds: 300 });
 expect(calls[2][1].method).toBe('DELETE'); expect(JSON.parse(calls[2][1].body as string)).toEqual({ expected_generation: 1 });
 expect(new Headers(calls[1][1].headers).get('Idempotency-Key')).toBeTruthy();
 expect(new Headers(calls[2][1].headers).get('Idempotency-Key')).not.toBe(new Headers(calls[1][1].headers).get('Idempotency-Key'));
});
it('does not automatically retry uncertain or conflicting preview mutations', async () => {
 const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 'hosting_release_conflict', detail: 'Refresh first.' }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
 vi.stubGlobal('fetch', fetcher); await expect(revokeHostingPreview('site', 'preview', 1)).rejects.toMatchObject({ status: 409 }); expect(fetcher).toHaveBeenCalledTimes(1);
});
