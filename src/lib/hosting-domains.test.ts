import { afterEach, expect, it, vi } from 'vitest';
import { createHostingDomain, recoverHostingDomain, deleteHostingDomain, listHostingDomains } from './hosting';

afterEach(() => { vi.unstubAllGlobals(); });
it('uses internal account-authenticated domain routes and the reviewed removal revision', async () => {
  const fetcher = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  await listHostingDomains('site');
  await createHostingDomain('site', 'portal.example.com');
  await deleteHostingDomain('site', 'domain', 7);
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(calls.map(([path]) => path)).toEqual(['/v1/internal/hosting/sites/site/domains', '/v1/internal/hosting/sites/site/domains', '/v1/internal/hosting/sites/site/domains/domain']);
  expect(calls.map(([, init]) => init.credentials)).toEqual(['include', 'include', 'include']);
  expect(calls[1][1].method).toBe('POST');
  expect(calls[2][1].method).toBe('DELETE');
  expect(JSON.parse(calls[2][1].body as string)).toEqual({ expected_revision: 7 });
  expect(new Headers(calls[1][1].headers).get('Idempotency-Key')).toBeTruthy();
  expect(new Headers(calls[2][1].headers).get('Idempotency-Key')).not.toBe(new Headers(calls[1][1].headers).get('Idempotency-Key'));
});

it('does not silently retry domain conflicts or mutate with an updated revision', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 'hosting_domain_conflict', detail: 'Refresh the domain.' }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  await expect(deleteHostingDomain('site', 'domain', 7)).rejects.toMatchObject({ status: 409, code: 'hosting_domain_conflict' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('binds only the explicitly reviewed provider ID, hostname and revision', async () => {
  const fetcher = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  await recoverHostingDomain('site', 'domain', 9, 'portal.example.com', 'provider-id');
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0][0]).toBe('/v1/internal/hosting/sites/site/domains/domain/recover');
  expect(calls[0][1].credentials).toBe('include');
  expect(JSON.parse(calls[0][1].body as string)).toEqual({ expected_revision: 9, expected_hostname: 'portal.example.com', provider_id: 'provider-id' });
  expect(new Headers(calls[0][1].headers).get('Idempotency-Key')).toBeTruthy();
});
