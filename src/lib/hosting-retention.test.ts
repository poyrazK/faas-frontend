import { afterEach, expect, it, vi } from 'vitest';
import { getHostingCleanupPlan, setHostingRetentionPolicy, type HostingCleanupPlan } from './hosting';
import { cleanupReason, retentionReviewCurrent, retentionRules } from './hosting-retention';

afterEach(() => vi.unstubAllGlobals());
it('reads proposed rules without writes and saves only the reviewed policy revision', async () => {
  const fetcher = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
  await getHostingCleanupPlan('site'); await getHostingCleanupPlan('site', { pending_age_seconds: 3600, staged_age_seconds: 7200 });
  await setHostingRetentionPolicy('site', { enabled: false, pending_age_seconds: 3600, staged_age_seconds: 7200, expected_revision: 7 });
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0][0]).toBe('/v1/internal/hosting/sites/site/cleanup');
  expect(calls[1][0]).toBe('/v1/internal/hosting/sites/site/cleanup?pending_age_seconds=3600&staged_age_seconds=7200');
  expect(calls[0][1].method).toBeUndefined(); expect(calls[1][1].body).toBeUndefined();
  expect(calls[2][1].method).toBe('PUT'); expect(JSON.parse(calls[2][1].body as string)).toEqual({ enabled: false, pending_age_seconds: 3600, staged_age_seconds: 7200, expected_revision: 7 });
  expect(new Headers(calls[2][1].headers).has('Idempotency-Key')).toBe(false);
  expect(calls.every(([, init]) => init.credentials === 'include' && init.cache === 'no-store')).toBe(true);
});
it('does not retry policy conflicts or replace the reviewed revision', async () => {
  const fetcher = vi.fn(async () => new Response('{"code":"hosting_release_conflict","detail":"Refresh."}', { status: 409, headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
  await expect(setHostingRetentionPolicy('site', { enabled: true, pending_age_seconds: 3600, staged_age_seconds: 3600, expected_revision: 4 })).rejects.toMatchObject({ status: 409 }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('invalidates review on a changed policy, site, or edited age', () => {
  const rules = { pending_age_seconds: 3600, staged_age_seconds: 7200 };
  const plan: HostingCleanupPlan = { policy: { site_id: 'site', revision: 3, enabled: false, ...rules }, rules, proposed: true, evaluated_at: '2026-10-17T10:00:00Z', entries: [], reclaimable_reserved_bytes: 0, retiring_reserved_bytes: 0 };
  expect(retentionReviewCurrent(plan, plan, rules)).toBe(true);
  expect(retentionReviewCurrent(plan, { ...plan, policy: { ...plan.policy, revision: 4 } }, rules)).toBe(false);
  expect(retentionReviewCurrent(plan, { ...plan, policy: { ...plan.policy, site_id: 'other' } }, rules)).toBe(false);
  expect(retentionReviewCurrent(plan, plan, { ...rules, staged_age_seconds: 3600 })).toBe(false);
  expect(retentionRules('', '2', 3600, 2592000)).toBeNull(); expect(retentionRules('Infinity', '2', 3600, 2592000)).toBeNull(); expect(retentionRules('0.5', '2', 3600, 2592000)).toBeNull(); expect(retentionRules('1', '2', 3600, 2592000)).toEqual(rules);
  expect(cleanupReason('preview_cleanup_pending')).toContain('safe cleanup'); expect(cleanupReason('unknown')).toContain('Protected');
});
