/* ==========================================================================
   Telemetry health: "can the operator trust the alerting stack right now?"

   Every response here is evidence about the observability pipeline itself
   (notification path, loaded alert rules, expected rule/recording coverage,
   scrape inputs, alert collection cadence). The backend separates missing
   evidence from healthy evidence everywhere, so the console must too: a null
   count or an "unknown" state is never rendered as zero or healthy.

   Contract: pkg/api/obs_{notifications,rule_health,rule_coverage,
   recording_coverage,input_health,collection_history}.go and the matching
   handlers in pkg/apid/apidserver/handlers_admin_obs_*.go. Several handlers
   reject unknown or empty query parameters, so the builders below only ever
   emit the exact parameters each handler accepts.
   ========================================================================== */

import { request, getObsHealth, type ObsHealthResponse } from '@/lib/api';

/* ─────────────────────────── Shared alert pipeline ─────────────────────── */

/**
 * Alert collection health. `state` is the original current/unknown evidence
 * contract; `collection_state` distinguishes disabled, never_collected,
 * failed, stale and current.
 */
export interface ObsAlertCollectionHealth {
  diagnostics_path?: string;
  state: string;
  collection_state?: string;
  reason?: string;
  last_attempt_at?: string;
  last_success_at?: string;
}

/** Alert-history cleanup, observed independently of Prometheus. */
export interface ObsAlertRetentionHealth {
  state: string;
  reason?: string;
  as_of: string;
  cutoff: string;
  last_attempt_at?: string;
  last_success_at?: string;
  /** Null until cleanup has succeeded once. */
  last_pruned_episodes: number | null;
  expired_episodes: number;
  oldest_expired_at?: string;
}

/** Retained collection cadence evidence over a window; not uptime. */
export interface ObsAlertCollectionCoverage {
  since: string;
  as_of: string;
  scope: string;
  state: string;
  max_age_seconds: number;
  retention_seconds: number;
  window_microseconds: number;
  successful_observation_microseconds: number;
  failed_observation_microseconds: number;
  unknown_microseconds: number;
  successes: number;
  failures: number;
  limitations: string[];
}

/* ─────────────────────────── /v1/admin/obs/health ──────────────────────── */

/** Evidence behind one Prometheus-derived field of /v1/admin/obs/health. */
export interface ObsHealthSignal {
  state: string;
  observed_at?: string;
  window_seconds: number;
  max_age_seconds: number;
  reason?: string;
}

/**
 * The backend's ObsHealthResponse carries three fields that the shared
 * ObsHealthResponse in api.ts does not declare yet (signals, alert_history,
 * alert_retention). They are optional on the wire too (omitempty / legacy).
 */
export interface ObsHealthDetail extends ObsHealthResponse {
  signals?: Record<string, ObsHealthSignal>;
  alert_history?: ObsAlertCollectionHealth;
  alert_retention?: ObsAlertRetentionHealth;
}

export const getObsHealthDetail = () => getObsHealth() as Promise<ObsHealthDetail>;

/** Signal keys the health handler emits for its Prometheus-derived numbers. */
export type ObsHealthMetricKey = 'audit_log_write_total_5m' | 'audit_log_write_failures_5m' | 'alerts_firing';

/**
 * A Prometheus-derived number from /v1/admin/obs/health, or why it cannot be
 * trusted. Numeric fields are usable only when their signal is healthy; a
 * legacy response without `signals` falls back to `prometheus_available`.
 */
export function healthMetric(
  health: ObsHealthDetail,
  key: ObsHealthMetricKey,
): { value: number; signal?: ObsHealthSignal } | { value: null; reason: string; signal?: ObsHealthSignal } {
  const signal = health.signals?.[key];
  if (signal) {
    if (signal.state === 'healthy') return { value: health[key], signal };
    return { value: null, reason: humanize(signal.reason || signal.state), signal };
  }
  if (!health.prometheus_available) return { value: null, reason: 'Prometheus could not be queried' };
  return { value: health[key] };
}

/* ─────────────────────── /v1/admin/obs/notification-health ─────────────── */

/** Separates fresh zero values from missing evidence; value is null unless healthy. */
export interface ObsNotificationSignal {
  state: string;
  reason?: string;
  value: number | null;
  observed_at?: string;
  window_seconds: number;
  max_age_seconds: number;
}

export interface ObsNotificationAPIStatus {
  state: string;
  reason?: string;
  observed_at?: string;
}

/** A closed integration type (never a receiver name or address). */
export interface ObsNotificationIntegration {
  integration: string;
  attempts: ObsNotificationSignal;
  failures: ObsNotificationSignal;
}

export interface ObsNotificationHealth {
  generated_at: string;
  state: string;
  window_seconds: number;
  alertmanager_api: ObsNotificationAPIStatus;
  signals: Record<string, ObsNotificationSignal>;
  integrations: ObsNotificationIntegration[];
  limitations: string[];
}

/** Accepts no query parameters. */
export const getNotificationHealth = () =>
  request<ObsNotificationHealth>('/v1/admin/obs/notification-health', { cache: 'no-store' });

/* ─────────────────────────── /v1/admin/obs/rule-health ─────────────────── */

/** Rule state categories partition `rules`. */
export interface ObsRuleHealthTotals {
  groups: number;
  rules: number;
  healthy: number;
  failed: number;
  stale: number;
  invalid_clock: number;
  unavailable: number;
  invalid: number;
  invalid_groups: number;
}

/** Counts (pending/firing) are usable only for healthy items; null never means quiet. */
export interface ObsRuleHealthItem {
  kind: string;
  id: string;
  group_id: string;
  group_name?: string;
  file_name?: string;
  rule_name?: string;
  state: string;
  issues: string[];
  reported_state: string;
  last_evaluated_at?: string;
  evaluation_age_seconds: number | null;
  has_evaluation_error: boolean;
  pending: number | null;
  firing: number | null;
  runbook_url?: string;
}

export interface ObsRuleHealthResponse {
  generated_at: string;
  scope: string;
  state: string;
  reason?: string;
  max_age_seconds: number;
  clock_skew_tolerance_seconds: number;
  /** Null when the rule source could not be read. */
  totals: ObsRuleHealthTotals | null;
  items: ObsRuleHealthItem[];
  total_items: number;
  limit: number;
  truncated: boolean;
  limitations: string[];
}

/** Accepts no query parameters. */
export const getRuleHealth = () =>
  request<ObsRuleHealthResponse>('/v1/admin/obs/rule-health', { cache: 'no-store' });

/* ─────────────────── rule-coverage / recording-coverage ────────────────── */

export interface ObsRuleCoverageSet {
  id: string;
  revision: string;
  files: string[];
  expected_rules: number;
}

/** Expected categories partition expected_rules. */
export interface ObsRuleCoverageTotals {
  expected_rules: number;
  observed_rules: number;
  additional_rules: number;
  invalid_observed_rules: number;
  invalid_observed_groups: number;
  matching: number;
  missing: number;
  changed: number;
  ambiguous: number;
  unknown: number;
}

export interface ObsRuleCoverageItem {
  id: string;
  file_name: string;
  group_name: string;
  rule_name: string;
  state: string;
  reason?: string;
  expected_fingerprint: string;
  observed_fingerprint?: string;
  observed_candidates: number;
  changed_fields: string[];
}

/**
 * Compares an explicitly selected expected set with one loaded alert-rule
 * read. Without a selection the server answers state=unknown,
 * reason=expected_set_not_selected and lists `available_sets`.
 */
export interface ObsRuleCoverage {
  generated_at: string;
  scope: string;
  fingerprint_algorithm: string;
  /** "none" or "explicit_request". */
  selection_source: string;
  state: string;
  reason?: string;
  expected_set: ObsRuleCoverageSet | null;
  available_sets: ObsRuleCoverageSet[];
  totals: ObsRuleCoverageTotals | null;
  items: ObsRuleCoverageItem[];
  total_items: number;
  limit: number;
  truncated: boolean;
  limitations: string[];
}

export interface ObsRecordingAlertReference {
  id: string;
  file_name: string;
  group_name: string;
  rule_name: string;
}

export interface ObsRecordingAlertReferences {
  items: ObsRecordingAlertReference[];
  total_items: number;
  limit: number;
  truncated: boolean;
}

export interface ObsRecordingCoverageItem {
  comparison: ObsRuleCoverageItem;
  dependent_alerts: ObsRecordingAlertReferences;
}

export interface ObsRecordingDependencyMapping {
  scope: string;
  state: string;
  alert_set_revision: string;
  total_alerts: number;
  uncertain_alerts: ObsRecordingAlertReferences;
}

export interface ObsRecordingCoverage {
  generated_at: string;
  scope: string;
  fingerprint_algorithm: string;
  selection_source: string;
  state: string;
  reason?: string;
  expected_set: ObsRuleCoverageSet | null;
  available_sets: ObsRuleCoverageSet[];
  totals: ObsRuleCoverageTotals | null;
  items: ObsRecordingCoverageItem[];
  total_items: number;
  limit: number;
  truncated: boolean;
  dependencies: ObsRecordingDependencyMapping | null;
  limitations: string[];
}

/** `?expected_set=<id>` when selected; no query string at all otherwise (an empty value is rejected). */
export function coveragePath(base: '/v1/admin/obs/rule-coverage' | '/v1/admin/obs/recording-coverage', expectedSet?: string): string {
  const set = expectedSet?.trim();
  return set ? `${base}?${new URLSearchParams({ expected_set: set })}` : base;
}

/**
 * True when a coverage response answers the current selection. Responses
 * echo it (selection_source, expected_set), so a response for the previous
 * selection is never shown under a new one while the new read is in flight.
 */
export function coverageAnswers(
  data: Pick<ObsRuleCoverage, 'selection_source' | 'expected_set'>,
  selected: string,
): boolean {
  if (!selected) return data.selection_source === 'none';
  // An unknown/unavailable set echoes no expected_set but is still the answer.
  return data.selection_source === 'explicit_request' && (data.expected_set?.id ?? selected) === selected;
}

export const getRuleCoverage = (expectedSet?: string) =>
  request<ObsRuleCoverage>(coveragePath('/v1/admin/obs/rule-coverage', expectedSet), { cache: 'no-store' });

export const getRecordingCoverage = (expectedSet?: string) =>
  request<ObsRecordingCoverage>(coveragePath('/v1/admin/obs/recording-coverage', expectedSet), { cache: 'no-store' });

/* ─────────────────────────── /v1/admin/obs/input-health ────────────────── */

export interface ObsInputExpectation {
  source: string;
  state: string;
  reason?: string;
  minimum_targets: number | null;
  invalid_targets: number | null;
  observed_at: string | null;
}

export interface ObsInputTargetCounts {
  observed: number;
  fresh_up: number;
  down: number;
  stale: number;
  missing_minimum: number | null;
  extra: number | null;
}

export interface ObsInputTargets {
  state: string;
  reason?: string;
  counts: ObsInputTargetCounts | null;
}

export interface ObsInputMetricCounts {
  expected: number;
  fresh: number;
  missing: number;
  stale: number;
}

export interface ObsInputMetric {
  metric: string;
  state: string;
  reason?: string;
  counts: ObsInputMetricCounts | null;
}

export interface ObsInputJob {
  job: string;
  state: string;
  expectation: ObsInputExpectation;
  targets: ObsInputTargets;
  metrics: ObsInputMetric[];
}

/**
 * Without `expected_role` the server answers state=unknown,
 * reason=expected_role_not_selected and lists `available_roles`.
 */
export interface ObsInputHealth {
  generated_at: string;
  scope: string;
  expected_role: string;
  available_roles: string[];
  state: string;
  reason?: string;
  max_age_seconds: number;
  lookback_seconds: number;
  jobs: ObsInputJob[];
  limitations: string[];
}

export function inputHealthPath(expectedRole?: string): string {
  const role = expectedRole?.trim();
  return role ? `/v1/admin/obs/input-health?${new URLSearchParams({ expected_role: role })}` : '/v1/admin/obs/input-health';
}

/** expected_role echoes the selection ("" when none was sent). */
export const inputHealthAnswers = (data: Pick<ObsInputHealth, 'expected_role'>, selected: string) =>
  data.expected_role === selected;

export const getInputHealth = (expectedRole?: string) =>
  request<ObsInputHealth>(inputHealthPath(expectedRole), { cache: 'no-store' });

/* ──────────────────────── /v1/admin/obs/collection-history ─────────────── */

export interface ObsAlertCollectionHistoryInterval {
  from: string;
  until: string;
  state: string;
  reason: string;
}

/** Observations from the exact rejected source snapshot. */
export interface ObsAlertCollectionRejection {
  scope: string;
  reason: string;
  totals: ObsRuleHealthTotals;
  items: ObsRuleHealthItem[];
  total_items: number;
  limit: number;
  truncated: boolean;
}

export interface ObsAlertCollectionFailure {
  attempted_at: string;
  reason: string;
  diagnostics_state: string;
  diagnostics: ObsAlertCollectionRejection | null;
}

/** Opt-in (details=true); missing historical diagnostics never mean healthy rules. */
export interface ObsAlertCollectionFailureDetails {
  items: ObsAlertCollectionFailure[];
  total_failures: number;
  limit: number;
  truncated: boolean;
  limitations: string[];
}

export interface ObsAlertCollectionHistory {
  failure_details?: ObsAlertCollectionFailureDetails;
  coverage: ObsAlertCollectionCoverage;
  collection: ObsAlertCollectionHealth;
  items: ObsAlertCollectionHistoryInterval[];
  total_intervals: number;
  limit: number;
  truncated: boolean;
}

export interface CollectionHistoryQuery {
  /** RFC 3339; omitted means the server default (24 h). Must be within 30 days. */
  since?: string;
  /** Adds failure_details. Only sent when true. */
  details?: boolean;
}

/** Only nonempty `since` and `details=true` are emitted; the handler rejects empty values. */
export function collectionHistoryPath(query: CollectionHistoryQuery = {}): string {
  const q = new URLSearchParams();
  if (query.since) q.set('since', query.since);
  if (query.details) q.set('details', 'true');
  const qs = q.toString();
  return qs ? `/v1/admin/obs/collection-history?${qs}` : '/v1/admin/obs/collection-history';
}

export const getCollectionHistory = (query: CollectionHistoryQuery = {}) =>
  request<ObsAlertCollectionHistory>(collectionHistoryPath(query), { cache: 'no-store' });

/* ─────────────────────────────── Windows ───────────────────────────────── */

export interface LookbackWindow {
  value: string;
  label: string;
  /** Zero means "omit since": the server applies its own default window. */
  hours: number;
}

/**
 * Look-back windows for the retained alert reads (collection history,
 * recurrence, response times), all bounded at 30 days by the server. The
 * longest option stays an hour inside that bound so a client clock running
 * slightly behind the server cannot turn the request into a 400.
 */
export const RETAINED_WINDOWS: readonly LookbackWindow[] = [
  { value: '', label: 'Last 24 hours', hours: 0 },
  { value: '72h', label: 'Last 3 days', hours: 72 },
  { value: '7d', label: 'Last 7 days', hours: 168 },
  { value: '30d', label: 'Last 30 days', hours: 30 * 24 - 1 },
];

/** RFC 3339 `since` for a window, or undefined for the server default. */
export function windowSince(hours: number, now = Date.now()): string | undefined {
  if (!hours) return undefined;
  return new Date(now - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* ──────────────────────────── Presentation ─────────────────────────────── */

/** "expected_set_not_selected" → "expected set not selected". */
export function humanize(code: string | null | undefined): string {
  if (!code) return '';
  return code.replace(/[_-]+/g, ' ').trim();
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

/**
 * Badge tone for the closed state vocabularies these endpoints use. Anything
 * that means "no evidence" is a warning, never success.
 */
export function stateTone(state: string | null | undefined): Tone {
  switch (state) {
    case 'healthy':
    case 'current':
    case 'covered':
    case 'complete':
    case 'matching':
    case 'active':
      return 'success';
    case 'degraded':
    case 'failed':
    case 'missing':
    case 'changed':
    case 'invalid':
    case 'down':
      return 'danger';
    case 'disabled':
    case 'not_applicable':
      return 'neutral';
    case 'suppressed':
      return 'info';
    default:
      // partial, stale, unknown, unavailable, no_samples, never_collected, …
      return 'warning';
  }
}

export const badgeClass = (tone: Tone) => `badge badge-${tone}`;

/** Fraction (0–1) of a coverage window spent in each observation state. */
export function coverageShares(coverage: ObsAlertCollectionCoverage): { success: number; failed: number; unknown: number } {
  const total = coverage.window_microseconds;
  if (!total || total <= 0) return { success: 0, failed: 0, unknown: 1 };
  const clamp = (n: number) => Math.min(1, Math.max(0, n / total));
  return {
    success: clamp(coverage.successful_observation_microseconds),
    failed: clamp(coverage.failed_observation_microseconds),
    unknown: clamp(coverage.unknown_microseconds),
  };
}

/** Seconds → "45s", "12m 5s", "3h 20m", "2d 4h". Null stays an explicit dash. */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}
