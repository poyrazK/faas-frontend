/* ==========================================================================
   Incident bundle export: the same file `gregalectl obs bundle` writes
   (schema gregale.operator.incident-bundle/v1), so a bundle saved from the
   console and one from the CLI can be attached to a ticket and read the same
   way. Sections, coverage, redaction and limitations mirror
   cmd/gregalectl/commands_obs_bundle*.go.
   ========================================================================== */

import {
  getIncidentContext,
  getIncidentEvidence,
  incidentRefKey,
  parseIncidentId,
  type IncidentRef,
  type ObsIncidentContextResponse,
  type ObsIncidentEvidenceResponse,
} from './incidents';
import { getObsHealthDetail, getRuleHealth, type ObsHealthDetail, type ObsRuleHealthResponse } from './telemetry';

export const INCIDENT_BUNDLE_SCHEMA = 'gregale.operator.incident-bundle/v1';
/** api.ObsIncidentBundleMaxBytes */
export const INCIDENT_BUNDLE_MAX_BYTES = 4 << 20;
/** api.ObsIncidentEvidenceLimitDefault / ObsIncidentContextLimitDefault, the CLI's defaults. */
const HISTORY_LIMIT = 25;
const RESOURCE_LIMIT = 25;
/** operatorobs.RuleHealthPath: an exact feature marker, never a link to follow. */
const RULE_HEALTH_PATH = '/v1/admin/obs/rule-health';
const HEALTH_SIGNALS = ['audit_log_write_total_5m', 'audit_log_write_failures_5m', 'alerts_firing'];

interface BundleSection<T> {
  collected_at: string;
  data: T;
}

export interface IncidentBundleCoverage {
  rule_health_state: string;
  rule_health_truncated: boolean;
  suppression_state: string;
  triage_history_state: string;
  triage_history_truncated: boolean;
  triage_history_missing_entries: number | null;
  evidence_history_truncated: boolean;
  related_resources_truncated: boolean;
  related_timeline_truncated: boolean;
  unavailable_sources: string[];
  unhealthy_signals: string[];
  missing_health_metadata: string[];
  alert_collection_state: string;
  retention_state: string;
  expired_episodes: number | null;
  relationship_scope: string;
  timeline_scope: string;
}

export interface IncidentBundle {
  schema_version: string;
  started_at: string;
  completed_at: string;
  requested_incident_id: string;
  incident_id: string;
  evidence: BundleSection<ObsIncidentEvidenceResponse>;
  context: BundleSection<ObsIncidentContextResponse>;
  health: BundleSection<ObsHealthDetail>;
  rule_health?: BundleSection<ObsRuleHealthResponse>;
  coverage: IncidentBundleCoverage;
  redaction: { profile: string; excluded: string[] };
  limitations: string[];
}

const stamp = () => new Date().toISOString();

/**
 * Reads evidence, then context for the canonical incident evidence names
 * (a legacy alert series alias can move between episodes), then health and,
 * when health advertises it, rule health — the CLI's order and checks.
 */
export async function collectIncidentBundle(ref: IncidentRef): Promise<IncidentBundle> {
  const startedAt = stamp();
  const evidence = await getIncidentEvidence(ref, HISTORY_LIMIT);
  const evidenceAt = stamp();
  const canonical = parseIncidentId(evidence.incident.id);
  if (!canonical || canonical.kind !== ref.kind || evidence.history.length > HISTORY_LIMIT) {
    throw new Error('The evidence returned for this incident does not match it; nothing was exported.');
  }
  const context = await getIncidentContext(canonical, { limit: RESOURCE_LIMIT, historyLimit: HISTORY_LIMIT });
  const contextAt = stamp();
  if (context.incident_id !== evidence.incident.id) {
    throw new Error('The related context returned for this incident does not match it; nothing was exported.');
  }
  const health = await getObsHealthDetail();
  const healthAt = stamp();
  let ruleHealth: BundleSection<ObsRuleHealthResponse> | undefined;
  if (health.alert_history?.diagnostics_path === RULE_HEALTH_PATH) {
    ruleHealth = { data: await getRuleHealth(), collected_at: stamp() };
  }
  const bundle: Omit<IncidentBundle, 'coverage' | 'redaction' | 'limitations'> = {
    schema_version: INCIDENT_BUNDLE_SCHEMA,
    started_at: startedAt,
    completed_at: stamp(),
    requested_incident_id: incidentRefKey(ref),
    incident_id: evidence.incident.id,
    evidence: { collected_at: evidenceAt, data: evidence },
    context: { collected_at: contextAt, data: context },
    health: { collected_at: healthAt, data: health },
    ...(ruleHealth ? { rule_health: ruleHealth } : {}),
  };
  return { ...bundle, ...summarizeIncidentBundle(bundle) };
}

/** Coverage, redaction and limitations exactly as summarizeObsBundle records them. */
export function summarizeIncidentBundle(
  bundle: Pick<IncidentBundle, 'evidence' | 'context' | 'health' | 'rule_health'>,
): Pick<IncidentBundle, 'coverage' | 'redaction' | 'limitations'> {
  const evidence = bundle.evidence.data;
  const related = bundle.context.data;
  const health = bundle.health.data;
  const coverage: IncidentBundleCoverage = {
    rule_health_state: 'unknown',
    rule_health_truncated: false,
    suppression_state: 'not_applicable',
    triage_history_state: 'not_applicable',
    triage_history_truncated: false,
    triage_history_missing_entries: null,
    evidence_history_truncated: evidence.truncated,
    related_resources_truncated: related.next_cursor !== '',
    related_timeline_truncated: related.timeline_truncated,
    unavailable_sources: [
      ...(evidence.unavailable_sources ?? []).map((source) => `evidence.${source}`),
      ...(related.unavailable_sources ?? []).map((source) => `context.${source}`),
    ],
    unhealthy_signals: [],
    missing_health_metadata: [],
    alert_collection_state: 'unknown',
    retention_state: 'unknown',
    expired_episodes: null,
    relationship_scope: related.scope.state,
    timeline_scope: related.timeline_scope,
  };
  for (const name of HEALTH_SIGNALS) {
    const signal = health.signals?.[name];
    if (!signal?.observed_at) coverage.missing_health_metadata.push(name);
    if (!signal?.observed_at || signal.state !== 'healthy') coverage.unhealthy_signals.push(name);
  }
  if (!health.alert_history) coverage.missing_health_metadata.push('alert_history');
  else if (health.alert_history.collection_state) coverage.alert_collection_state = health.alert_history.collection_state;
  else coverage.missing_health_metadata.push('alert_history.collection_state');
  if (!health.alert_retention) coverage.missing_health_metadata.push('alert_retention');
  else {
    coverage.retention_state = health.alert_retention.state;
    coverage.expired_episodes = health.alert_retention.expired_episodes;
  }
  if (bundle.rule_health) {
    coverage.rule_health_state = bundle.rule_health.data.state;
    coverage.rule_health_truncated = bundle.rule_health.data.truncated;
  } else coverage.missing_health_metadata.push('rule_health');
  if (evidence.incident.type === 'platform_alert') {
    coverage.suppression_state = evidence.suppression?.state ?? 'unknown';
    coverage.triage_history_state = 'unknown';
    if (evidence.triage_history) {
      coverage.triage_history_state = evidence.triage_history.coverage.state;
      coverage.triage_history_truncated = evidence.triage_history.truncated;
      coverage.triage_history_missing_entries = evidence.triage_history.coverage.missing_entries;
    }
  }
  return {
    coverage,
    redaction: {
      profile: 'operator-metadata-only',
      excluded: [
        'credentials',
        'local_configuration',
        'request_bodies_and_headers',
        'raw_logs',
        'raw_event_payloads',
        'actor_identities',
        'commands_and_environment',
        'raw_span_attributes',
        'raw_sql',
      ],
    },
    limitations: [
      'rule_health_covers_current_loaded_rules_not_expected_inventory_or_past_failure_cause',
      'suppression_is_current_only_and_does_not_prove_delivery',
      'sections_are_separate_reads_not_one_atomic_snapshot',
      'relationships_are_current_potential_exposure_not_historical_impact_or_causation',
      'one_resource_page_only_timeline_covers_incident_scope_and_returned_resources',
      'history_windows_and_truncation_are_per_section',
      'triage_history_is_one_page_revision_bounded_receipts_can_expire_between_reads',
      'trace_and_diagnostic_links_are_not_fetched',
      'unhealthy_or_missing_signal_metadata_makes_numeric_fallbacks_unusable',
      'identifiers_and_operational_metadata_require_controlled_sharing',
    ],
  };
}

/**
 * The file body, redacted like marshalObsBundle: an unknown diagnostics path
 * and the triage owner's account ID are dropped. Refuses bundles over the
 * server's size limit rather than writing a file the CLI would reject.
 */
export function serializeIncidentBundle(bundle: IncidentBundle): string {
  const safe: IncidentBundle = structuredClone(bundle);
  const history = safe.health.data.alert_history;
  if (history?.diagnostics_path && history.diagnostics_path !== RULE_HEALTH_PATH) delete history.diagnostics_path;
  const triage = safe.evidence.data.incident.triage;
  if (triage) delete triage.owner_account_id;
  const body = `${JSON.stringify(safe, null, 2)}\n`;
  if (new TextEncoder().encode(body).length > INCIDENT_BUNDLE_MAX_BYTES) {
    throw new Error(`The bundle is larger than ${INCIDENT_BUNDLE_MAX_BYTES} bytes; export it with gregalectl obs bundle and lower limits.`);
  }
  return body;
}

/** "incident-deployment-7a1b2c3d-2026-10-31T14-02-11Z.json" */
export const incidentBundleFileName = (incidentId: string, at = new Date()) =>
  `incident-${incidentId.replace('/', '-').slice(0, 64)}-${at.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')}.json`;
