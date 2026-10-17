import { afterEach, expect, it, vi } from 'vitest';
import { prepareHostingCISetup, type HostingCISetupConfig } from './hosting';

afterEach(() => vi.unstubAllGlobals());
const config: HostingCISetupConfig = {api_base: 'https://api.gregale.dev', action_commit: 'a'.repeat(40), checkout_commit: 'b'.repeat(40), cli_sha256: 'c'.repeat(64), prepare_action: './.github/actions/prepare-frontend', cli_path: './bin/gregale', output_path: 'dist', spa_fallback: false, preview_ttl_seconds: 3600, wait_timeout_seconds: 120};
it('sends only setup intent through the authenticated internal route, without local source or workflow contents', async () => {
 const fetcher = vi.fn(async () => new Response('{}', {headers: {'Content-Type': 'application/json'}}));
 vi.stubGlobal('fetch', fetcher);
 await prepareHostingCISetup('site/escape', 'trust', config);
 const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
 expect(calls[0][0]).toBe('/v1/internal/hosting/sites/site%2Fescape/ci-setup');
 expect(calls[0][1]).toMatchObject({method: 'POST', credentials: 'include', cache: 'no-store'});
 expect(JSON.parse(calls[0][1].body as string)).toEqual({trust_id: 'trust', config});
});
it('does not retry a revoked trust, failed qualification or conflicting configuration', async () => {
 const fetcher = vi.fn(async () => new Response(JSON.stringify({code: 'hosting_site_conflict', detail: 'Refresh setup trusts.'}), {status: 409, headers: {'Content-Type': 'application/json'}}));
 vi.stubGlobal('fetch', fetcher);
 await expect(prepareHostingCISetup('site', 'trust', config)).rejects.toMatchObject({status: 409});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
