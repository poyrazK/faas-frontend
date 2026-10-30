/* ==========================================================================
   Platform flags — pure edits and the client half of the write checks.

   Edits mirror `gregalectl flags`: explicit account decisions live in two
   rules kept first — `denied-accounts`, then `accounts` — so they always beat
   a group, plan or rollout rule.

   Validation mirrors faas origin/main pkg/platformflags (ParseDefinition,
   ValidateDefinition, validateRamp, ValidateTargeting, ParseGroups,
   ParseOptIns) and the bounds in pkg/api/limits.go, so an operator learns
   about a bad edit while composing it, not from a 400 after the step-up
   prompt. Checks that need server state stay server-side: health routes for
   ramps, plan entitlement of self-serve plans, and the live group snapshot.
   ========================================================================== */

import type { Plan } from '@/lib/api';
import type {
  OperatorPlatformFlag,
  OperatorPlatformFlagDecision,
  PlatformFlagDefinition,
  PlatformFlagOptIns,
  PlatformFlagRamp,
  PlatformFlagRule,
  PlatformFlagSelfServe,
} from './flags';

/* ─────────────────────────────── Bounds ───────────────────────────────── */

export const FLAG_LIMITS = {
  maxRules: 32,
  maxAccountsPerRule: 1000,
  maxOrgsPerRule: 1000,
  maxGroups: 100,
  maxAccountsPerGroup: 5000,
  maxDefinitionBytes: 64 << 10,
  maxGroupsBytes: 512 << 10,
  maxOptInSubjects: 5000,
  maxOptInsBytes: 256 << 10,
  minRampStages: 2,
  maxRampStages: 10,
  minRampIntervalSeconds: 300,
  maxRampIntervalSeconds: 7 * 24 * 3600,
  maxPausedReasonBytes: 500,
} as const;

export const PLANS: readonly Plan[] = ['free', 'hobby', 'pro', 'scale'];

export const DENY_RULE_ID = 'denied-accounts';
export const ALLOW_RULE_ID = 'accounts';
export const ROLLOUT_RULE_ID = 'rollout';

/** Rule ids and group names (pkg/flags ValidKey). */
export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/* ──────────────────────────────── IDs ─────────────────────────────────── */

const HEX32 = /^[0-9a-f]{32}$/i;

/**
 * The canonical lowercase hyphenated form of a UUID in any spelling Go's
 * uuid.Parse accepts (hyphenated, urn:uuid:, braces, 32 hex), or null.
 */
export function canonicalUUID(raw: string): string | null {
  let value = raw.trim();
  if (value.toLowerCase().startsWith('urn:uuid:')) value = value.slice(9);
  if (value.length === 38 && value.startsWith('{') && value.endsWith('}')) value = value.slice(1, -1);
  if (value.length === 36) {
    if (value[8] !== '-' || value[13] !== '-' || value[18] !== '-' || value[23] !== '-') return null;
    value = value.replaceAll('-', '');
  }
  if (!HEX32.test(value)) return null;
  const hex = value.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const isUUID = (raw: string) => canonicalUUID(raw) !== null;

/** Canonicalizes what parses and keeps anything else as typed, like Go's normalizeAccounts. */
function normalizeIds(ids: readonly string[] | undefined): string[] | undefined {
  if (!ids || ids.length === 0) return undefined;
  return ids.map((id) => canonicalUUID(id) ?? id.trim());
}

function normalizePlans(plans: readonly string[] | undefined): Plan[] | undefined {
  if (!plans || plans.length === 0) return undefined;
  return plans.map((plan) => plan.trim().toLowerCase() as Plan);
}

/** RFC 3339 at whole-second precision, as apid stores schedule boundaries. */
export function toRfc3339Seconds(input: string | Date): string | null {
  const ms = input instanceof Date ? input.getTime() : Date.parse(input);
  if (!Number.isFinite(ms)) return null;
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

/* ───────────────────────────── Normalizing ────────────────────────────── */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The form apid stores (NormalizeDefinition): trimmed ids and group, UUIDs
 * canonical, plans lowercase, schedule boundaries in UTC seconds, on_breach
 * lowercase, empty lists omitted.
 */
export function normalizeDefinition(def: PlatformFlagDefinition): PlatformFlagDefinition {
  const out: PlatformFlagDefinition = { enabled: def.enabled, default: def.default };
  if (def.rules && def.rules.length > 0) {
    out.rules = def.rules.map((rule) => {
      const next: PlatformFlagRule = { id: (rule.id ?? '').trim(), value: rule.value ?? null };
      const accounts = normalizeIds(rule.accounts);
      const orgs = normalizeIds(rule.orgs);
      const plans = normalizePlans(rule.plans);
      const group = (rule.group ?? '').trim();
      if (accounts) next.accounts = accounts;
      if (orgs) next.orgs = orgs;
      if (group) next.group = group;
      if (plans) next.plans = plans;
      if (rule.rollout !== undefined && rule.rollout !== null) next.rollout = rule.rollout;
      if (rule.starts_at) next.starts_at = toRfc3339Seconds(rule.starts_at) ?? rule.starts_at;
      if (rule.ends_at) next.ends_at = toRfc3339Seconds(rule.ends_at) ?? rule.ends_at;
      if (rule.ramp) {
        const ramp: PlatformFlagRamp = { ...clone(rule.ramp), on_breach: String(rule.ramp.on_breach ?? '').trim().toLowerCase() };
        if (!ramp.paused) delete ramp.paused;
        if (!ramp.paused_reason) delete ramp.paused_reason;
        next.ramp = ramp;
      }
      return next;
    });
  }
  if (def.self_serve) {
    const selfServe: PlatformFlagSelfServe = { enabled: def.self_serve.enabled };
    const plans = normalizePlans(def.self_serve.plans);
    if (plans) selfServe.plans = plans;
    if (def.self_serve.max_subjects) selfServe.max_subjects = def.self_serve.max_subjects;
    out.self_serve = selfServe;
  }
  return out;
}

/* ───────────────────────────── Validation ─────────────────────────────── */

export interface FlagValidationContext {
  /** Live group map; when given, every referenced group must exist in it. */
  groups?: Record<string, string[]>;
  /** The flag's attributes; plan and org targeting need them. */
  attributes?: readonly string[];
}

function validateIds(ids: readonly string[] | undefined, limit: number, noun: string): string | null {
  if (!ids) return null;
  if (ids.length > limit) return `at most ${limit} ${noun}s are allowed`;
  const seen = new Set<string>();
  for (const raw of ids) {
    if (canonicalUUID(raw) !== raw) return `${noun} "${raw}" is not a canonical ${noun} UUID`;
    if (seen.has(raw)) return `duplicate ${noun} "${raw}"`;
    seen.add(raw);
  }
  return null;
}

function validatePlans(plans: readonly string[] | undefined): string | null {
  const seen = new Set<string>();
  for (const plan of plans ?? []) {
    if (!PLANS.includes(plan as Plan) || seen.has(plan)) return `invalid or duplicate plan "${plan}"`;
    seen.add(plan);
  }
  return null;
}

function validateRamp(rule: PlatformFlagRule): string | null {
  const ramp = rule.ramp;
  if (!ramp) return null;
  if (rule.rollout === undefined || rule.rollout === null) return 'a ramp needs a rollout: the rollout is the current stage';
  const stages = ramp.stages ?? [];
  if (stages.length < FLAG_LIMITS.minRampStages || stages.length > FLAG_LIMITS.maxRampStages) {
    return `a ramp needs ${FLAG_LIMITS.minRampStages} to ${FLAG_LIMITS.maxRampStages} stages`;
  }
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (!Number.isInteger(stage) || stage < 1 || stage > 10000 || (i > 0 && stage <= stages[i - 1])) {
      return 'ramp stages must ascend strictly within 1..10000 basis points';
    }
  }
  if (!stages.includes(rule.rollout)) return `rollout ${rule.rollout} is not one of the ramp stages`;
  if (
    !Number.isInteger(ramp.interval_seconds) ||
    ramp.interval_seconds < FLAG_LIMITS.minRampIntervalSeconds ||
    ramp.interval_seconds > FLAG_LIMITS.maxRampIntervalSeconds
  ) {
    return `ramp interval_seconds must be ${FLAG_LIMITS.minRampIntervalSeconds}..${FLAG_LIMITS.maxRampIntervalSeconds}`;
  }
  if (!Number.isInteger(ramp.max_5xx_basis_points) || ramp.max_5xx_basis_points < 0 || ramp.max_5xx_basis_points > 10000) {
    return 'ramp max_5xx_basis_points must be 0..10000';
  }
  if (!Number.isInteger(ramp.min_requests) || ramp.min_requests < 0) return 'ramp min_requests must not be negative';
  if (ramp.on_breach !== 'pause' && ramp.on_breach !== 'rollback') return 'ramp on_breach must be "pause" or "rollback"';
  if (ramp.paused_reason && utf8Bytes(ramp.paused_reason) > FLAG_LIMITS.maxPausedReasonBytes) {
    return `ramp paused_reason must be at most ${FLAG_LIMITS.maxPausedReasonBytes} characters`;
  }
  return null;
}

/**
 * Every problem apid would refuse a normalized definition for, as messages
 * fit for the editor. Empty means the server-side checks it can know about
 * will pass.
 */
export function validateDefinition(def: PlatformFlagDefinition, ctx: FlagValidationContext = {}): string[] {
  const errors: string[] = [];
  const rules = def.rules ?? [];
  if (utf8Bytes(JSON.stringify(def)) > FLAG_LIMITS.maxDefinitionBytes) {
    errors.push(`flag definition exceeds ${FLAG_LIMITS.maxDefinitionBytes} bytes; move large audiences into a group`);
  }
  if (rules.length > FLAG_LIMITS.maxRules) errors.push(`a flag may have at most ${FLAG_LIMITS.maxRules} rules`);
  const supports = (attr: string) => !ctx.attributes || ctx.attributes.includes(attr);
  const ids = new Set<string>();
  for (const rule of rules) {
    const at = `rule "${rule.id}"`;
    if (!FLAG_KEY_PATTERN.test(rule.id)) errors.push(`${at}: id must match ^[a-z][a-z0-9_-]{0,63}$`);
    if (ids.has(rule.id)) errors.push(`duplicate rule id "${rule.id}"`);
    ids.add(rule.id);
    if (typeof rule.value !== 'boolean') errors.push(`${at} requires an explicit boolean value`);
    const targeted =
      !!rule.accounts?.length || !!rule.orgs?.length || !!rule.group || !!rule.plans?.length ||
      (rule.rollout !== undefined && rule.rollout !== null) || !!rule.starts_at || !!rule.ends_at;
    if (!targeted) errors.push(`${at} requires accounts, orgs, group, plans, rollout or a schedule window`);
    if (rule.starts_at && rule.ends_at && !(Date.parse(rule.ends_at) > Date.parse(rule.starts_at))) {
      errors.push(`${at}: ends_at must be after starts_at`);
    }
    const accountError = validateIds(rule.accounts, FLAG_LIMITS.maxAccountsPerRule, 'account');
    if (accountError) errors.push(`${at}: ${accountError}`);
    const orgError = validateIds(rule.orgs, FLAG_LIMITS.maxOrgsPerRule, 'organization');
    if (orgError) errors.push(`${at}: ${orgError}`);
    if (rule.group) {
      if (!FLAG_KEY_PATTERN.test(rule.group)) errors.push(`${at}: invalid group name "${rule.group}"`);
      else if (ctx.groups && !(rule.group in ctx.groups)) errors.push(`${at} references unknown group "${rule.group}"`);
    }
    const planError = validatePlans(rule.plans);
    if (planError) errors.push(`${at}: ${planError}`);
    if (rule.rollout !== undefined && rule.rollout !== null && (!Number.isInteger(rule.rollout) || rule.rollout < 0 || rule.rollout > 10000)) {
      errors.push(`${at}: rollout must be 0..10000 basis points`);
    }
    const rampError = validateRamp(rule);
    if (rampError) errors.push(`${at}: ${rampError}`);
    if (rule.plans?.length && !supports('plan')) {
      errors.push(`${at} targets plans, but this flag is decided where the plan is unknown`);
    }
    if (rule.orgs?.length && !supports('org')) {
      errors.push(`${at} targets organizations, but this flag is decided where the organization is unknown`);
    }
  }
  const selfServe = def.self_serve;
  if (selfServe) {
    const planError = validatePlans(selfServe.plans);
    if (planError) errors.push(`self_serve: ${planError}`);
    const max = selfServe.max_subjects ?? 0;
    if (!Number.isInteger(max) || max < 0 || max > FLAG_LIMITS.maxOptInSubjects) {
      errors.push(`self_serve: max_subjects must be 0..${FLAG_LIMITS.maxOptInSubjects}`);
    }
    if (selfServe.plans?.length && !supports('plan')) {
      errors.push('self_serve limits plans, but this flag is decided where the plan is unknown');
    }
  }
  return errors;
}

/* ───────────────────────── Strict JSON parsing ────────────────────────── */

const DEFINITION_KEYS = new Set(['enabled', 'default', 'rules', 'self_serve']);
const RULE_KEYS = new Set(['id', 'accounts', 'orgs', 'group', 'plans', 'rollout', 'starts_at', 'ends_at', 'ramp', 'value']);
const RAMP_KEYS = new Set(['stages', 'interval_seconds', 'max_5xx_basis_points', 'min_requests', 'on_breach', 'paused', 'paused_reason']);
const SELF_SERVE_KEYS = new Set(['enabled', 'plans', 'max_subjects']);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function shapeErrors(value: unknown, where: string, keys: Set<string>, types: Record<string, string>): string[] {
  if (!isObject(value)) return [`${where} must be an object`];
  const errors: string[] = [];
  for (const [key, field] of Object.entries(value)) {
    if (!keys.has(key)) {
      errors.push(`${where} has unknown field "${key}"`);
      continue;
    }
    const want = types[key];
    // Go decodes JSON null into an optional field as "absent".
    if (!want || field === undefined || field === null) continue;
    const ok =
      want === 'string[]'
        ? Array.isArray(field) && field.every((item) => typeof item === 'string')
        : want === 'number[]'
          ? Array.isArray(field) && field.every((item) => typeof item === 'number')
          : want === 'time'
            ? typeof field === 'string' && RFC3339.test(field) && Number.isFinite(Date.parse(field))
            : want === 'array'
              ? Array.isArray(field)
              : want === 'object'
                ? isObject(field)
                : typeof field === want;
    if (!ok) errors.push(`${where}.${key} must be ${want === 'time' ? 'an RFC 3339 timestamp' : `a ${want}`}`);
  }
  return errors;
}

/**
 * Parses operator-typed JSON the way apid's strict decoder does: unknown
 * fields are refused so a misspelled "acounts" cannot silently produce a
 * rule that matches nobody.
 */
export function parseDefinitionJSON(text: string): { value: PlatformFlagDefinition } | { errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { errors: [`Invalid JSON: ${(err as Error).message}`] };
  }
  const errors = shapeErrors(raw, 'definition', DEFINITION_KEYS, {
    enabled: 'boolean',
    default: 'boolean',
    rules: 'array',
    self_serve: 'object',
  });
  if (isObject(raw)) {
    if (Array.isArray(raw.rules)) {
      raw.rules.forEach((rule, index) => {
        const where = `rules[${index}]`;
        errors.push(
          ...shapeErrors(rule, where, RULE_KEYS, {
            id: 'string',
            accounts: 'string[]',
            orgs: 'string[]',
            group: 'string',
            plans: 'string[]',
            rollout: 'number',
            starts_at: 'time',
            ends_at: 'time',
            ramp: 'object',
          }),
        );
        if (isObject(rule) && isObject(rule.ramp)) {
          errors.push(
            ...shapeErrors(rule.ramp, `${where}.ramp`, RAMP_KEYS, {
              stages: 'number[]',
              interval_seconds: 'number',
              max_5xx_basis_points: 'number',
              min_requests: 'number',
              on_breach: 'string',
              paused: 'boolean',
              paused_reason: 'string',
            }),
          );
        }
      });
    }
    if (isObject(raw.self_serve)) {
      errors.push(
        ...shapeErrors(raw.self_serve, 'self_serve', SELF_SERVE_KEYS, {
          enabled: 'boolean',
          plans: 'string[]',
          max_subjects: 'number',
        }),
      );
    }
  }
  if (errors.length) return { errors };
  const def = raw as PlatformFlagDefinition;
  return { value: normalizeDefinition({ ...def, enabled: def.enabled ?? false, default: def.default ?? false }) };
}

/* ─────────────────────────────── Edits ────────────────────────────────── */

function hasTargeting(rule: PlatformFlagRule): boolean {
  return (
    !!rule.accounts?.length || !!rule.orgs?.length || !!rule.group || !!rule.plans?.length ||
    (rule.rollout !== undefined && rule.rollout !== null) || !!rule.starts_at || !!rule.ends_at
  );
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

function tidy(def: PlatformFlagDefinition): PlatformFlagDefinition {
  if (def.rules && def.rules.length === 0) delete def.rules;
  return def;
}

function accountEdit(def: PlatformFlagDefinition, accountID: string, add?: { rule: string; value: boolean }) {
  const account = canonicalUUID(accountID) ?? accountID.trim();
  const next = clone(def);
  removeFromRule(next, DENY_RULE_ID, account);
  removeFromRule(next, ALLOW_RULE_ID, account);
  if (add) addToRule(next, add.rule, account, add.value);
  return tidy(next);
}

/** Turns the flag on for one account, ahead of every group, plan or rollout rule. */
export const allowAccount = (def: PlatformFlagDefinition, accountID: string) =>
  accountEdit(def, accountID, { rule: ALLOW_RULE_ID, value: true });

/** Turns the flag off for one account, ahead of everything else. */
export const denyAccount = (def: PlatformFlagDefinition, accountID: string) =>
  accountEdit(def, accountID, { rule: DENY_RULE_ID, value: false });

/** Drops an explicit decision so the account falls through to the other rules. */
export const revokeAccount = (def: PlatformFlagDefinition, accountID: string) => accountEdit(def, accountID);

/**
 * Sets the rollout rule's percentage (0 removes it). An existing rollout rule
 * keeps its place, window and ramp; a new one is appended last.
 */
export function setRollout(def: PlatformFlagDefinition, percent: number, plans: Plan[] = []): PlatformFlagDefinition {
  const next = clone(def);
  const rules = (next.rules ??= []);
  const basisPoints = Math.min(10000, Math.round(percent * 100));
  const index = rules.findIndex((rule) => rule.id === ROLLOUT_RULE_ID);
  if (basisPoints <= 0) {
    if (index >= 0) rules.splice(index, 1);
    return tidy(next);
  }
  const rule: PlatformFlagRule = index >= 0 ? rules[index] : { id: ROLLOUT_RULE_ID, value: true };
  rule.rollout = basisPoints;
  if (plans.length) rule.plans = [...plans];
  else delete rule.plans;
  if (index < 0) rules.push(rule);
  return next;
}

/** Adds (or replaces) a group rule after the explicit account rules. */
export function addGroupRule(def: PlatformFlagDefinition, group: string, value: boolean): PlatformFlagDefinition {
  const next = clone(def);
  const id = `group-${group}`;
  next.rules = (next.rules ?? []).filter((rule) => rule.id !== id);
  const explicit = next.rules.filter((rule) => rule.id === DENY_RULE_ID || rule.id === ALLOW_RULE_ID).length;
  next.rules.splice(explicit, 0, { id, group, value });
  return next;
}

export function removeRule(def: PlatformFlagDefinition, ruleID: string): PlatformFlagDefinition {
  const next = clone(def);
  next.rules = (next.rules ?? []).filter((rule) => rule.id !== ruleID);
  return tidy(next);
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

/** Clears a breached ramp's pause so the worker judges the next stage again. */
export function resumeRamp(def: PlatformFlagDefinition, ruleID: string): PlatformFlagDefinition {
  const next = clone(def);
  const ramp = next.rules?.find((rule) => rule.id === ruleID)?.ramp;
  if (ramp) {
    delete ramp.paused;
    delete ramp.paused_reason;
  }
  return next;
}

export const setSwitch = (def: PlatformFlagDefinition, enabled: boolean): PlatformFlagDefinition => ({ ...clone(def), enabled });

export const setDefault = (def: PlatformFlagDefinition, value: boolean): PlatformFlagDefinition => ({ ...clone(def), default: value });

/** Sets or removes the self-serve block; other fields are kept. */
export function setSelfServe(def: PlatformFlagDefinition, selfServe: PlatformFlagSelfServe | null): PlatformFlagDefinition {
  const next = clone(def);
  if (selfServe) next.self_serve = clone(selfServe);
  else delete next.self_serve;
  return next;
}

/* ─────────────────────────── Write preconditions ──────────────────────── */

/** The version a write must expect: 0 until an operator has written the flag. */
export function expectedVersion(flag: Pick<OperatorPlatformFlag, 'source' | 'version'>): number {
  return flag.source === 'operator' ? flag.version : 0;
}

/**
 * apid refuses a core capability flag left off — kill switch or default —
 * without force (409 "Core capability flag"). Known before sending.
 */
export function needsForce(flag: Pick<OperatorPlatformFlag, 'core'>, def: PlatformFlagDefinition): boolean {
  return !!flag.core && (!def.enabled || !def.default);
}

export const CORE_FLAG_PROBLEM_TITLE = 'Core capability flag';

/* ─────────────────────────────── Groups ───────────────────────────────── */

/** Adds or removes one account in a group, returning the new groups value. */
export function editGroup(
  groups: Record<string, string[]>,
  group: string,
  accountID: string,
  add: boolean,
): Record<string, string[]> {
  const account = canonicalUUID(accountID) ?? accountID.trim();
  const next = clone(groups);
  const members = (next[group] ?? []).filter((id) => id !== account);
  next[group] = add ? [...members, account] : members;
  return next;
}

export function addGroup(groups: Record<string, string[]>, name: string): Record<string, string[]> {
  const next = clone(groups);
  next[name.trim()] ??= [];
  return next;
}

export function removeGroup(groups: Record<string, string[]>, name: string): Record<string, string[]> {
  const next = clone(groups);
  delete next[name];
  return next;
}

export function validateGroups(groups: Record<string, string[]>): string[] {
  const errors: string[] = [];
  const names = Object.keys(groups);
  if (utf8Bytes(JSON.stringify(groups)) > FLAG_LIMITS.maxGroupsBytes) errors.push(`flag groups exceed ${FLAG_LIMITS.maxGroupsBytes} bytes`);
  if (names.length > FLAG_LIMITS.maxGroups) errors.push(`at most ${FLAG_LIMITS.maxGroups} flag groups are allowed`);
  for (const name of names) {
    if (!FLAG_KEY_PATTERN.test(name)) errors.push(`group name "${name}" must match ^[a-z][a-z0-9_-]{0,63}$`);
    const memberError = validateIds(groups[name], FLAG_LIMITS.maxAccountsPerGroup, 'account');
    if (memberError) errors.push(`group "${name}": ${memberError}`);
  }
  return errors;
}

/** "group (flag, flag)" for every referenced group the proposal removes (apid answers 409). */
export function groupsStillReferenced(
  proposed: Record<string, string[]>,
  references: Record<string, string[]>,
): string[] {
  return Object.entries(references)
    .filter(([group, flags]) => flags.length > 0 && !(group in proposed))
    .map(([group, flags]) => `${group} (${flags.join(', ')})`)
    .sort();
}

/** One line per group change, for the confirmation dialog. */
export function diffGroups(before: Record<string, string[]>, after: Record<string, string[]>): string[] {
  const lines: string[] = [];
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const name of names) {
    if (!(name in before)) {
      lines.push(`Create group ${name}${after[name].length ? ` with ${plural(after[name].length, 'account')}` : ''}`);
      continue;
    }
    if (!(name in after)) {
      lines.push(`Delete group ${name} (${plural(before[name].length, 'account')})`);
      continue;
    }
    const added = after[name].filter((id) => !before[name].includes(id));
    const removed = before[name].filter((id) => !after[name].includes(id));
    if (added.length) lines.push(`${name}: add ${added.join(', ')}`);
    if (removed.length) lines.push(`${name}: remove ${removed.join(', ')}`);
  }
  return lines;
}

/** One line per opt-in change. */
export function diffOptIns(before: PlatformFlagOptIns, after: PlatformFlagOptIns): string[] {
  const lines: string[] = [];
  for (const [field, noun] of [['accounts', 'account'], ['orgs', 'organization']] as const) {
    const was = before[field] ?? [];
    const now = after[field] ?? [];
    const added = now.filter((id) => !was.includes(id));
    const removed = was.filter((id) => !now.includes(id));
    if (added.length) lines.push(`Opt in ${noun} ${added.join(', ')}`);
    if (removed.length) lines.push(`Remove ${noun} ${removed.join(', ')} from the preview`);
  }
  return lines;
}

/* ─────────────────────────────── Opt-ins ──────────────────────────────── */

export function editOptIns(optIns: PlatformFlagOptIns, id: string, kind: 'account' | 'org', add: boolean): PlatformFlagOptIns {
  const value = canonicalUUID(id) ?? id.trim();
  const field = kind === 'org' ? 'orgs' : 'accounts';
  const next: PlatformFlagOptIns = clone(optIns);
  const list = (next[field] ?? []).filter((existing) => existing !== value);
  if (add) list.push(value);
  if (list.length) next[field] = list;
  else delete next[field];
  return next;
}

export function validateOptIns(optIns: PlatformFlagOptIns, attributes?: readonly string[]): string[] {
  const errors: string[] = [];
  const accounts = optIns.accounts ?? [];
  const orgs = optIns.orgs ?? [];
  if (utf8Bytes(JSON.stringify(optIns)) > FLAG_LIMITS.maxOptInsBytes) errors.push(`opt-ins exceed ${FLAG_LIMITS.maxOptInsBytes} bytes`);
  if (accounts.length + orgs.length > FLAG_LIMITS.maxOptInSubjects) {
    errors.push(`at most ${FLAG_LIMITS.maxOptInSubjects} subjects may opt in to one preview`);
  }
  const accountError = validateIds(accounts, FLAG_LIMITS.maxOptInSubjects, 'account');
  if (accountError) errors.push(accountError);
  const orgError = validateIds(orgs, FLAG_LIMITS.maxOptInSubjects, 'organization');
  if (orgError) errors.push(orgError);
  if (orgs.length && attributes && !attributes.includes('org')) {
    errors.push('this flag is decided where the organization is unknown, so organizations cannot opt in');
  }
  return errors;
}

/** Reads a runtime-config opt-in value defensively; the row defaults to {}. */
export function toOptIns(value: unknown): PlatformFlagOptIns {
  if (!isObject(value)) return {};
  const pick = (field: unknown) => (Array.isArray(field) ? field.filter((id): id is string => typeof id === 'string') : undefined);
  const out: PlatformFlagOptIns = {};
  const accounts = pick(value.accounts);
  const orgs = pick(value.orgs);
  if (accounts?.length) out.accounts = accounts;
  if (orgs?.length) out.orgs = orgs;
  return out;
}

/* ─────────────────────────────── Reading ──────────────────────────────── */

export const formatBasisPoints = (bp: number) => `${Math.round(bp) / 100}%`;

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Human summary of a rule's targeting, e.g. "3 accounts · group partners (12) · pro, scale · 10%". */
export function describeRule(rule: PlatformFlagRule, groups: Record<string, string[]> = {}): string {
  const parts: string[] = [];
  if (rule.accounts?.length) parts.push(plural(rule.accounts.length, 'account'));
  if (rule.orgs?.length) parts.push(plural(rule.orgs.length, 'org'));
  if (rule.group) {
    const members = groups[rule.group];
    parts.push(members ? `group ${rule.group} (${members.length})` : `group ${rule.group} (missing)`);
  }
  if (rule.plans?.length) parts.push(rule.plans.join(', '));
  if (rule.rollout !== undefined && rule.rollout !== null) {
    let rollout = formatBasisPoints(rule.rollout);
    if (rule.ramp) {
      const stages = rule.ramp.stages.map(formatBasisPoints).join(' → ');
      rollout += ` (ramp ${stages}${rule.ramp.paused ? ', paused' : ''})`;
    }
    parts.push(rollout);
  }
  if (rule.starts_at) parts.push(`from ${rule.starts_at}`);
  if (rule.ends_at) parts.push(`until ${rule.ends_at}`);
  return parts.join(' · ') || 'no targeting';
}

/** One line per change, for the confirmation dialog. */
export function diffDefinition(
  before: PlatformFlagDefinition,
  after: PlatformFlagDefinition,
  groups: Record<string, string[]> = {},
): string[] {
  const lines: string[] = [];
  const onOff = (value: boolean) => (value ? 'on' : 'off');
  if (before.enabled !== after.enabled) {
    lines.push(`Kill switch ${onOff(before.enabled)} → ${onOff(after.enabled)}${after.enabled ? '' : ': off for every account, whatever the rules say'}`);
  }
  if (before.default !== after.default) {
    lines.push(`Default for accounts no rule matches ${onOff(before.default)} → ${onOff(after.default)}`);
  }
  const beforeRules = before.rules ?? [];
  const afterRules = after.rules ?? [];
  const beforeById = new Map(beforeRules.map((rule) => [rule.id, rule]));
  const afterById = new Map(afterRules.map((rule) => [rule.id, rule]));
  const verb = (rule: PlatformFlagRule) => (rule.value === false ? 'off' : 'on');
  for (const rule of afterRules) {
    const prior = beforeById.get(rule.id);
    if (!prior) lines.push(`Add rule ${rule.id}: ${verb(rule)} for ${describeRule(rule, groups)}`);
    else if (JSON.stringify(prior) !== JSON.stringify(rule)) {
      lines.push(`Change rule ${rule.id}: ${verb(prior)} for ${describeRule(prior, groups)} → ${verb(rule)} for ${describeRule(rule, groups)}`);
    }
  }
  for (const rule of beforeRules) {
    if (!afterById.has(rule.id)) lines.push(`Remove rule ${rule.id} (${verb(rule)} for ${describeRule(rule, groups)})`);
  }
  const kept = (rules: PlatformFlagRule[], other: Map<string, PlatformFlagRule>) =>
    rules.filter((rule) => other.has(rule.id)).map((rule) => rule.id).join('\u0000');
  if (kept(beforeRules, afterById) !== kept(afterRules, beforeById)) lines.push('Reorder rules (the first match decides)');
  if (JSON.stringify(before.self_serve ?? null) !== JSON.stringify(after.self_serve ?? null)) {
    const describe = (selfServe?: PlatformFlagSelfServe) =>
      !selfServe
        ? 'not offered'
        : `${selfServe.enabled ? 'open' : 'closed'}${selfServe.plans?.length ? ` to ${selfServe.plans.join(', ')}` : ' to every plan'}${
            selfServe.max_subjects ? `, max ${selfServe.max_subjects}` : ''
          }`;
    lines.push(`Self-serve preview ${describe(before.self_serve)} → ${describe(after.self_serve)}`);
  }
  return lines;
}

/** Why a decision came out the way it did, in support-ready words. */
export function explainDecision(decision: OperatorPlatformFlagDecision): string[] {
  const onOff = decision.enabled ? 'on' : 'off';
  const lines: string[] = [];
  switch (decision.reason) {
    case 'unknown_flag':
      lines.push("apid's snapshot does not know this flag, so it is off.");
      break;
    case 'flag_disabled':
      lines.push('The kill switch is off, so the flag is off for every account.');
      break;
    case 'account_missing':
      lines.push('No account was given, so the flag is off.');
      break;
    case 'rule_match':
      lines.push(
        `Rule "${decision.rule_id ?? '?'}" matched${decision.bucket !== undefined ? ` (rollout bucket ${decision.bucket} of 10000)` : ''} and turns the flag ${onOff}.`,
      );
      break;
    case 'opt_in':
      lines.push(`No rule matched; the ${decision.opt_in === 'org' ? 'organization' : 'account'} joined the self-serve preview, so the flag is on.`);
      break;
    case 'default':
      lines.push(`No rule matched, so the flag's default applies: ${onOff}.`);
      break;
    default:
      lines.push(`Decided ${onOff} (${decision.reason}).`);
  }
  if (decision.scheduled_rule_id) {
    const when = decision.schedule_state === 'rule_not_started' ? 'has not started yet' : decision.schedule_state === 'rule_ended' ? 'has ended' : 'is outside its window';
    lines.push(`Rule "${decision.scheduled_rule_id}" would have matched, but its schedule ${when}.`);
  }
  if (decision.entitled === false) {
    lines.push(`The ${decision.plan || 'account'} plan is not entitled to the capability, so it stays unavailable whatever the flag says.`);
  }
  return lines;
}
