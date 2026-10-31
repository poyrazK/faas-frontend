/* ==========================================================================
   Platform flags (ADR-1700) — operator read surface and typed writes.

   Contract: faas origin/main pkg/api/operator_platform_flags.go (wire shapes),
   pkg/apid/platformflagadmin/service.go (reads) and
   pkg/apid/apidserver/platform_flags.go (write checks). Reads are
   /v1/admin/flags*; there is no flag write route. A flag, its self-serve
   opt-ins and the shared groups are runtime-configuration rows written with
   PATCH /v1/admin/config/{config_key} (updateOperatorRuntimeConfig).
   ========================================================================== */

import {
  request,
  updateOperatorRuntimeConfig,
  type OperatorRuntimeConfig,
  type OperatorRuntimeConfigOperation,
  type OperatorWrite,
  type Plan,
  type RuntimeConfigStatus,
} from '@/lib/api';

/** Runtime-config key prefixes (pkg/platformflags catalog.go, optins.go). */
export const FLAG_CONFIG_PREFIX = 'platform_flag.';
export const OPT_INS_CONFIG_PREFIX = 'platform_flag_opt_ins.';
export const GROUPS_CONFIG_KEY = 'platform_flag_groups';

export const optInsConfigKey = (flagKey: string) => `${OPT_INS_CONFIG_PREFIX}${flagKey}`;

/**
 * Advances a rollout rule stage by stage while the flag's health routes stay
 * healthy. The rule's rollout is the current stage.
 * @go api.PlatformFlagRamp
 */
export interface PlatformFlagRamp {
  /** Strictly ascending basis points, 2..10 stages. */
  stages: number[];
  interval_seconds: number;
  max_5xx_basis_points: number;
  min_requests: number;
  on_breach: 'pause' | 'rollback' | string;
  paused?: boolean;
  paused_reason?: string;
}

/**
 * One targeting rule. Accounts, orgs, group, plans and rollout combine with
 * AND; the first matching rule decides. `value` is required on write (the Go
 * field is *bool without omitempty, so it reads back as null only if unset).
 * @go api.PlatformFlagRule
 */
export interface PlatformFlagRule {
  id: string;
  accounts?: string[];
  orgs?: string[];
  group?: string;
  plans?: Plan[];
  /** Basis points of the accounts the other constraints admit (1000 = 10%). */
  rollout?: number;
  /** RFC 3339; outside [starts_at, ends_at) the rule does not match. */
  starts_at?: string;
  ends_at?: string;
  ramp?: PlatformFlagRamp;
  value: boolean | null;
}

/**
 * Customers may join a preview themselves.
 * @go api.PlatformFlagSelfServe
 */
export interface PlatformFlagSelfServe {
  enabled: boolean;
  /** Empty means every plan. */
  plans?: Plan[];
  /** 0 or absent means the platform limit (5000). */
  max_subjects?: number;
}

/**
 * Stored flag value. `enabled` is the kill switch; first matching rule wins.
 * @go api.PlatformFlagDefinition
 */
export interface PlatformFlagDefinition {
  enabled: boolean;
  default: boolean;
  rules?: PlatformFlagRule[];
  self_serve?: PlatformFlagSelfServe;
}

/**
 * Stored value of platform_flag_opt_ins.<key>.
 * @go api.PlatformFlagOptIns
 */
export interface PlatformFlagOptIns {
  accounts?: string[];
  orgs?: string[];
}

/** @go api.OperatorPlatformFlagOptIns */
export interface OperatorPlatformFlagOptInCounts {
  accounts: number;
  orgs: number;
  version: number;
}

/** @go api.OperatorRuntimeConfigApplyReceipt */
export interface OperatorRuntimeConfigApplyReceipt {
  config_key: string;
  daemon: string;
  instance: string;
  version: number;
  status: 'applied' | 'failed';
  error?: string;
  reported_at: string;
}

/** @go api.OperatorPlatformFlagConvergence */
export interface OperatorPlatformFlagConvergence {
  converged: string[];
  pending: string[];
  failed: string[];
}

/** Subject attributes a flag's rules may constrain; "account" is always present. */
export type PlatformFlagAttribute = 'account' | 'plan' | 'org';

/** @go api.OperatorPlatformFlag */
export interface OperatorPlatformFlag {
  key: string;
  /** Runtime-configuration key the definition is written to. */
  config_key: string;
  label: string;
  description: string;
  capability?: string;
  adr: string;
  consumers: string[];
  attributes: PlatformFlagAttribute[];
  legacy_env: string[];
  /** YYYY-MM-DD. */
  retire_by?: string;
  definition: PlatformFlagDefinition;
  source: 'default_or_environment' | 'operator';
  version: number;
  status: RuntimeConfigStatus;
  last_error?: string;
  updated_at?: string;
  receipts: OperatorRuntimeConfigApplyReceipt[];
  convergence: OperatorPlatformFlagConvergence;
  opt_ins: OperatorPlatformFlagOptInCounts;
  /** ga | beta | preview | internal — tier of the released capability. */
  maturity?: string;
  /** Parent capability whose flag must also be on. */
  parent?: string;
  /** Turning a core flag off (enabled or default false) needs force. */
  core?: boolean;
  /** "+"-joined: routes, settings, daemons; or handler / none. */
  enforcement?: string;
}

/** @go api.OperatorPlatformFlagGroups */
export interface OperatorPlatformFlagGroups {
  config_key: string;
  groups: Record<string, string[]>;
  /** Group name → flag keys whose rules use it. */
  references: Record<string, string[]>;
  version: number;
}

/** @go api.OperatorPlatformFlagList */
export interface OperatorPlatformFlagList {
  items: OperatorPlatformFlag[];
  groups: OperatorPlatformFlagGroups;
  generated_at: string;
}

export type PlatformFlagDecisionReason =
  | 'unknown_flag'
  | 'flag_disabled'
  | 'account_missing'
  | 'rule_match'
  | 'opt_in'
  | 'default';

/** @go api.OperatorPlatformFlagDecision */
export interface OperatorPlatformFlagDecision {
  flag: string;
  account_id: string;
  org_id?: string;
  plan: string;
  enabled: boolean;
  reason: PlatformFlagDecisionReason | string;
  rule_id?: string;
  bucket?: number;
  version: number;
  /** Absent for a flag that releases no capability. */
  entitled?: boolean;
  /** enabled AND entitled. */
  available: boolean;
  /** First rule that matched but was outside its window. */
  scheduled_rule_id?: string;
  schedule_state?: 'rule_not_started' | 'rule_ended' | string;
  /** Set when the decision was asked about another moment than now. */
  at?: string;
  /** "account" or "org" when a self-serve opt-in decided. */
  opt_in?: 'account' | 'org' | string;
}

export const getPlatformFlags = () =>
  request<OperatorPlatformFlagList>('/v1/admin/flags', { cache: 'no-store' });

export const getPlatformFlag = (key: string) =>
  request<OperatorPlatformFlag>(`/v1/admin/flags/${encodeURIComponent(key)}`, { cache: 'no-store' });

export interface PlatformFlagDecisionQuery {
  accountId: string;
  /** The organization the request would act under. */
  orgId?: string;
  /** RFC 3339; decide at another moment than now (schedule windows). */
  at?: string;
}

/** The inspector: evaluates apid's live snapshot and records nothing. */
export const getPlatformFlagDecision = (key: string, query: PlatformFlagDecisionQuery) => {
  const q = new URLSearchParams({ account_id: query.accountId.trim() });
  if (query.orgId?.trim()) q.set('org_id', query.orgId.trim());
  if (query.at) q.set('at', query.at);
  return request<OperatorPlatformFlagDecision>(
    `/v1/admin/flags/${encodeURIComponent(key)}/decision?${q.toString()}`,
    { cache: 'no-store' },
  );
};

/* ─────────────────────────────── Writes ───────────────────────────────── */

export type FlagWriteOptions = OperatorWrite & { force?: boolean };
export type FlagWriteResult = OperatorRuntimeConfig | OperatorRuntimeConfigOperation;

/**
 * Writes a flag definition. expectedVersion is the version the edit started
 * from (0 until an operator has written the flag), so a concurrent change is a
 * 409 instead of an overwrite. `force` is only for core flags left off.
 */
export const writePlatformFlag = (
  flag: Pick<OperatorPlatformFlag, 'config_key'>,
  definition: PlatformFlagDefinition,
  reason: string,
  expectedVersion: number,
  opts: FlagWriteOptions = {},
) => updateOperatorRuntimeConfig(flag.config_key, definition, reason, expectedVersion, opts);

/** Replaces the shared group map. A group still used by a flag cannot be removed (409). */
export const writePlatformFlagGroups = (
  groups: Record<string, string[]>,
  reason: string,
  expectedVersion: number,
  opts: OperatorWrite = {},
) => updateOperatorRuntimeConfig(GROUPS_CONFIG_KEY, groups, reason, expectedVersion, opts);

/** Replaces one flag's self-serve opt-in row. */
export const writePlatformFlagOptIns = (
  flagKey: string,
  optIns: PlatformFlagOptIns,
  reason: string,
  expectedVersion: number,
  opts: OperatorWrite = {},
) => updateOperatorRuntimeConfig(optInsConfigKey(flagKey), optIns, reason, expectedVersion, opts);
