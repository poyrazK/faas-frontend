/* ==========================================================================
   Unified operator incident inbox.

   GET /v1/admin/obs/incidents is a read-only correlation projection over
   deployment, job-run, compute-node and platform-alert signals, merged and
   cursor-paginated by observed_at DESC, id DESC. A response that lists
   `unavailable_sources` is an incomplete snapshot: an empty page then means
   "nothing from the sources that answered", never "no incidents".

   Contract: pkg/api/obs.go (ObsIncident…), obs_context.go, obs_triage*.go,
   obs_workload.go, obs_recurrence.go, obs_response_times.go, and the
   handlers in pkg/apid/apidserver/handlers_admin_obs_{incidents,evidence,
   context,triage,triage_history,workload,recurrence,response_times}.go.
   ========================================================================== */

import { request, writeHeaders, type OperatorWrite } from '@/lib/api';
import type {
  ObsAlertCollectionCoverage,
  ObsAlertCollectionHealth,
  ObsAlertRetentionHealth,
  Tone,
} from './telemetry';

/* ─────────────────────────────── Vocabulary ────────────────────────────── */

export const INCIDENT_TYPES = ['deployment', 'job_run', 'compute_node', 'platform_alert'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

/** Severities the list accepts as a filter. */
export const INCIDENT_SEVERITIES = ['critical', 'error', 'warning'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const ALERT_STATUSES = ['firing', 'unknown', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export type AcknowledgmentFilter = 'acknowledged' | 'unacknowledged';
export type OwnershipFilter = 'owned' | 'unowned' | 'mine';
export type SnoozeFilter = 'active' | 'inactive';

export const TRIAGE_ACTIONS = ['acknowledge', 'unacknowledge', 'claim', 'release', 'snooze', 'unsnooze'] as const;
export type TriageAction = (typeof TRIAGE_ACTIONS)[number];

/** Server bound on how far a snooze may reach (ObsAlertTriageSnoozeMax). */
export const SNOOZE_MAX_MS = 24 * 3_600_000;

/* ─────────────────────────────── Wire types ────────────────────────────── */

/**
 * Human workflow state for one retained alert episode, independent of alert status.
 * @go api.ObsAlertTriage
 */
export interface ObsAlertTriage {
  revision: number;
  acknowledged: boolean;
  owned: boolean;
  owner_account_id?: string;
  snoozed_until?: string;
  snoozed: boolean;
  updated_at?: string;
  as_of: string;
}

/**
 * Recurrence and last-known state of a retained alert episode.
 * @go api.ObsAlertEpisode
 */
export interface ObsAlertEpisode {
  series_id: string;
  started_at: string;
  first_seen_at: string;
  last_seen_at: string;
  last_evaluated_at: string;
  resolved_at?: string;
  /** current | unknown | historical */
  observation_state: string;
}

/** @go api.ObsIncident */
export interface ObsIncident {
  /** "<type>/<resource or episode id>". */
  id: string;
  type: IncidentType;
  /** The list only carries warning/error/critical; evidence for a recovered resource reports "info". */
  severity: IncidentSeverity | 'info';
  status: string;
  summary: string;
  account_id?: string;
  app_id?: string;
  node_id?: string;
  resource_id: string;
  resource_name?: string;
  observed_at: string;
  dedupe_key: string;
  /** An API path (gated diagnostic read), not a console URL. See incidentConsoleLinks. */
  action_path?: string;
  audit_path?: string;
  runbook_url?: string;
  evidence_path?: string;
  alert_episode?: ObsAlertEpisode;
  /** Present only on retained platform_alert episodes, the only triageable incidents. */
  triage?: ObsAlertTriage;
}

/** @go api.ObsIncidentListResponse */
export interface ObsIncidentListResponse {
  unavailable_sources: string[];
  generated_at: string;
  items: ObsIncident[];
  limit: number;
  since: string;
  /** True when the requested since was older than the server allows and was raised. */
  since_clamped: boolean;
  type?: string;
  severity?: string;
  next_cursor: string;
}

/**
 * Exact-resource history entry. IDs are strings to preserve bigint precision.
 * @go api.ObsIncidentEvidenceEntry
 */
export interface ObsIncidentEvidenceEntry {
  id: string;
  source: string;
  kind: string;
  status?: string;
  at: string;
  trace_id?: string;
  trace_path?: string;
}

/**
 * Current suppression evidence (platform_alert only); null booleans mean unknown.
 * @go api.ObsAlertSuppression
 */
export interface ObsAlertSuppression {
  state: string;
  reason?: string;
  checked_at: string;
  updated_at?: string;
  silenced: boolean | null;
  inhibited: boolean | null;
}

/** @go api.ObsAlertTriageHistoryEntry */
export interface ObsAlertTriageHistoryEntry {
  id: string;
  revision: number;
  action: string;
  at: string;
  acknowledged: boolean;
  owned: boolean;
  snoozed_until?: string;
  trace_id?: string;
  trace_path?: string;
}

/** @go api.ObsAlertTriageHistoryCoverage */
export interface ObsAlertTriageHistoryCoverage {
  state: string;
  reason?: string;
  available_entries: number;
  missing_entries: number;
  oldest_available_revision?: number;
  newest_available_revision?: number;
}

/** @go api.ObsAlertTriageHistory */
export interface ObsAlertTriageHistory {
  incident_id: string;
  generated_at: string;
  snapshot_at: string;
  snapshot_revision: number;
  current_revision: number;
  items: ObsAlertTriageHistoryEntry[];
  limit: number;
  truncated: boolean;
  next_cursor: string;
  history_path: string;
  coverage: ObsAlertTriageHistoryCoverage;
}

/**
 * Read-only snapshot, not a persisted incident record.
 * @go api.ObsIncidentEvidenceResponse
 */
export interface ObsIncidentEvidenceResponse {
  suppression?: ObsAlertSuppression;
  triage_history?: ObsAlertTriageHistory;
  generated_at: string;
  incident: ObsIncident;
  error_code?: string;
  since: string;
  limit: number;
  truncated: boolean;
  history: ObsIncidentEvidenceEntry[];
  unavailable_sources: string[];
}

/** @go api.ObsIncidentContextScope */
export interface ObsIncidentContextScope {
  state: string;
  reason?: string;
  basis: string;
  app_id?: string;
  account_id?: string;
  node_id?: string;
  job_id?: string;
}

/**
 * Complete current relationship set; failed_resources does not imply causation.
 * @go api.ObsIncidentContextCounts
 */
export interface ObsIncidentContextCounts {
  apps: number;
  tenants: number;
  deployments: number;
  nodes: number;
  jobs: number;
  job_runs: number;
  failed_resources: number;
}

/** @go api.ObsIncidentRelatedResource */
export interface ObsIncidentRelatedResource {
  /** app | tenant | deployment | compute_node | job | job_run */
  kind: string;
  id: string;
  status: string;
  relationship: string;
  account_id?: string;
  app_id?: string;
  confirmed_failure: boolean;
}

/** @go api.ObsIncidentRelatedEntry */
export interface ObsIncidentRelatedEntry {
  resource_kind: string;
  resource_id: string;
  match: string;
  entry: ObsIncidentEvidenceEntry;
}

/**
 * Current relationships, not historical blast radius or causation.
 * @go api.ObsIncidentContextResponse
 */
export interface ObsIncidentContextResponse {
  as_of: string;
  incident_id: string;
  incident_status: string;
  incident_observed_at: string;
  evidence_path: string;
  scope: ObsIncidentContextScope;
  counts: ObsIncidentContextCounts | null;
  resources: ObsIncidentRelatedResource[];
  limit: number;
  next_cursor: string;
  since: string;
  until: string;
  timeline: ObsIncidentRelatedEntry[];
  timeline_scope: string;
  timeline_limit: number;
  timeline_truncated: boolean;
  unavailable_sources: string[];
}

/** @go api.ObsAlertTriageRequest */
export interface ObsAlertTriageRequest {
  action: TriageAction;
  /** Required; the write is rejected with 409 when the triage changed meanwhile. */
  expected_revision: number;
  /** Only for snooze: after now and within 24 hours. */
  snoozed_until?: string;
}

/** @go api.ObsAlertTriageResponse */
export interface ObsAlertTriageResponse {
  incident_id: string;
  triage: ObsAlertTriage;
}

/* Alert workload summary (GET …/platform_alert/summary). */

/** @go api.ObsAlertWorkloadCounts */
export interface ObsAlertWorkloadCounts {
  total: number;
  firing: number;
  unknown: number;
  resolved: number;
  /** Unresolved, unsnoozed episodes that are unacknowledged or unowned (unknown included). */
  needs_attention: number;
}

/** @go api.ObsAlertWorkloadGroup */
export interface ObsAlertWorkloadGroup {
  status: string;
  severity: string;
  acknowledged: boolean;
  owned: boolean;
  snoozed: boolean;
  count: number;
}

/** @go api.ObsAlertWorkloadOldest */
export interface ObsAlertWorkloadOldest {
  incident_id: string;
  status: string;
  severity: string;
  started_at: string;
  age_seconds: number;
  evidence_path: string;
}

/** @go api.ObsAlertWorkloadSummary */
export interface ObsAlertWorkloadSummary {
  as_of: string;
  scope: string;
  age_basis: string;
  collection: ObsAlertCollectionHealth;
  retention: ObsAlertRetentionHealth;
  /** Null before the first successful alert collection. */
  counts: ObsAlertWorkloadCounts | null;
  groups: ObsAlertWorkloadGroup[];
  oldest_unacknowledged: ObsAlertWorkloadOldest | null;
  oldest_unowned: ObsAlertWorkloadOldest | null;
}

/* Recurrence (GET …/platform_alert/recurrence). */

/** @go api.ObsAlertRecurrenceDuration */
export interface ObsAlertRecurrenceDuration {
  samples: number;
  not_observed: number;
  invalid_clock: number;
  min_seconds: number | null;
  p50_seconds: number | null;
}

/** @go api.ObsAlertRecurrenceGap */
export interface ObsAlertRecurrenceGap {
  samples: number;
  unconfirmed_recovery: number;
  resolution_overlap: number;
  invalid_clock: number;
  min_seconds: number | null;
  p50_seconds: number | null;
}

/** @go api.ObsAlertRecurrenceMetrics */
export interface ObsAlertRecurrenceMetrics {
  episodes: number;
  repeat_activations: number;
  unresolved: number;
  unknown_observation: number;
  duration: ObsAlertRecurrenceDuration;
  recovery_gap: ObsAlertRecurrenceGap;
}

/** @go api.ObsAlertRecurrenceTotals */
export interface ObsAlertRecurrenceTotals {
  series: number;
  repeated_series: number;
  metrics: ObsAlertRecurrenceMetrics;
}

/** @go api.ObsAlertRecurrenceEpisode */
export interface ObsAlertRecurrenceEpisode {
  episode_id: string;
  status: string;
  started_at: string;
  resolved_at: string | null;
  evidence_path: string;
}

/** @go api.ObsAlertRecurrenceSeries */
export interface ObsAlertRecurrenceSeries {
  rule_key: string;
  series_id: string;
  name: string;
  severity: string;
  component: string;
  account_id?: string;
  app_id?: string;
  node_id?: string;
  first_activation_at: string;
  last_activation_at: string;
  metrics: ObsAlertRecurrenceMetrics;
  recent_episodes: ObsAlertRecurrenceEpisode[];
  recent_episodes_truncated: boolean;
}

/** @go api.ObsAlertRecurrence */
export interface ObsAlertRecurrence {
  coverage?: ObsAlertCollectionCoverage;
  as_of: string;
  since: string;
  scope: string;
  percentile_method: string;
  limitations: string[];
  collection: ObsAlertCollectionHealth;
  retention: ObsAlertRetentionHealth;
  /** Null when no successful collection backs the cohort. */
  totals: ObsAlertRecurrenceTotals | null;
  items: ObsAlertRecurrenceSeries[];
  truncated: boolean;
}

/* Response times (GET …/platform_alert/response-times). */

/** @go api.ObsAlertResponseMetric */
export interface ObsAlertResponseMetric {
  samples: number;
  not_observed: number;
  unknown: number;
  invalid_clock: number;
  p50_seconds: number | null;
  p95_seconds: number | null;
}

/** @go api.ObsAlertResponseCoverage */
export interface ObsAlertResponseCoverage {
  complete_episodes: number;
  gapped_episodes: number;
  invalid_receipt_episodes: number;
  missing_revisions: number;
}

/** @go api.ObsAlertResponseAggregate */
export interface ObsAlertResponseAggregate {
  episodes: number;
  unresolved: number;
  unknown_observation: number;
  acknowledgment: ObsAlertResponseMetric;
  resolution: ObsAlertResponseMetric;
  receipt_coverage: ObsAlertResponseCoverage;
}

/** @go api.ObsAlertResponseGroup */
export interface ObsAlertResponseGroup {
  severity: string;
  component: string;
  metrics: ObsAlertResponseAggregate;
}

/**
 * Retained activation-cohort timing, not an SLA.
 * @go api.ObsAlertResponseTimes
 */
export interface ObsAlertResponseTimes {
  coverage?: ObsAlertCollectionCoverage;
  as_of: string;
  since: string;
  scope: string;
  duration_basis: string;
  percentile_method: string;
  limitations: string[];
  collection: ObsAlertCollectionHealth;
  retention: ObsAlertRetentionHealth;
  totals: ObsAlertResponseAggregate | null;
  groups: ObsAlertResponseGroup[];
}

/* ─────────────────────────────── Inbox query ───────────────────────────── */

export interface IncidentFilters {
  type: IncidentType | '';
  severity: IncidentSeverity | '';
  /** Look-back in hours; 0 lets the server apply its 24 h default. */
  windowHours: number;
  /** platform_alert only. */
  alertStatus: AlertStatus | '';
  acknowledgment: AcknowledgmentFilter | '';
  ownership: OwnershipFilter | '';
  snooze: SnoozeFilter | '';
  limit: number;
  cursor: string;
}

export const DEFAULT_INCIDENT_FILTERS: IncidentFilters = {
  type: '',
  severity: '',
  windowHours: 0,
  alertStatus: '',
  acknowledgment: '',
  ownership: '',
  snooze: '',
  limit: 50,
  cursor: '',
};

/** Server bounds for `since`: 168 h for the merged inbox, 30 days for platform alerts. */
export const INCIDENT_WINDOW_MAX_HOURS = 168;
export const ALERT_WINDOW_MAX_HOURS = 30 * 24;

export const INCIDENT_WINDOWS: readonly { hours: number; label: string; alertsOnly?: boolean }[] = [
  { hours: 1, label: 'Last hour' },
  { hours: 6, label: 'Last 6 hours' },
  { hours: 0, label: 'Last 24 hours' },
  { hours: 72, label: 'Last 3 days' },
  { hours: INCIDENT_WINDOW_MAX_HOURS, label: 'Last 7 days' },
  { hours: ALERT_WINDOW_MAX_HOURS, label: 'Last 30 days', alertsOnly: true },
];

/** Triage and alert-status filters are rejected by the server unless type=platform_alert. */
export function normalizeIncidentFilters(filters: IncidentFilters): IncidentFilters {
  const alerts = filters.type === 'platform_alert';
  const maxHours = alerts ? ALERT_WINDOW_MAX_HOURS : INCIDENT_WINDOW_MAX_HOURS;
  return {
    ...filters,
    windowHours: filters.windowHours > maxHours ? 0 : filters.windowHours,
    alertStatus: alerts ? filters.alertStatus : '',
    acknowledgment: alerts ? filters.acknowledgment : '',
    ownership: alerts ? filters.ownership : '',
    snooze: alerts ? filters.snooze : '',
    limit: Math.min(200, Math.max(1, Math.trunc(filters.limit) || 50)),
  };
}

/** Stable identity of a query, independent of the moment `since` is computed. */
export function incidentFiltersKey(filters: IncidentFilters): string {
  const f = normalizeIncidentFilters(filters);
  return [f.type, f.severity, f.windowHours, f.alertStatus, f.acknowledgment, f.ownership, f.snooze, f.limit, f.cursor].join('|');
}

/** Query string for GET /v1/admin/obs/incidents; only nonempty, valid parameters are sent. */
export function incidentQueryString(filters: IncidentFilters, now = Date.now()): string {
  const f = normalizeIncidentFilters(filters);
  const q = new URLSearchParams({ limit: String(f.limit) });
  if (f.type) q.set('type', f.type);
  if (f.severity) q.set('severity', f.severity);
  if (f.windowHours > 0) {
    q.set('since', new Date(now - f.windowHours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
  }
  if (f.type === 'platform_alert') {
    if (f.alertStatus) q.set('alert_status', f.alertStatus);
    if (f.acknowledgment) q.set('acknowledgment', f.acknowledgment);
    if (f.ownership) q.set('ownership', f.ownership);
    if (f.snooze) q.set('snooze', f.snooze);
  }
  if (f.cursor) q.set('cursor', f.cursor);
  return q.toString();
}

export const listIncidents = (filters: IncidentFilters) =>
  request<ObsIncidentListResponse>(`/v1/admin/obs/incidents?${incidentQueryString(filters)}`, { cache: 'no-store' });

/** One inbox page tagged with the query it answers, so a page for old filters is never shown under new ones. */
export interface IncidentInboxSnapshot {
  key: string;
  page: ObsIncidentListResponse;
}

export const loadIncidentInbox = async (filters: IncidentFilters): Promise<IncidentInboxSnapshot> => ({
  key: incidentFiltersKey(filters),
  page: await listIncidents(filters),
});

/* ──────────────────────────── Incident references ──────────────────────── */

export interface IncidentRef {
  kind: IncidentType;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALERT_ID = /^[0-9a-f]{64}$/;

/**
 * "<type>/<id>" → typed reference the evidence/context routes accept
 * (canonical UUID for resources, 64-hex SHA-256 for platform alerts).
 */
export function parseIncidentId(incidentId: string): IncidentRef | null {
  const slash = incidentId.indexOf('/');
  if (slash <= 0) return null;
  const kind = incidentId.slice(0, slash);
  const id = incidentId.slice(slash + 1);
  if (!(INCIDENT_TYPES as readonly string[]).includes(kind)) return null;
  const valid = kind === 'platform_alert' ? ALERT_ID.test(id) : UUID.test(id);
  return valid ? { kind: kind as IncidentType, id } : null;
}

export const incidentRefKey = (ref: IncidentRef) => `${ref.kind}/${ref.id}`;

const incidentBase = (ref: IncidentRef) =>
  `/v1/admin/obs/incidents/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.id)}`;

/** Exact-resource evidence; works after recovery too. limit ≤ 100. */
export const getIncidentEvidence = (ref: IncidentRef, limit?: number) =>
  request<ObsIncidentEvidenceResponse>(
    `${incidentBase(ref)}/evidence${limit ? `?${new URLSearchParams({ limit: String(limit) })}` : ''}`,
    { cache: 'no-store' },
  );

export interface IncidentContextQuery {
  /** next_cursor from a previous page of the same incident (valid ~15 minutes). */
  cursor?: string;
  limit?: number;
  historyLimit?: number;
}

export function incidentContextPath(ref: IncidentRef, query: IncidentContextQuery = {}): string {
  const q = new URLSearchParams();
  if (query.limit) q.set('limit', String(query.limit));
  if (query.historyLimit) q.set('history_limit', String(query.historyLimit));
  if (query.cursor) q.set('cursor', query.cursor);
  const qs = q.toString();
  return `${incidentBase(ref)}/context${qs ? `?${qs}` : ''}`;
}

export const getIncidentContext = (ref: IncidentRef, query: IncidentContextQuery = {}) =>
  request<ObsIncidentContextResponse>(incidentContextPath(ref, query), { cache: 'no-store' });

/**
 * Appends the next context page. Cursors pin the incident and the history
 * window, so counts and scope come from the newest page and duplicates (a
 * timeline entry shared by two resources' pages) are dropped.
 */
export function mergeIncidentContext(
  previous: ObsIncidentContextResponse,
  next: ObsIncidentContextResponse,
): ObsIncidentContextResponse {
  const resourceKey = (r: ObsIncidentRelatedResource) => `${r.kind}/${r.id}`;
  const entryKey = (e: ObsIncidentRelatedEntry) => `${e.resource_kind}/${e.resource_id}/${e.entry.id}`;
  const seenResources = new Set((previous.resources ?? []).map(resourceKey));
  const seenEntries = new Set((previous.timeline ?? []).map(entryKey));
  return {
    ...next,
    resources: [...(previous.resources ?? []), ...(next.resources ?? []).filter((r) => !seenResources.has(resourceKey(r)))],
    timeline: [...(previous.timeline ?? []), ...(next.timeline ?? []).filter((e) => !seenEntries.has(entryKey(e)))],
    timeline_truncated: previous.timeline_truncated || next.timeline_truncated,
    unavailable_sources: Array.from(new Set([...(previous.unavailable_sources ?? []), ...(next.unavailable_sources ?? [])])),
  };
}

/* ───────────────────────────── Alert triage ────────────────────────────── */

const alertBase = (episodeId: string) => `/v1/admin/obs/incidents/platform_alert/${encodeURIComponent(episodeId)}`;

export const getAlertTriageHistory = (episodeId: string, cursor?: string, limit?: number) => {
  const q = new URLSearchParams();
  if (limit) q.set('limit', String(limit));
  if (cursor) q.set('cursor', cursor);
  const qs = q.toString();
  return request<ObsAlertTriageHistory>(`${alertBase(episodeId)}/triage-history${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
  });
};

/** Appends an older triage-history page; receipts are keyed by id. */
export function mergeTriageHistory(previous: ObsAlertTriageHistory, next: ObsAlertTriageHistory): ObsAlertTriageHistory {
  const seen = new Set((previous.items ?? []).map((item) => item.id));
  return { ...next, items: [...(previous.items ?? []), ...(next.items ?? []).filter((item) => !seen.has(item.id))] };
}

/**
 * Operator write (step-up gated by the transport). The episode ID is the
 * immutable part of incident.id after "platform_alert/"; series aliases
 * cannot be mutated. No reason field: the request body is closed.
 */
export const triageAlert = (episodeId: string, body: ObsAlertTriageRequest, opts?: OperatorWrite) =>
  request<ObsAlertTriageResponse>(`${alertBase(episodeId)}/triage`, {
    method: 'POST',
    headers: writeHeaders(opts),
    body: JSON.stringify(body),
  });

export interface TriageOption {
  action: TriageAction;
  label: string;
  /** Why the action cannot be taken by this operator right now. */
  disabledReason?: string;
}

/**
 * The actions that make sense for a triage state. Ownership can only be
 * released by its owner, and claiming an episode someone else owns is a 409,
 * so both are offered disabled with the reason instead.
 */
export function triageOptions(triage: ObsAlertTriage, operatorId?: string): TriageOption[] {
  const ownedByOther = triage.owned && !!triage.owner_account_id && triage.owner_account_id !== operatorId;
  return [
    triage.acknowledged ? { action: 'unacknowledge', label: 'Unacknowledge' } : { action: 'acknowledge', label: 'Acknowledge' },
    triage.owned
      ? ownedByOther
        ? { action: 'release', label: 'Release', disabledReason: 'Owned by another operator; only the owner can release it.' }
        : { action: 'release', label: 'Release ownership' }
      : { action: 'claim', label: 'Claim ownership' },
    triage.snoozed ? { action: 'unsnooze', label: 'Unsnooze' } : { action: 'snooze', label: 'Snooze…' },
  ];
}

export const TRIAGE_IMPACT: Record<TriageAction, string> = {
  acknowledge: 'Marks the episode as acknowledged: an operator has seen it. Alert status and notifications are unchanged.',
  unacknowledge: 'Returns the episode to unacknowledged so it counts as needing attention again.',
  claim: 'Records you as the owner of this episode. Other operators cannot claim or release it while you own it.',
  release: 'Clears your ownership so the episode counts as unowned again.',
  snooze: 'Hides the episode from needs-attention counts until the chosen time (at most 24 hours). It does not silence Alertmanager.',
  unsnooze: 'Ends the snooze now so the episode counts toward needs-attention again.',
};

export const SNOOZE_PRESETS: readonly { label: string; minutes: number }[] = [
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '4 hours', minutes: 240 },
  { label: '8 hours', minutes: 480 },
  // Stays inside the server's 24 h bound even with a few minutes of clock skew.
  { label: '23 hours', minutes: 23 * 60 },
];

/** snoozed_until for a preset, capped inside the server's 24 h bound. */
export function snoozeUntil(minutes: number, now = Date.now()): string {
  const ms = Math.min(minutes * 60_000, SNOOZE_MAX_MS - 60_000);
  return new Date(now + ms).toISOString();
}

/* ───────────────────────── Platform-alert summaries ────────────────────── */

/** Accepts no query parameters at all. */
export const getAlertWorkloadSummary = () =>
  request<ObsAlertWorkloadSummary>('/v1/admin/obs/incidents/platform_alert/summary', { cache: 'no-store' });

/** `since` must be nonempty when present, so the default window sends no query string. */
const sincePath = (base: string, since?: string) => (since ? `${base}?${new URLSearchParams({ since })}` : base);

export const getAlertRecurrence = (since?: string) =>
  request<ObsAlertRecurrence>(sincePath('/v1/admin/obs/incidents/platform_alert/recurrence', since), {
    cache: 'no-store',
  });

export const getAlertResponseTimes = (since?: string) =>
  request<ObsAlertResponseTimes>(sincePath('/v1/admin/obs/incidents/platform_alert/response-times', since), {
    cache: 'no-store',
  });

/* ──────────────────────────────── Linking ──────────────────────────────── */

export interface ConsoleLink {
  href: string;
  label: string;
}

/**
 * Maps an incident's API paths onto console pages. action_path points at a
 * gated API read, so only paths with a console equivalent become links:
 * node detail → /nodes, pipeline health → /telemetry, any account → the
 * tenant page, audit searches → the audit trail.
 */
export function incidentConsoleLinks(incident: Pick<ObsIncident, 'type' | 'account_id' | 'action_path' | 'audit_path' | 'node_id'>): ConsoleLink[] {
  const links: ConsoleLink[] = [];
  const action = incident.action_path ?? '';
  if (
    incident.type === 'compute_node' ||
    action.startsWith('/v1/admin/obs/nodes/') ||
    action.startsWith('/v1/admin/obs/incidents/compute_node/')
  ) {
    links.push({ href: '/nodes', label: 'Compute nodes' });
  } else if (action === '/v1/admin/obs/health') {
    links.push({ href: '/telemetry', label: 'Telemetry health' });
  }
  if (incident.account_id) {
    links.push({ href: `/tenants?${new URLSearchParams({ q: incident.account_id })}`, label: 'Tenant' });
  }
  if (incident.audit_path?.startsWith('/v1/admin/obs/audit-log/search')) {
    links.push({ href: '/audit-log', label: 'Audit trail' });
  }
  return links;
}

/** Console page for a related resource in the incident context, if one exists. */
export function relatedResourceLink(resource: Pick<ObsIncidentRelatedResource, 'kind' | 'id' | 'account_id'>): ConsoleLink | null {
  if (resource.kind === 'tenant') return { href: `/tenants?${new URLSearchParams({ q: resource.id })}`, label: 'Tenant' };
  if (resource.kind === 'compute_node') return { href: '/nodes', label: 'Nodes' };
  if (resource.account_id) return { href: `/tenants?${new URLSearchParams({ q: resource.account_id })}`, label: 'Tenant' };
  return null;
}

const REPO_DOCS = 'https://github.com/poyrazK/faas/blob/main';

/**
 * The backend only emits repository documentation links: a relative /docs/
 * path or the same docs on GitHub. Relative ones are resolved against the
 * repository; anything else is dropped rather than opened.
 */
export function runbookHref(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith(`${REPO_DOCS}/docs/`)) return url;
  if (url.startsWith('/docs/') && !url.includes('..')) return `${REPO_DOCS}${url}`;
  return null;
}

/* ───────────────────────────── Presentation ────────────────────────────── */

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  deployment: 'Deployment',
  job_run: 'Job run',
  compute_node: 'Compute node',
  platform_alert: 'Platform alert',
};

const SOURCE_LABELS: Record<string, string> = {
  prometheus: 'Prometheus (live alerts)',
  prometheus_alert_metadata: 'Prometheus alert metadata (runbooks)',
  platform_alert_history: 'retained alert history (status may be stale)',
  platform_alert_triage_history: 'alert triage history',
  alertmanager_suppression: 'Alertmanager suppression state',
  incident_scope: 'incident scope',
};

export const describeSource = (source: string) => SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');

export function severityTone(severity: string): Tone {
  if (severity === 'critical' || severity === 'error') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'neutral';
}

/**
 * Incident status tone. Statuses come from the source rows (deployment and
 * job-run states, node lifecycle or "stale", alert firing/unknown/resolved);
 * "unknown" is the last known state of an alert whose collection is not current.
 */
export function incidentStatusTone(status: string): Tone {
  switch (status) {
    case 'firing':
    case 'failed':
    case 'dead_letter':
      return 'danger';
    case 'resolved':
      return 'success';
    case 'unknown':
    case 'stale':
      return 'warning';
    default:
      return 'neutral';
  }
}
