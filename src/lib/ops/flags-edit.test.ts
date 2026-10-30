import { describe, expect, it } from 'vitest';
import type { OperatorPlatformFlagDecision, PlatformFlagDefinition } from './flags';
import {
  addGroup,
  addGroupRule,
  allowAccount,
  canonicalUUID,
  denyAccount,
  describeRule,
  diffDefinition,
  diffGroups,
  diffOptIns,
  editGroup,
  editOptIns,
  expectedVersion,
  explainDecision,
  groupsStillReferenced,
  isUUID,
  moveRule,
  needsForce,
  normalizeDefinition,
  parseDefinitionJSON,
  removeGroup,
  removeRule,
  resumeRamp,
  revokeAccount,
  setRollout,
  setSelfServe,
  toRfc3339Seconds,
  validateDefinition,
  validateGroups,
  validateOptIns,
} from './flags-edit';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const base: PlatformFlagDefinition = {
  enabled: true,
  default: false,
  rules: [{ id: 'internal', group: 'internal', value: true }],
};

describe('account decisions (ported from the platform-flags PR)', () => {
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

  it('keeps the self-serve block, which the PR clone silently dropped', () => {
    const withPreview: PlatformFlagDefinition = { ...base, self_serve: { enabled: true, plans: ['pro'] } };
    expect(allowAccount(withPreview, A).self_serve).toEqual({ enabled: true, plans: ['pro'] });
    expect(setRollout(withPreview, 5).self_serve).toEqual({ enabled: true, plans: ['pro'] });
  });

  it('removes a rule left without targeting but keeps one that still has a window', () => {
    const scheduled: PlatformFlagDefinition = {
      enabled: true,
      default: false,
      rules: [{ id: 'accounts', accounts: [A], starts_at: '2026-11-01T00:00:00Z', value: true }],
    };
    expect(revokeAccount(scheduled, A).rules).toEqual([{ id: 'accounts', starts_at: '2026-11-01T00:00:00Z', value: true }]);
    expect(revokeAccount(allowAccount({ enabled: true, default: false }, A), A).rules).toBeUndefined();
  });
});

describe('rule placement', () => {
  it('places group rules after explicit rules and rollouts last', () => {
    const def = setRollout(addGroupRule(allowAccount(base, A), 'partners', true), 12.5, ['pro']);
    expect(def.rules?.map((rule) => rule.id)).toEqual(['accounts', 'group-partners', 'internal', 'rollout']);
    expect(def.rules?.at(-1)).toMatchObject({ rollout: 1250, plans: ['pro'], value: true });
    expect(setRollout(def, 0).rules?.some((rule) => rule.id === 'rollout')).toBe(false);
  });

  it('updates an existing rollout rule in place, keeping its ramp', () => {
    const ramped: PlatformFlagDefinition = {
      enabled: true,
      default: false,
      rules: [
        { id: 'rollout', rollout: 100, value: true, ramp: { stages: [100, 1000], interval_seconds: 600, max_5xx_basis_points: 50, min_requests: 10, on_breach: 'pause', paused: true, paused_reason: 'breach' } },
        { id: 'later', group: 'internal', value: true },
      ],
    };
    const next = setRollout(ramped, 10);
    expect(next.rules?.map((rule) => rule.id)).toEqual(['rollout', 'later']);
    expect(next.rules?.[0]).toMatchObject({ rollout: 1000, ramp: { stages: [100, 1000] } });
    expect(resumeRamp(ramped, 'rollout').rules?.[0].ramp).toEqual({ stages: [100, 1000], interval_seconds: 600, max_5xx_basis_points: 50, min_requests: 10, on_breach: 'pause' });
  });

  it('reorders rules within bounds and removes by id', () => {
    const def = allowAccount(base, A);
    expect(moveRule(def, 'internal', -1).rules?.map((rule) => rule.id)).toEqual(['internal', 'accounts']);
    expect(moveRule(def, 'accounts', -1).rules?.map((rule) => rule.id)).toEqual(['accounts', 'internal']);
    expect(removeRule(base, 'internal').rules).toBeUndefined();
  });
});

describe('write preconditions', () => {
  it('expects version 0 until an operator writes the flag', () => {
    expect(expectedVersion({ source: 'default_or_environment', version: 0 })).toBe(0);
    expect(expectedVersion({ source: 'operator', version: 7 })).toBe(7);
  });

  it('predicts the core-flag 409: kill switch or default off needs force', () => {
    expect(needsForce({ core: true }, { enabled: true, default: true })).toBe(false);
    expect(needsForce({ core: true }, { enabled: false, default: true })).toBe(true);
    expect(needsForce({ core: true }, { enabled: true, default: false })).toBe(true);
    expect(needsForce({ core: false }, { enabled: false, default: false })).toBe(false);
  });
});

describe('validation mirrors pkg/platformflags', () => {
  it('accepts a well-formed definition', () => {
    expect(validateDefinition(allowAccount(base, A), { groups: { internal: [] }, attributes: ['account', 'plan', 'org'] })).toEqual([]);
  });

  it('refuses what apid refuses', () => {
    const errors = validateDefinition(
      {
        enabled: true,
        default: false,
        rules: [
          { id: 'Bad', accounts: ['acme'], value: true },
          { id: 'dup', group: 'missing', value: true },
          { id: 'dup', plans: ['gold' as never], value: null },
          { id: 'empty', value: true },
          { id: 'window', starts_at: '2026-11-02T00:00:00Z', ends_at: '2026-11-01T00:00:00Z', value: true },
          { id: 'roll', rollout: 10001, value: true },
        ],
        self_serve: { enabled: true, max_subjects: 6000 },
      },
      { groups: { internal: [] } },
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'rule "Bad": id must match ^[a-z][a-z0-9_-]{0,63}$',
        'rule "Bad": account "acme" is not a canonical account UUID',
        'rule "dup" references unknown group "missing"',
        'duplicate rule id "dup"',
        'rule "dup" requires an explicit boolean value',
        'rule "dup": invalid or duplicate plan "gold"',
        'rule "empty" requires accounts, orgs, group, plans, rollout or a schedule window',
        'rule "window": ends_at must be after starts_at',
        'rule "roll": rollout must be 0..10000 basis points',
        'self_serve: max_subjects must be 0..5000',
      ]),
    );
  });

  it('refuses plan or org targeting the flag cannot evaluate', () => {
    const def: PlatformFlagDefinition = {
      enabled: true,
      default: false,
      rules: [{ id: 'paid', plans: ['pro'], value: true }, { id: 'acme', orgs: [B], value: true }],
      self_serve: { enabled: true, plans: ['pro'] },
    };
    expect(validateDefinition(def, { attributes: ['account'] })).toEqual([
      'rule "paid" targets plans, but this flag is decided where the plan is unknown',
      'rule "acme" targets organizations, but this flag is decided where the organization is unknown',
      'self_serve limits plans, but this flag is decided where the plan is unknown',
    ]);
    expect(validateDefinition(def, { attributes: ['account', 'plan', 'org'] })).toEqual([]);
  });

  it('checks ramps like validateRamp', () => {
    const ramp = { stages: [100, 1000], interval_seconds: 600, max_5xx_basis_points: 50, min_requests: 10, on_breach: 'pause' };
    const ok: PlatformFlagDefinition = { enabled: true, default: false, rules: [{ id: 'rollout', rollout: 100, ramp, value: true }] };
    expect(validateDefinition(ok)).toEqual([]);
    const off = (patch: object, rollout = 100) =>
      validateDefinition({ enabled: true, default: false, rules: [{ id: 'rollout', rollout, ramp: { ...ramp, ...patch }, value: true }] });
    expect(off({}, 500)).toEqual(['rule "rollout": rollout 500 is not one of the ramp stages']);
    expect(off({ stages: [1000, 100] }, 100)).toEqual(['rule "rollout": ramp stages must ascend strictly within 1..10000 basis points']);
    expect(off({ interval_seconds: 60 })).toEqual(['rule "rollout": ramp interval_seconds must be 300..604800']);
    expect(off({ on_breach: 'explode' })).toEqual(['rule "rollout": ramp on_breach must be "pause" or "rollback"']);
  });

  it('normalizes ids, plans and times the way apid stores them', () => {
    const def = normalizeDefinition({
      enabled: true,
      default: false,
      rules: [{ id: ' vip ', accounts: [`{${A.toUpperCase()}}`], plans: ['PRO' as never], starts_at: '2026-11-01T01:00:00.900+01:00', value: true }],
    });
    expect(def.rules?.[0]).toEqual({ id: 'vip', accounts: [A], plans: ['pro'], starts_at: '2026-11-01T00:00:00Z', value: true });
  });
});

describe('strict JSON editing', () => {
  it('refuses unknown fields like a misspelled "acounts"', () => {
    const result = parseDefinitionJSON('{"enabled":true,"default":false,"rules":[{"id":"a","acounts":[],"value":true}]}');
    expect(result).toEqual({ errors: ['rules[0] has unknown field "acounts"'] });
  });

  it('refuses bad types and bad JSON', () => {
    expect(parseDefinitionJSON('{"enabled":"yes"}')).toEqual({ errors: ['definition.enabled must be a boolean'] });
    expect(parseDefinitionJSON('{"rules":[{"id":"a","starts_at":"tomorrow","value":true}]}')).toEqual({
      errors: ['rules[0].starts_at must be an RFC 3339 timestamp'],
    });
    expect('errors' in parseDefinitionJSON('{')).toBe(true);
  });

  it('returns the normalized value for good input', () => {
    expect(parseDefinitionJSON(`{"enabled":true,"default":false,"rules":[{"id":"a","accounts":["${A.toUpperCase()}"],"value":true}]}`)).toEqual({
      value: { enabled: true, default: false, rules: [{ id: 'a', accounts: [A], value: true }] },
    });
  });
});

describe('groups and opt-ins', () => {
  it('edits groups and validates them', () => {
    expect(editGroup({ internal: [A] }, 'partners', B, true)).toEqual({ internal: [A], partners: [B] });
    expect(editGroup({ internal: [A] }, 'internal', A, false)).toEqual({ internal: [] });
    expect(removeGroup(addGroup({}, 'beta'), 'beta')).toEqual({});
    expect(validateGroups({ 'Bad Name': [], ok: ['acme'] })).toEqual([
      'group name "Bad Name" must match ^[a-z][a-z0-9_-]{0,63}$',
      'group "ok": account "acme" is not a canonical account UUID',
    ]);
  });

  it('summarizes group and opt-in changes', () => {
    expect(diffGroups({ internal: [A], old: [B] }, { internal: [B], beta: [] })).toEqual([
      'Create group beta',
      `internal: add ${B}`,
      `internal: remove ${A}`,
      'Delete group old (1 account)',
    ]);
    expect(diffOptIns({ accounts: [A] }, { orgs: [B] })).toEqual([`Remove account ${A} from the preview`, `Opt in organization ${B}`]);
  });

  it('names groups a flag still uses before apid refuses the write', () => {
    expect(groupsStillReferenced({ internal: [] }, { internal: ['ai_gateway'], partners: ['service_map', 'ai_gateway'] })).toEqual([
      'partners (service_map, ai_gateway)',
    ]);
  });

  it('edits opt-ins and refuses org opt-ins on a flag without org context', () => {
    const optIns = editOptIns(editOptIns({}, A.toUpperCase(), 'account', true), B, 'org', true);
    expect(optIns).toEqual({ accounts: [A], orgs: [B] });
    expect(editOptIns(optIns, B, 'org', false)).toEqual({ accounts: [A] });
    expect(validateOptIns(optIns, ['account', 'plan'])).toEqual([
      'this flag is decided where the organization is unknown, so organizations cannot opt in',
    ]);
    expect(validateOptIns(optIns, ['account', 'plan', 'org'])).toEqual([]);
  });
});

describe('reading', () => {
  it('describes targeting', () => {
    expect(describeRule({ id: 'r', accounts: [A, B], group: 'partners', plans: ['pro', 'scale'], rollout: 1000, value: true }, {})).toBe(
      '2 accounts · group partners (missing) · pro, scale · 10%',
    );
  });

  it('summarizes a change line by line', () => {
    const after = setRollout(denyAccount({ ...base, enabled: false }, A), 5);
    expect(diffDefinition(base, after, { internal: [A] })).toEqual([
      'Kill switch on → off: off for every account, whatever the rules say',
      `Add rule denied-accounts: off for 1 account`,
      'Add rule rollout: on for 5%',
    ]);
    expect(diffDefinition(allowAccount(base, A), moveRule(allowAccount(base, A), 'internal', -1))).toEqual(['Reorder rules (the first match decides)']);
    expect(diffDefinition(base, setSelfServe(base, { enabled: true, plans: ['pro'] }))).toEqual([
      'Self-serve preview not offered → open to pro',
    ]);
  });

  it('explains decisions in support-ready words', () => {
    const decision: OperatorPlatformFlagDecision = {
      flag: 'ai_gateway',
      account_id: A,
      plan: 'free',
      enabled: true,
      reason: 'rule_match',
      rule_id: 'rollout',
      bucket: 42,
      version: 3,
      entitled: false,
      available: false,
      scheduled_rule_id: 'launch',
      schedule_state: 'rule_not_started',
    };
    expect(explainDecision(decision)).toEqual([
      'Rule "rollout" matched (rollout bucket 42 of 10000) and turns the flag on.',
      'Rule "launch" would have matched, but its schedule has not started yet.',
      'The free plan is not entitled to the capability, so it stays unavailable whatever the flag says.',
    ]);
    expect(explainDecision({ ...decision, reason: 'flag_disabled', enabled: false, scheduled_rule_id: undefined, entitled: undefined })).toEqual([
      'The kill switch is off, so the flag is off for every account.',
    ]);
  });

  it('canonicalizes UUID spellings Go accepts', () => {
    expect(canonicalUUID(`urn:uuid:${A.toUpperCase()}`)).toBe(A);
    expect(canonicalUUID(A.replaceAll('-', ''))).toBe(A);
    expect(isUUID('acme')).toBe(false);
    expect(toRfc3339Seconds('2026-11-01T00:00:00.999Z')).toBe('2026-11-01T00:00:00Z');
    expect(toRfc3339Seconds('nope')).toBeNull();
  });
});
