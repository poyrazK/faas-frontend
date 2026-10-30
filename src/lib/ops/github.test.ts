import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getGithubRecovery,
  githubStatusTone,
  isGithubRetryable,
  retryGithubCheckUpdate,
  retryGithubDelivery,
} from './github';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

let calls: Call[];
let responses: Response[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const params = (url: string) => new URL(url, 'https://ops.invalid').searchParams;

describe('github recovery client', () => {
  it('reads both queues unfiltered by default', async () => {
    responses.push(json(200, { deliveries: [], check_updates: [] }));
    const res = await getGithubRecovery();
    expect(calls[0].url).toBe('/v1/admin/ops/github/recovery');
    expect(res.check_updates).toEqual([]);
  });

  it('passes the status filter and limit', async () => {
    responses.push(json(200, { deliveries: [], check_updates: [] }));
    await getGithubRecovery({ status: 'dead', limit: 250 });
    const q = params(calls[0].url);
    expect(q.get('status')).toBe('dead');
    expect(q.get('limit')).toBe('250');
  });

  it('omits an empty status rather than sending status=', async () => {
    responses.push(json(200, { deliveries: [], check_updates: [] }));
    await getGithubRecovery({ status: '' });
    expect(params(calls[0].url).has('status')).toBe(false);
  });

  it('retries a delivery with confirm, reason and the dialog key', async () => {
    responses.push(json(200, { ok: true, kind: 'delivery', target_id: ID, status: 'pending' }));
    const res = await retryGithubDelivery(ID, 'webhook_backlog', { idempotencyKey: 'key-1' });
    expect(res.kind).toBe('delivery');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.startsWith(`/v1/admin/ops/github/deliveries/${ID}/retry?`)).toBe(true);
    const q = params(calls[0].url);
    expect(q.get('confirm')).toBe('true');
    expect(q.get('reason')).toBe('webhook_backlog');
    expect(calls[0].headers['Idempotency-Key']).toBe('key-1');
  });

  it('retries a check update by deployment id', async () => {
    responses.push(json(200, { ok: true, kind: 'check_update', target_id: ID, status: 'pending' }));
    await retryGithubCheckUpdate(ID, 'github_outage_recovery');
    expect(calls[0].url.startsWith(`/v1/admin/ops/github/check-updates/${ID}/retry?`)).toBe(true);
    expect(params(calls[0].url).get('reason')).toBe('github_outage_recovery');
    // request() mints a key for admin writes when the caller has none.
    expect(calls[0].headers['Idempotency-Key']).toMatch(/.+/);
  });

  it('reports a non-retryable item as a 409 ApiError', async () => {
    responses.push(
      json(409, {
        title: 'item is not retryable',
        status: 409,
        code: 'conflict',
        detail: 'the item was not found, is active, or was already retried',
      }),
    );
    await expect(retryGithubDelivery(ID, 'webhook_backlog')).rejects.toMatchObject({ status: 409 });
  });

  it('only offers retry for dead items', () => {
    expect(isGithubRetryable('dead')).toBe(true);
    for (const status of ['pending', 'processing', 'succeeded']) expect(isGithubRetryable(status)).toBe(false);
    expect(githubStatusTone('dead')).toBe('badge-danger');
    expect(githubStatusTone('succeeded')).toBe('badge-success');
  });
});
