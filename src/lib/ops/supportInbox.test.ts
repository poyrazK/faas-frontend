import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOverdue,
  listSupportMessages,
  markTicketRead,
  nextDue,
  supportTicketAction,
  ticketQuery,
  type SupportEpisode,
} from './supportInbox';
import { formatStuck, loadStuckCount } from './customerQueues';
import { loadSignalHistory } from '@/components/operator/tenant/DiagnosisPanel';

let calls: { url: string; init?: RequestInit }[];
let respond: (url: string) => unknown;

beforeEach(() => {
  calls = [];
  respond = () => ({});
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(respond(url)), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('ticketQuery', () => {
  it('sends only filters apid accepts', () => {
    expect(ticketQuery({})).toBe('');
    expect(ticketQuery({ status: 'bogus', search: '  ' })).toBe('');
    expect(ticketQuery({ status: 'pending', search: ' npm ci ', assigneeId: 'u1', cursor: 'c1' })).toBe(
      '?status=pending&search=npm+ci&assignee_id=u1&cursor=c1',
    );
    expect(new URLSearchParams(ticketQuery({ search: 'x'.repeat(500) })).get('search')).toHaveLength(200);
  });
});

describe('nextDue', () => {
  const base: SupportEpisode = {
    id: 'e', started_at: '2026-11-15T09:00:00Z', plan: 'pro', priority: 'high', category: 'deployment',
    first_response_due: '2026-11-15T10:00:00Z', resolution_due: '2026-11-16T09:00:00Z', resolution_breached: false,
  };

  it('picks the deadline that applies now', () => {
    expect(nextDue(base, 'open')).toEqual({ label: 'First response', at: base.first_response_due });
    expect(nextDue({ ...base, first_response_at: 'x', next_reply_due: '2026-11-15T12:00:00Z' }, 'open')?.label).toBe('Next reply');
    expect(nextDue({ ...base, first_response_at: 'x' }, 'open')?.label).toBe('Resolution');
    expect(nextDue({ ...base, wait_since: 'x' }, 'pending')).toBeNull();
    expect(nextDue(base, 'resolved')).toBeNull();
  });

  it('knows when a deadline passed', () => {
    expect(isOverdue('2026-11-15T10:00:00Z', Date.parse('2026-11-15T10:00:01Z'))).toBe(true);
    expect(isOverdue('2026-11-15T10:00:00Z', Date.parse('2026-11-15T09:59:59Z'))).toBe(false);
  });
});

describe('ticket actions', () => {
  it('posts each action at the expected revision with the idempotency key', async () => {
    await supportTicketAction('t/1', 'reply', 3, { body: 'hi' }, { idempotencyKey: 'k1' });
    await supportTicketAction('t1', 'note', 4, { body: 'n' });
    await supportTicketAction('t1', 'triage', 5, { priority: 'high', reason: 'mine', assignee_id: 'u1', required_skills: ['node'] });
    expect(calls.map((c) => c.url)).toEqual([
      '/v1/admin/support/tickets/t%2F1/messages',
      '/v1/admin/support/tickets/t1/notes',
      '/v1/admin/support/tickets/t1/triage',
    ]);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ expected_revision: 3, body: 'hi' });
    expect(new Headers(calls[0].init?.headers).get('Idempotency-Key')).toBe('k1');
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      expected_revision: 5, priority: 'high', reason: 'mine', assignee_id: 'u1', required_skills: ['node'],
    });
  });

  it('reads the whole thread across pages', async () => {
    respond = (url) => (url.includes('after=2') ? { items: [{ id: 'c', sequence: 3 }] } : { items: [{ id: 'a', sequence: 1 }, { id: 'b', sequence: 2 }], next_cursor: 2 });
    const messages = await listSupportMessages('t1');
    expect(messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('marks a ticket read through its latest notification, and only when it has one', async () => {
    respond = () => ({ items: [{ ticket_id: 't1', sequence: 4 }, { ticket_id: 't2', sequence: 9 }, { ticket_id: 't1', sequence: 7 }], unread_count: 3 });
    await markTicketRead('t1');
    expect(calls[1].url).toBe('/v1/admin/support/tickets/t1/read');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ through_sequence: 7 });
    calls = [];
    await markTicketRead('t3');
    expect(calls).toHaveLength(1);
  });
});

describe('customer queues', () => {
  it('counts open signals and accounts and notices a capped list', async () => {
    respond = () => ({ items: [{ account_id: 'a' }, { account_id: 'a' }, { account_id: 'b' }], limit: 3 });
    const stuck = await loadStuckCount();
    expect(calls[0].url).toBe('/v1/admin/obs/attention?state=open&limit=200');
    expect(stuck).toEqual({ signals: 3, accounts: 2, capped: true });
    expect(formatStuck(stuck)).toBe('3+');
  });
});

describe('signal history', () => {
  it('merges dismissed and resolved signals, newest first', async () => {
    respond = (url) =>
      url.includes('state=dismissed')
        ? { items: [{ id: 1, dismissed_at: '2026-11-14T00:00:00Z', last_seen_at: '2026-11-13T00:00:00Z' }] }
        : { items: [{ id: 2, resolved_at: '2026-11-15T00:00:00Z', last_seen_at: '2026-11-15T00:00:00Z' }] };
    const items = await loadSignalHistory('acct');
    expect(items.map((s) => s.id)).toEqual([2, 1]);
    expect(calls.every((c) => c.url.includes('account_id=acct') && c.url.includes('limit=25'))).toBe(true);
  });
});
