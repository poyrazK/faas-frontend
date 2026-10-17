import { describe, expect, it } from 'vitest';
import type { PlatformFlagDefinition } from '@/lib/api';
import {
  addGroupRule,
  allowAccount,
  denyAccount,
  describeRule,
  editGroup,
  expectedVersion,
  isAccountID,
  moveRule,
  revokeAccount,
  setRollout,
} from '@/lib/platformFlags';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const base: PlatformFlagDefinition = {
  enabled: true,
  default: false,
  rules: [{ id: 'internal', group: 'internal', value: true }],
};

describe('platform flag edits', () => {
  it('keeps explicit decisions first: deny, then allow', () => {
    const allowed = allowAccount(base, A.toUpperCase());
    expect(allowed.rules?.map((rule) => rule.id)).toEqual(['accounts', 'internal']);
    expect(allowed.rules?.[0].accounts).toEqual([A]);

    const denied = denyAccount(allowAccount(allowed, B), A);
    expect(denied.rules?.map((rule) => rule.id)).toEqual(['denied-accounts', 'accounts', 'internal']);
    expect(denied.rules?.[0]).toMatchObject({ accounts: [A], value: false });
    expect(denied.rules?.[1].accounts).toEqual([B]);

    const revoked = revokeAccount(revokeAccount(denied, A), B);
    expect(revoked.rules?.map((rule) => rule.id)).toEqual(['internal']);
    expect(base.rules).toHaveLength(1);
  });

  it('places group rules after explicit rules and rollouts last', () => {
    const def = setRollout(addGroupRule(allowAccount(base, A), 'partners', true), 12.5, ['pro']);
    expect(def.rules?.map((rule) => rule.id)).toEqual(['accounts', 'group-partners', 'internal', 'rollout']);
    expect(def.rules?.at(-1)).toMatchObject({ rollout: 1250, plans: ['pro'], value: true });
    expect(setRollout(def, 0).rules?.some((rule) => rule.id === 'rollout')).toBe(false);
  });

  it('reorders rules within bounds', () => {
    const def = allowAccount(base, A);
    expect(moveRule(def, 'internal', -1).rules?.map((rule) => rule.id)).toEqual(['internal', 'accounts']);
    expect(moveRule(def, 'accounts', -1).rules?.map((rule) => rule.id)).toEqual(['accounts', 'internal']);
  });

  it('expects version 0 until an operator writes the flag', () => {
    expect(expectedVersion({ source: 'default_or_environment', version: 0 })).toBe(0);
    expect(expectedVersion({ source: 'operator', version: 7 })).toBe(7);
  });

  it('describes targeting and edits groups', () => {
    expect(describeRule({ id: 'r', accounts: [A, B], group: 'partners', plans: ['pro', 'scale'], rollout: 1000, value: true }, {}))
      .toBe('2 accounts · group partners (missing) · pro, scale · 10%');
    expect(editGroup({ internal: [A] }, 'partners', B, true)).toEqual({ internal: [A], partners: [B] });
    expect(editGroup({ internal: [A] }, 'internal', A, false)).toEqual({ internal: [] });
    expect(isAccountID(A)).toBe(true);
    expect(isAccountID('acme')).toBe(false);
  });
});
