import { afterEach, expect, it, vi } from 'vitest';
import { createHostingRelease, listHostingHistory, type HostingCapabilities } from './hosting';
import { validateHostingProvenance } from './hosting-provenance';

afterEach(() => { vi.unstubAllGlobals(); });
it('reads bounded history pages and sends source details beside the content manifest', async () => {
 const fetcher = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
 await listHostingHistory('site', 51);
 await createHostingRelease('site', { files: [], spa_fallback: false }, undefined, { repository: 'org/site', commit_sha: 'a'.repeat(40) });
 const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
 expect(calls[0][0]).toBe('/v1/internal/hosting/sites/site/history?before_revision=51'); expect(calls[0][1].cache).toBe('no-store');
 expect(calls[1][1].credentials).toBe('include'); expect(JSON.parse(calls[1][1].body as string)).toEqual({ files: [], spa_fallback: false, provenance: { repository: 'org/site', commit_sha: 'a'.repeat(40) } });
 expect(new Headers(calls[1][1].headers).get('Idempotency-Key')).toBeTruthy();
});
const limits = { provenance_repository_max_bytes: 256, provenance_branch_max_bytes: 128, provenance_description_max_bytes: 280 } as HostingCapabilities;
it('accepts full Git identifiers and bounded Unicode description text', () => {
 expect(() => validateHostingProvenance({ commit_sha: 'a'.repeat(40), description: 'Ship café' }, limits)).not.toThrow();
 expect(() => validateHostingProvenance({ commit_sha: 'b'.repeat(64) }, limits)).not.toThrow();
});
it.each([{}, { commit_sha: 'abc123' }, { commit_sha: 'A'.repeat(40) }, { repository: ' padded ' }, { branch: 'a\nb' }, { description: 'a\u202eb' }, { description: 'é'.repeat(141) }])('rejects invalid provenance before deployment (%j)', value => {
 expect(() => validateHostingProvenance(value, limits)).toThrow();
});
