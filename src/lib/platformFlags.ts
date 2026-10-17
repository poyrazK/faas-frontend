import type {
  OperatorPlatformFlag,
  PlatformFlagDefinition,
  PlatformFlagPlan,
  PlatformFlagRule,
} from '@/lib/api';

/**
 * Pure edits of a platform flag definition (ADR-1550). They mirror
 * `gregalectl flags`: explicit account decisions live in two rules kept
 * first — `denied-accounts`, then `accounts` — so they always beat a group,
 * plan or rollout rule. The server re-validates every write.
 */

export const DENY_RULE_ID = 'denied-accounts';
export const ALLOW_RULE_ID = 'accounts';
export const ROLLOUT_RULE_ID = 'rollout';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAccountID(value: string): boolean {
  return UUID.test(value.trim());
}

function clone(def: PlatformFlagDefinition): PlatformFlagDefinition {
  return {
    enabled: def.enabled,
    default: def.default,
    rules: (def.rules ?? []).map((rule) => ({
      ...rule,
      ...(rule.accounts ? { accounts: [...rule.accounts] } : {}),
      ...(rule.plans ? { plans: [...rule.plans] } : {}),
    })),
  };
}

function hasTargeting(rule: PlatformFlagRule): boolean {
  return (rule.accounts?.length ?? 0) > 0 || !!rule.group || (rule.plans?.length ?? 0) > 0 || rule.rollout != null;
}

function removeFromRule(def: PlatformFlagDefinition, ruleID: string, account: string): void {
  const rules = def.rules ?? [];
  const index = rules.findIndex((rule) => rule.id === ruleID);
  if (index < 0) return;
  const rule = rules[index];
  rule.accounts = (rule.accounts ?? []).filter((id) => id !== account);
  if (rule.accounts.length === 0) delete rule.accounts;
  if (!hasTargeting(rule)) rules.splice(index, 1);
}

function addToRule(def: PlatformFlagDefinition, ruleID: string, account: string, value: boolean): void {
  const rules = (def.rules ??= []);
  const existing = rules.find((rule) => rule.id === ruleID);
  if (existing) {
    existing.accounts = [...(existing.accounts ?? []), account];
    return;
  }
  const position = ruleID === ALLOW_RULE_ID && rules[0]?.id === DENY_RULE_ID ? 1 : 0;
  rules.splice(position, 0, { id: ruleID, accounts: [account], value });
}

export function allowAccount(def: PlatformFlagDefinition, accountID: string): PlatformFlagDefinition {
  const account = accountID.trim().toLowerCase();
  const next = clone(def);
  removeFromRule(next, DENY_RULE_ID, account);
  removeFromRule(next, ALLOW_RULE_ID, account);
  addToRule(next, ALLOW_RULE_ID, account, true);
  return next;
}

export function denyAccount(def: PlatformFlagDefinition, accountID: string): PlatformFlagDefinition {
  const account = accountID.trim().toLowerCase();
  const next = clone(def);
  removeFromRule(next, DENY_RULE_ID, account);
  removeFromRule(next, ALLOW_RULE_ID, account);
  addToRule(next, DENY_RULE_ID, account, false);
  return next;
}

export function revokeAccount(def: PlatformFlagDefinition, accountID: string): PlatformFlagDefinition {
  const account = accountID.trim().toLowerCase();
  const next = clone(def);
  removeFromRule(next, DENY_RULE_ID, account);
  removeFromRule(next, ALLOW_RULE_ID, account);
  return next;
}

/** Sets the trailing rollout rule; 0% removes it. */
export function setRollout(
  def: PlatformFlagDefinition,
  percent: number,
  plans: PlatformFlagPlan[] = [],
): PlatformFlagDefinition {
  const next = clone(def);
  next.rules = (next.rules ?? []).filter((rule) => rule.id !== ROLLOUT_RULE_ID);
  const basisPoints = Math.round(percent * 100);
  if (basisPoints <= 0) return next;
  next.rules.push({
    id: ROLLOUT_RULE_ID,
    rollout: Math.min(basisPoints, 10000),
    value: true,
    ...(plans.length ? { plans: [...plans] } : {}),
  });
  return next;
}

export function addGroupRule(def: PlatformFlagDefinition, group: string, value: boolean): PlatformFlagDefinition {
  const next = clone(def);
  const id = `group-${group}`;
  next.rules = (next.rules ?? []).filter((rule) => rule.id !== id);
  // After the explicit account rules, before any rollout.
  const explicit = next.rules.filter((rule) => rule.id === DENY_RULE_ID || rule.id === ALLOW_RULE_ID).length;
  next.rules.splice(explicit, 0, { id, group, value });
  return next;
}

export function removeRule(def: PlatformFlagDefinition, ruleID: string): PlatformFlagDefinition {
  const next = clone(def);
  next.rules = (next.rules ?? []).filter((rule) => rule.id !== ruleID);
  return next;
}

/** Moves a rule up (-1) or down (+1); order decides the first match. */
export function moveRule(def: PlatformFlagDefinition, ruleID: string, delta: -1 | 1): PlatformFlagDefinition {
  const next = clone(def);
  const rules = next.rules ?? [];
  const from = rules.findIndex((rule) => rule.id === ruleID);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= rules.length) return next;
  [rules[from], rules[to]] = [rules[to], rules[from]];
  return next;
}

export function setSwitch(def: PlatformFlagDefinition, enabled: boolean): PlatformFlagDefinition {
  return { ...clone(def), enabled };
}

export function setDefault(def: PlatformFlagDefinition, value: boolean): PlatformFlagDefinition {
  return { ...clone(def), default: value };
}

/** The version a write must expect: 0 until an operator has written the flag. */
export function expectedVersion(flag: Pick<OperatorPlatformFlag, 'source' | 'version'>): number {
  return flag.source === 'operator' ? flag.version : 0;
}

/** Human summary of a rule's targeting, e.g. "3 accounts · group partners · pro, scale · 10%". */
export function describeRule(rule: PlatformFlagRule, groups: Record<string, string[]> = {}): string {
  const parts: string[] = [];
  if (rule.accounts?.length) parts.push(`${rule.accounts.length} account${rule.accounts.length === 1 ? '' : 's'}`);
  if (rule.group) {
    const members = groups[rule.group];
    parts.push(members ? `group ${rule.group} (${members.length})` : `group ${rule.group} (missing)`);
  }
  if (rule.plans?.length) parts.push(rule.plans.join(', '));
  if (rule.rollout != null) parts.push(`${rule.rollout / 100}%`);
  return parts.join(' · ') || 'no targeting';
}

/** Adds or removes one account in a group, returning the new groups value. */
export function editGroup(
  groups: Record<string, string[]>,
  group: string,
  accountID: string,
  add: boolean,
): Record<string, string[]> {
  const account = accountID.trim().toLowerCase();
  const next: Record<string, string[]> = {};
  for (const [name, members] of Object.entries(groups)) next[name] = [...members];
  const members = (next[group] ?? []).filter((id) => id !== account);
  next[group] = add ? [...members, account] : members;
  return next;
}
