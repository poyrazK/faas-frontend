import { describe, expect, it, vi } from 'vitest';
import type { ObsTenantListResponse, ObsTenantRow } from '@/lib/api';
import { emailMatch, findTenantsByEmail, looksLikeEmail } from './tenantSearch';

const row = (id: string, email?: string): ObsTenantRow => ({
  account_id: id,
  plan: 'pro',
  status: 'active',
  is_personal: true,
  created_at: '2026-10-01T00:00:00Z',
  mfa_enrolled: false,
  apps_count: 0,
  deployments_live_count: 0,
  email,
});

const pages = (...items: ObsTenantRow[][]) =>
  vi.fn(async (cursor: string | undefined): Promise<ObsTenantListResponse> => {
    const i = cursor ? Number(cursor) : 0;
    return { items: items[i], next_cursor: i + 1 < items.length ? String(i + 1) : '', limit: 100 };
  });

describe('email search helpers', () => {
  it('recognizes email-like queries', () => {
    expect(looksLikeEmail('ada@customer.test')).toBe(true);
    expect(looksLikeEmail('ada@')).toBe(true);
    expect(looksLikeEmail('11111111-2222-4333-8444-555555555555')).toBe(false);
    expect(looksLikeEmail('two words@x')).toBe(false);
  });

  it('matches exactly (case-insensitive) or partially', () => {
    expect(emailMatch(row('a', 'Ada@Customer.test'), 'ada@customer.test')).toBe('exact');
    expect(emailMatch(row('a', 'ada@customer.test'), 'ada@')).toBe('partial');
    expect(emailMatch(row('a'), 'ada@')).toBeNull();
  });
});

describe('findTenantsByEmail', () => {
  it('stops at the page holding the exact address', async () => {
    const fetchPage = pages([row('1', 'x@a.test')], [row('2', 'ada@customer.test')], [row('3', 'z@a.test')]);
    const result = await findTenantsByEmail('ada@customer.test', fetchPage);
    expect(result).toMatchObject({ scanned: 2, complete: true });
    expect(result.matches.map((r) => r.account_id)).toEqual(['2']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('returns partial matches when the directory ends without an exact one', async () => {
    const result = await findTenantsByEmail('ada@', pages([row('1', 'ada@one.test')], [row('2', 'ada@two.test')]));
    expect(result).toMatchObject({ scanned: 2, complete: true });
    expect(result.matches).toHaveLength(2);
  });

  it('reports an incomplete search when the page budget runs out', async () => {
    const fetchPage = pages([row('1', 'a@x.test')], [row('2', 'b@x.test')], [row('3', 'c@x.test')]);
    const result = await findTenantsByEmail('zed@x.test', fetchPage, { maxPages: 2 });
    expect(result).toMatchObject({ matches: [], scanned: 2, complete: false });
  });

  it('stops when cancelled', async () => {
    const signal = { cancelled: true };
    const fetchPage = pages([row('1', 'a@x.test')]);
    await findTenantsByEmail('a@x.test', fetchPage, { signal });
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
