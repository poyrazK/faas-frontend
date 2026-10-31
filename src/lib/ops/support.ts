/* ==========================================================================
   Customer-support clients: abuse holds, per-account platform flags, and the
   trace / wake lookups an operator runs with an ID from a ticket.

   Contract: faas origin/main —
     pkg/apid/apidserver/handlers_admin_abuse_hold.go, pkg/api/dto.go
     pkg/apid/platformflagadmin/service.go, pkg/api/operator_platform_flags.go
     pkg/apid/apidserver/handlers_admin_obs_trace.go, pkg/api/obs.go
     pkg/apid/apidserver/handlers_admin_obs_wake.go, pkg/api/obs_wake.go

   There is no GET /v1/admin/accounts on origin/main (the path only appears
   as a fixture in pkg/apid/capgate/gate_test.go), so account search stays on
   GET /v1/admin/obs/tenants and no client is defined for it here.
   ========================================================================== */

import {
  request,
  writeHeaders,
  type ObsEventListResponse,
  type ObsEventRow,
  type OperatorIntentResponse,
  type OperatorWrite,
} from '@/lib/api';

/* ─────────────────────────────── Abuse hold ────────────────────────────── */

/** state.AccountAbuseHold* — why an ADR-361 hold was placed. */
export type AbuseHoldReason = 'egress_fanout' | 'egress_flood' | 'operator';

export const ABUSE_HOLD_REASON_LABELS: Record<string, string> = {
  egress_fanout: 'Egress fan-out (placed by the scheduler)',
  egress_flood: 'Egress flood (placed by the scheduler)',
  operator: 'Placed by an operator',
};

/**
 * api.AccountAbuseHold. `held_at` is a time.Time.
 * @go api.AccountAbuseHold
 */
export interface AccountAbuseHold {
  reason: AbuseHoldReason | string;
  held_at: string;
}

/**
 * api.AccountAbuseHoldActionResponse. `abuse_hold` has no omitempty, so it is
 * null (not absent) when the account is not held. `changed` is false when the
 * action was a no-op (already held / already released); an existing hold keeps
 * its first reason and time.
 * @go api.AccountAbuseHoldActionResponse
 */
export interface AccountAbuseHoldActionResponse {
  account_id: string;
  abuse_hold: AccountAbuseHold | null;
  changed: boolean;
}

/** The handler checks len(note) in bytes: 3..500. */
export const ABUSE_HOLD_NOTE_MIN_BYTES = 3;
export const ABUSE_HOLD_NOTE_MAX_BYTES = 500;

/** Null when the note is acceptable to the backend; otherwise a field error. */
export function abuseHoldNoteError(note: string): string | null {
  const bytes = new TextEncoder().encode(note).length;
  if (bytes < ABUSE_HOLD_NOTE_MIN_BYTES) return 'The audit note must be at least 3 characters.';
  if (bytes > ABUSE_HOLD_NOTE_MAX_BYTES) return 'The audit note must be at most 500 bytes.';
  return null;
}

/** @goBody api.AccountAbuseHoldAction */
const changeAbuseHold = (method: 'POST' | 'DELETE', accountId: string, note: string, opts?: OperatorWrite) =>
  request<AccountAbuseHoldActionResponse>(`/v1/admin/accounts/${encodeURIComponent(accountId)}/abuse-hold`, {
    method,
    headers: writeHeaders(opts),
    body: JSON.stringify({ note }),
  });

/**
 * POST /v1/admin/accounts/{id}/abuse-hold. Boots and deploys are refused from
 * the moment the row commits; schedd drains running workloads on its next
 * reaper pass. Operator session + MFA + step-up + Idempotency-Key.
 */
export const placeAccountAbuseHold = (accountId: string, note: string, opts?: OperatorWrite) =>
  changeAbuseHold('POST', accountId, note, opts);

/** DELETE /v1/admin/accounts/{id}/abuse-hold. Apps stay parked and wake on their next request. */
export const releaseAccountAbuseHold = (accountId: string, note: string, opts?: OperatorWrite) =>
  changeAbuseHold('DELETE', accountId, note, opts);

/**
 * No operator read returns an account's current hold: AccountResponse carries
 * `abuse_hold` only on the caller's own GET /v1/account, and the obs tenant
 * rows do not include it. Both writers do log to the `events` table with the
 * account as subject, so the console reconstructs the last known state there:
 *   - account.abuse_hold_placed / account.abuse_hold_released (apid, operator)
 *   - accounts.abuse_hold (schedd, automatic egress holds)
 */
export const ABUSE_HOLD_EVENT_PREFIXES = ['account.abuse_hold', 'accounts.abuse_hold'] as const;

export type AbuseHoldEventAction = 'placed' | 'released';

export interface AbuseHoldEvent {
  id: number;
  at: string;
  kind: string;
  actor: string;
  action: AbuseHoldEventAction;
  /** Hold reason (schedd rows) or 'operator' for operator placements. */
  reason?: string;
  /** Operator audit note, when the row carries one. */
  note?: string;
  actorEmail?: string;
}

function dataField(data: unknown, key: string): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : undefined;
}

/** Maps a raw events row onto a hold action; null for unrelated kinds. */
export function toAbuseHoldEvent(row: ObsEventRow): AbuseHoldEvent | null {
  let action: AbuseHoldEventAction;
  let reason: string | undefined;
  if (row.kind === 'account.abuse_hold_placed') {
    action = 'placed';
    reason = 'operator';
  } else if (row.kind === 'account.abuse_hold_released') {
    action = 'released';
  } else if (row.kind === 'accounts.abuse_hold') {
    action = 'placed';
    reason = dataField(row.data, 'reason');
  } else {
    return null;
  }
  return {
    id: row.id,
    at: row.at,
    kind: row.kind,
    actor: row.actor,
    action,
    reason,
    note: dataField(row.data, 'note'),
    actorEmail: dataField(row.data, 'actor_email'),
  };
}

/** Newest first; ties broken by the larger events.id. */
export function sortAbuseHoldEvents(events: AbuseHoldEvent[]): AbuseHoldEvent[] {
  return [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id);
}

export type DerivedHoldState =
  | { state: 'held' | 'released'; last: AbuseHoldEvent }
  | { state: 'none' };

/** Last recorded hold action. Not authoritative: events are best-effort and may be pruned. */
export function deriveAbuseHoldState(events: AbuseHoldEvent[]): DerivedHoldState {
  const [last] = sortAbuseHoldEvents(events);
  if (!last) return { state: 'none' };
  return { state: last.action === 'placed' ? 'held' : 'released', last };
}

/** Both hold-related event kinds for one account, newest first. */
export async function listAbuseHoldEvents(accountId: string, limit = 25): Promise<AbuseHoldEvent[]> {
  const pages = await Promise.all(
    ABUSE_HOLD_EVENT_PREFIXES.map((prefix) => {
      const q = new URLSearchParams({ limit: String(limit), kind_prefix: prefix, subject: accountId });
      return request<ObsEventListResponse>(`/v1/admin/obs/events?${q}`, { cache: 'no-store' });
    }),
  );
  const events = pages.flatMap((page) => page.items.map(toAbuseHoldEvent).filter((e): e is AbuseHoldEvent => e !== null));
  return sortAbuseHoldEvents(events);
}

/* ───────────────────────────── Platform flags ──────────────────────────── */

/** platformflags.Reason* — why a flag decided the way it did. */
export type PlatformFlagDecisionReason =
  | 'unknown_flag'
  | 'flag_disabled'
  | 'account_missing'
  | 'rule_match'
  | 'opt_in'
  | 'default';

export const FLAG_REASON_LABELS: Record<string, string> = {
  unknown_flag: 'Not in the catalog',
  flag_disabled: 'Flag switched off',
  account_missing: 'Account unknown to the snapshot',
  rule_match: 'Matched a rule',
  opt_in: 'Self-serve opt-in',
  default: 'Flag default',
};

export const FLAG_SCHEDULE_LABELS: Record<string, string> = {
  rule_not_started: 'matching rule not started yet',
  rule_ended: 'matching rule has ended',
};

/**
 * api.OperatorPlatformFlagDecision.
 * @go api.OperatorPlatformFlagDecision
 */
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
  /** Present only for flags that release a plan-gated capability. */
  entitled?: boolean;
  /** enabled && (entitled ?? true). */
  available: boolean;
  scheduled_rule_id?: string;
  schedule_state?: 'rule_not_started' | 'rule_ended' | string;
  at?: string;
  /** 'account' or 'org' when a self-serve opt-in decided. */
  opt_in?: 'account' | 'org' | string;
}

/**
 * api.OperatorAccountPlatformFlags — GET /v1/admin/accounts/{id}/flags.
 * @go api.OperatorAccountPlatformFlags
 */
export interface OperatorAccountPlatformFlags {
  account_id: string;
  plan: string;
  items: OperatorPlatformFlagDecision[];
}

/** Every catalog flag decided for one account (operator session read; no query params). */
export const getAccountPlatformFlags = (accountId: string) =>
  request<OperatorAccountPlatformFlags>(`/v1/admin/accounts/${encodeURIComponent(accountId)}/flags`, {
    cache: 'no-store',
  });

/** One sentence explaining a decision, built only from fields the server sent. */
export function explainFlagDecision(d: OperatorPlatformFlagDecision): string {
  const parts = [FLAG_REASON_LABELS[d.reason] ?? d.reason];
  if (d.rule_id) parts.push(`rule ${d.rule_id}`);
  if (d.bucket !== undefined) parts.push(`bucket ${d.bucket}`);
  if (d.opt_in) parts.push(`${d.opt_in} opt-in`);
  if (d.schedule_state) {
    parts.push(
      `${FLAG_SCHEDULE_LABELS[d.schedule_state] ?? d.schedule_state}${d.scheduled_rule_id ? ` (${d.scheduled_rule_id})` : ''}`,
    );
  }
  if (d.enabled && d.entitled === false) parts.push(`plan ${d.plan} is not entitled`);
  return parts.join(' · ');
}

/* ─────────────────────────────── Lookups ───────────────────────────────── */

/** obsTraceIDPattern: an OTel trace id, lowercase hex. */
export const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
/** operatorobs.ValidWakeID: UUIDv7 or a hex trace id. */
export const WAKE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Trims and lowercases a pasted trace id; dashes are kept so a UUID is not mistaken for one. */
export const normalizeTraceId = (input: string) => input.trim().toLowerCase();
export const normalizeWakeId = (input: string) => input.trim();

/**
 * api.ObsTraceLookupResponse — operator intents and live events sharing one trace id.
 * @go api.ObsTraceLookupResponse
 */
export interface ObsTraceLookupResponse {
  trace_id: string;
  generated_at: string;
  limit: number;
  intents: OperatorIntentResponse[];
  events: ObsEventRow[];
}

/** Server default (api.ObsAdminEventsLimitDefault); values above 500 are clamped. */
export const TRACE_LOOKUP_DEFAULT_LIMIT = 200;
export const TRACE_LOOKUP_MAX_LIMIT = 500;

/** 404 trace_not_found when neither table has the id. */
export const getTraceLookup = (traceId: string, limit?: number) => {
  const q = limit ? `?limit=${Math.min(Math.max(1, Math.floor(limit)), TRACE_LOOKUP_MAX_LIMIT)}` : '';
  return request<ObsTraceLookupResponse>(`/v1/admin/obs/traces/${encodeURIComponent(traceId)}${q}`, {
    cache: 'no-store',
  });
};

/**
 * api.ObsWakeEvent.
 * @go api.ObsWakeEvent
 */
export interface ObsWakeEvent {
  at: string;
  kind: string;
  actor?: string;
  subject?: string;
  trace_id?: string;
  data?: unknown;
}

/**
 * api.ObsWakeTimeline — oldest first, at most 1000 events (then `truncated`).
 * @go api.ObsWakeTimeline
 */
export interface ObsWakeTimeline {
  wake_id: string;
  /** First subject the events name (the app), when any does. */
  subject?: string;
  events: ObsWakeEvent[];
  truncated: boolean;
}

/** The handler rejects any query string, so none is ever sent. 404 when no events match. */
export const getWakeTimeline = (wakeId: string) =>
  request<ObsWakeTimeline>(`/v1/admin/obs/wakes/${encodeURIComponent(wakeId)}`, { cache: 'no-store' });

export type TraceTimelineEntry =
  | { type: 'intent'; at: string; key: string; intent: OperatorIntentResponse }
  | { type: 'event'; at: string; key: string; event: ObsEventRow };

/** Interleaves intents (by requested_at) and events (by at), oldest first. */
export function buildTraceTimeline(res: Pick<ObsTraceLookupResponse, 'intents' | 'events'>): TraceTimelineEntry[] {
  const entries: TraceTimelineEntry[] = [
    ...res.intents.map((intent) => ({ type: 'intent' as const, at: intent.requested_at, key: `i:${intent.intent_id}`, intent })),
    ...res.events.map((event) => ({ type: 'event' as const, at: event.at, key: `e:${event.id}`, event })),
  ];
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
}

/** Milliseconds between two timestamps, or null when either is unparseable. */
export function offsetMs(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return Number.isFinite(from) && Number.isFinite(to) ? to - from : null;
}

/** "+0 ms", "+1.25 s", "+3m 04s" relative to the first entry. */
export function formatOffset(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `+${Math.round(ms)} ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(2)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `+${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * Collects string values under `wake_id` / `trace_id` keys anywhere in an
 * event payload, so the lookup page can link a trace to its wakes and back.
 */
export function collectIds(data: unknown, key: 'wake_id' | 'trace_id', limit = 10): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (found.size >= limit || depth > 6 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === key && typeof v === 'string' && v) found.add(v);
      else walk(v, depth + 1);
    }
  };
  walk(data, 0);
  return [...found];
}

/** Account IDs link to the tenant directory, which opens an exact ID directly. */
export { tenantHref } from '@/lib/routes';
