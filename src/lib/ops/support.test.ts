import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObsEventRow } from '@/lib/api';
import {
  abuseHoldNoteError,
  buildTraceTimeline,
  collectIds,
  deriveAbuseHoldState,
  explainFlagDecision,
  formatOffset,
  getAccountPlatformFlags,
  getTraceLookup,
  getWakeTimeline,
  listAbuseHoldEvents,
  normalizeTraceId,
  placeAccountAbuseHold,
  releaseAccountAbuseHold,
  tenantHref,
  toAbuseHoldEvent,
  TRACE_ID_PATTERN,
  WAKE_ID_PATTERN,
} from './support';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

const ACCOUNT = '0b6f7a52-3c1d-4e8f-9a2b-5c6d7e8f9a0b';

const row = (over: Partial<ObsEventRow>): ObsEventRow => ({
  id: 1,
  at: '2026-10-01T10:00:00Z',
  kind: 'account.abuse_hold_placed',
  actor: 'acct:op',
  ...over,
});

describe('abuse hold writes', () => {
  it('places a hold with the note as the only body field and the caller key', async () => {
    responses.push(json(200, { account_id: ACCOUNT, abuse_hold: { reason: 'operator', held_at: '2026-10-01T10:00:00Z' }, changed: true }));
    const res = await placeAccountAbuseHold(ACCOUNT, 'ticket SUP-12 crypto mining', { idempotencyKey: 'k-1' });
    expect(calls[0]).toMatchObject({
      url: `/v1/admin/accounts/${ACCOUNT}/abuse-hold`,
      method: 'POST',
      body: { note: 'ticket SUP-12 crypto mining' },
    });
    expect(calls[0].headers['Idempotency-Key']).toBe('k-1');
    expect(res.abuse_hold?.reason).toBe('operator');
  });

  it('releases with DELETE and a JSON body', async () => {
    responses.push(json(200, { account_id: ACCOUNT, abuse_hold: null, changed: false }));
    const res = await releaseAccountAbuseHold(ACCOUNT, 'false positive');
    expect(calls[0]).toMatchObject({ method: 'DELETE', body: { note: 'false positive' } });
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(res.changed).toBe(false);
  });

  it('validates the note length in bytes like the handler', () => {
    expect(abuseHoldNoteError('ab')).toMatch(/at least 3/);
    expect(abuseHoldNoteError('abc')).toBeNull();
    expect(abuseHoldNoteError('é'.repeat(251))).toMatch(/500 bytes/);
    expect(abuseHoldNoteError('é'.repeat(250))).toBeNull();
  });
});

describe('abuse hold history', () => {
  it('reads both event kinds for the account and merges them newest first', async () => {
    responses.push(
      json(200, {
        generated_at: '',
        limit: 25,
        items: [
          row({ id: 3, at: '2026-10-03T00:00:00Z', kind: 'account.abuse_hold_released', data: { note: 'cleared', actor_email: 'op@x' } }),
          row({ id: 9, at: '2026-10-01T00:00:00Z', kind: 'account.created' }),
        ],
      }),
      json(200, {
        generated_at: '',
        limit: 25,
        items: [row({ id: 2, at: '2026-10-02T00:00:00Z', kind: 'accounts.abuse_hold', actor: 'schedd', data: { reason: 'egress_fanout' } })],
      }),
    );
    const events = await listAbuseHoldEvents(ACCOUNT);
    expect(calls.map((c) => c.url)).toEqual([
      `/v1/admin/obs/events?limit=25&kind_prefix=account.abuse_hold&subject=${ACCOUNT}`,
      `/v1/admin/obs/events?limit=25&kind_prefix=accounts.abuse_hold&subject=${ACCOUNT}`,
    ]);
    expect(events.map((e) => [e.id, e.action, e.reason])).toEqual([
      [3, 'released', undefined],
      [2, 'placed', 'egress_fanout'],
    ]);
    expect(events[0]).toMatchObject({ note: 'cleared', actorEmail: 'op@x' });
  });

  it('derives the last recorded state', () => {
    expect(deriveAbuseHoldState([])).toEqual({ state: 'none' });
    const placed = toAbuseHoldEvent(row({ id: 1, at: '2026-10-01T00:00:00Z' }))!;
    const released = toAbuseHoldEvent(row({ id: 2, at: '2026-10-02T00:00:00Z', kind: 'account.abuse_hold_released' }))!;
    expect(deriveAbuseHoldState([placed, released]).state).toBe('released');
    expect(deriveAbuseHoldState([placed]).state).toBe('held');
    expect(toAbuseHoldEvent(row({ kind: 'account.suspended' }))).toBeNull();
  });
});

describe('platform flags', () => {
  it('reads one account without query parameters', async () => {
    responses.push(json(200, { account_id: ACCOUNT, plan: 'pro', items: [] }));
    await getAccountPlatformFlags(ACCOUNT);
    expect(calls[0].url).toBe(`/v1/admin/accounts/${ACCOUNT}/flags`);
  });

  it('explains a decision from the fields the server sent', () => {
    expect(
      explainFlagDecision({
        flag: 'f',
        account_id: ACCOUNT,
        plan: 'free',
        enabled: true,
        reason: 'rule_match',
        rule_id: 'beta',
        bucket: 12,
        version: 3,
        entitled: false,
        available: false,
      }),
    ).toBe('Matched a rule · rule beta · bucket 12 · plan free is not entitled');
    expect(
      explainFlagDecision({
        flag: 'f',
        account_id: ACCOUNT,
        plan: 'pro',
        enabled: false,
        reason: 'default',
        version: 1,
        available: false,
        schedule_state: 'rule_not_started',
        scheduled_rule_id: 'launch',
      }),
    ).toBe('Flag default · matching rule not started yet (launch)');
  });
});

describe('lookups', () => {
  it('validates ids with the server patterns', () => {
    expect(TRACE_ID_PATTERN.test(normalizeTraceId('  4BF92F3577B34DA6A3CE929D0E0E4736 '))).toBe(true);
    expect(TRACE_ID_PATTERN.test('4bf92f35-77b3-4da6-a3ce-929d0e0e4736')).toBe(false);
    expect(WAKE_ID_PATTERN.test('0192f3a4-7b8c-7def-8123-456789abcdef')).toBe(true);
    expect(WAKE_ID_PATTERN.test('short')).toBe(false);
    expect(WAKE_ID_PATTERN.test('has space in it')).toBe(false);
  });

  it('clamps the trace limit and never sends a query to the wake route', async () => {
    responses.push(json(200, { trace_id: 'a'.repeat(32), generated_at: '', limit: 500, intents: [], events: [] }));
    responses.push(json(200, { wake_id: 'wake-1234', events: [], truncated: false }));
    await getTraceLookup('a'.repeat(32), 9999);
    await getWakeTimeline('wake-1234');
    expect(calls[0].url).toBe(`/v1/admin/obs/traces/${'a'.repeat(32)}?limit=500`);
    expect(calls[1].url).toBe('/v1/admin/obs/wakes/wake-1234');
  });

  it('interleaves intents and events by time', () => {
    const timeline = buildTraceTimeline({
      intents: [
        {
          intent_id: 'i-1',
          kind: 'force_park',
          status: 'succeeded',
          target_id: 'inst',
          actor_id: 'op',
          reason: 'stuck_instance',
          requested_at: '2026-10-01T10:00:01Z',
        },
      ],
      events: [
        row({ id: 7, at: '2026-10-01T10:00:02Z', kind: 'instance.parked' }),
        row({ id: 6, at: '2026-10-01T10:00:00Z', kind: 'operator.action.force_park' }),
      ],
    });
    expect(timeline.map((e) => e.key)).toEqual(['e:6', 'i:i-1', 'e:7']);
  });

  it('finds wake and trace ids nested in event payloads', () => {
    expect(collectIds({ wake_id: 'w-1', nested: { wake_id: 'w-2', list: [{ wake_id: 'w-1' }] } }, 'wake_id')).toEqual(['w-1', 'w-2']);
    expect(collectIds(null, 'trace_id')).toEqual([]);
    expect(collectIds('wake_id', 'wake_id')).toEqual([]);
  });

  it('formats offsets and tenant links', () => {
    expect(formatOffset(0)).toBe('+0 ms');
    expect(formatOffset(1250)).toBe('+1.25 s');
    expect(formatOffset(184_000)).toBe('+3m 04s');
    expect(formatOffset(null)).toBe('');
    expect(tenantHref(ACCOUNT)).toBe(`/tenants?q=${ACCOUNT}`);
  });
});
