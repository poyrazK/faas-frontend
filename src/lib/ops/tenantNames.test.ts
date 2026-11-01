import { describe, expect, it } from 'vitest';
import type { ObsTenantDetailResponse } from '@/lib/api';
import { chosenOrgSlug, tenantRowLabel, workspaceTitle } from './tenantNames';

const ID = 'cb0ea7ac-64a3-4000-8000-000000000001';

describe('chosenOrgSlug', () => {
  it('drops the personal-org slug apid generates from the account ID', () => {
    expect(chosenOrgSlug('u-cb0ea7ac64a3')).toBeNull();
    expect(chosenOrgSlug('ada-labs')).toBe('ada-labs');
    expect(chosenOrgSlug('u-ada')).toBe('u-ada');
    expect(chosenOrgSlug(undefined)).toBeNull();
  });
});

describe('tenantRowLabel', () => {
  it('never presents a generated slug as a name', () => {
    expect(tenantRowLabel({ account_id: ID, org_slug: 'u-cb0ea7ac64a3', is_personal: true })).toEqual({
      primary: 'cb0ea7ac…',
      secondary: 'Personal account',
      mono: true,
    });
  });

  it('prefers a revealed email, then a chosen org', () => {
    expect(tenantRowLabel({ account_id: ID, email: 'ada@customer.test', org_slug: 'u-cb0ea7ac64a3', is_personal: true })).toEqual({
      primary: 'ada@customer.test',
      secondary: 'cb0ea7ac…',
      mono: false,
    });
    expect(tenantRowLabel({ account_id: ID, org_slug: 'ada-labs', is_personal: false })).toEqual({
      primary: 'org ada-labs',
      secondary: 'cb0ea7ac…',
      mono: false,
    });
  });
});

describe('workspaceTitle', () => {
  const detail = (orgs: string[], over: Partial<ObsTenantDetailResponse['account']> = {}) =>
    ({
      account: { account_id: ID, is_personal: true, org_slug: 'u-cb0ea7ac64a3', ...over },
      orgs: orgs.map((slug, i) => ({ id: String(i), slug, role: 'owner' })),
    }) as ObsTenantDetailResponse;

  it('names a team org the account belongs to, skipping the personal one', () => {
    expect(workspaceTitle(detail(['u-cb0ea7ac64a3', 'ada-labs']), false)).toBe('org ada-labs');
  });

  it('falls back to the kind of account, or says the email is missing once revealed', () => {
    expect(workspaceTitle(detail(['u-cb0ea7ac64a3']), false)).toBe('Personal account');
    expect(workspaceTitle(detail(['u-cb0ea7ac64a3']), true)).toBe('No email on file');
    expect(workspaceTitle(detail([], { email: 'ada@customer.test' }), true)).toBe('ada@customer.test');
  });
});
