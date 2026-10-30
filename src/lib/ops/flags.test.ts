import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPlatformFlag,
  getPlatformFlagDecision,
  getPlatformFlags,
  writePlatformFlag,
  writePlatformFlagGroups,
  writePlatformFlagOptIns,
} from './flags';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[];
let responses: Response[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  });
});

afterEach(() => vi.unstubAllGlobals());

const A = '11111111-1111-4111-8111-111111111111';

describe('platform flag reads', () => {
  it('lists, gets and decides with encoded paths', async () => {
    responses.push(json(200, { items: [], groups: {}, generated_at: '' }), json(200, { key: 'a b' }), json(200, { flag: 'a b' }));
    await getPlatformFlags();
    await getPlatformFlag('a b');
    await getPlatformFlagDecision('a b', { accountId: ` ${A} ` });
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', '/v1/admin/flags'],
      ['GET', '/v1/admin/flags/a%20b'],
      ['GET', `/v1/admin/flags/a%20b/decision?account_id=${A}`],
    ]);
  });

  it('adds org_id and at only when given', async () => {
    responses.push(json(200, {}));
    await getPlatformFlagDecision('ai_gateway', { accountId: A, orgId: 'org-1', at: '2026-11-01T00:00:00Z' });
    const url = new URL(calls[0].url, 'https://console.invalid');
    expect(Object.fromEntries(url.searchParams)).toEqual({ account_id: A, org_id: 'org-1', at: '2026-11-01T00:00:00Z' });
  });
});

describe('platform flag writes go through runtime configuration', () => {
  it('patches the flag config key with the pinned version, reason and key', async () => {
    responses.push(json(200, { key: 'platform_flag.ai_gateway', version: 4 }));
    await writePlatformFlag({ config_key: 'platform_flag.ai_gateway' }, { enabled: true, default: false }, 'release to acme', 3, {
      idempotencyKey: 'key-1',
    });
    expect(calls[0]).toMatchObject({
      url: '/v1/admin/config/platform_flag.ai_gateway',
      method: 'PATCH',
      body: { value: { enabled: true, default: false }, reason: 'release to acme', expected_version: 3 },
    });
    expect(calls[0].headers['Idempotency-Key']).toBe('key-1');
  });

  it('sends force only for an explicit opt-in', async () => {
    responses.push(json(200, {}));
    await writePlatformFlag({ config_key: 'platform_flag.core' }, { enabled: false, default: false }, 'incident', 0, { force: true });
    expect(calls[0].body).toEqual({ value: { enabled: false, default: false }, reason: 'incident', expected_version: 0, force: true });
  });

  it('writes groups and opt-ins to their own rows', async () => {
    responses.push(json(200, {}), json(200, {}));
    await writePlatformFlagGroups({ internal: [A] }, 'add staff', 2);
    await writePlatformFlagOptIns('service_map', { accounts: [A] }, 'support ticket 9', 0);
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['PATCH', '/v1/admin/config/platform_flag_groups', { value: { internal: [A] }, reason: 'add staff', expected_version: 2 }],
      ['PATCH', '/v1/admin/config/platform_flag_opt_ins.service_map', { value: { accounts: [A] }, reason: 'support ticket 9', expected_version: 0 }],
    ]);
  });

  it('surfaces the core-flag conflict with its problem title', async () => {
    responses.push(json(409, { title: 'Core capability flag', status: 409, code: 'conflict', detail: 'resend with force' }));
    await expect(
      writePlatformFlag({ config_key: 'platform_flag.core' }, { enabled: false, default: true }, 'incident', 1),
    ).rejects.toMatchObject({ status: 409, problem: { title: 'Core capability flag' } });
  });
});
