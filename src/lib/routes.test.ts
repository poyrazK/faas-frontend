import { describe, expect, it } from 'vitest';
import { isAccountId, tenantHref } from './routes';

const ID = '11111111-2222-4333-8444-555555555555';

describe('tenantHref', () => {
  it('links to the workspace, with a tab only when it is not the overview', () => {
    expect(tenantHref(ID)).toBe(`/tenants/${ID}`);
    expect(tenantHref(ID, 'overview')).toBe(`/tenants/${ID}`);
    expect(tenantHref(` ${ID} `, 'billing')).toBe(`/tenants/${ID}?tab=billing`);
  });

  it('recognizes account IDs', () => {
    expect(isAccountId(ID)).toBe(true);
    expect(isAccountId(ID.toUpperCase())).toBe(true);
    expect(isAccountId('ada@customer.test')).toBe(false);
    expect(isAccountId(`${ID}x`)).toBe(false);
  });
});
