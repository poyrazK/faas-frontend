import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Renders the Incidents and Telemetry pages against canned backend responses
 * (useAsync resolves synchronously here) to pin the honesty rules: missing
 * telemetry is shown as unknown or incomplete, never as zero or all-clear.
 */

const scenario = vi.hoisted(() => ({
  /** The page's query string (filters, open incident). */
  search: '',
  inbox: null as unknown,
  /** Overrides the key the inbox snapshot claims to answer. */
  inboxKey: null as string | null,
  summary: null as unknown,
  health: null as unknown,
}));

const collection = { state: 'unknown', collection_state: 'never_collected', reason: 'not_collected' };
const retention = { state: 'never_run', reason: 'not_cleaned', as_of: '2026-10-30T12:00:00Z', cutoff: '2026-09-30T12:00:00Z', last_pruned_episodes: null, expired_episodes: 0 };

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  request: () => {
    throw new Error('network access is not expected in this test');
  },
  writeHeaders: () => ({}),
  getObsHealth: () => scenario.health,
  searchObsAuditLog: () => ({ generated_at: '2026-10-30T12:00:00Z', items: [], limit: 8, include_anonymous: false, window_hours: 24 }),
  obsNodeEventsUrl: '/v1/admin/obs/nodes/events',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(scenario.search),
}));

vi.mock('@/lib/useAsync', () => ({
  useAsync: (fetcher: () => unknown) => ({
    data: fetcher(),
    loading: false,
    error: null,
    reload: () => {},
    setData: () => {},
    stale: false,
    lastSuccessAt: Date.now(),
  }),
}));

vi.mock('@/lib/ops/incidents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ops/incidents')>();
  return {
    ...actual,
    loadIncidentInbox: (filters: import('@/lib/ops/incidents').IncidentFilters) => ({
      key: scenario.inboxKey ?? actual.incidentFiltersKey(filters),
      page: scenario.inbox,
    }),
    getAlertWorkloadSummary: () => scenario.summary,
    getAlertResponseTimes: () => ({
      as_of: '2026-10-30T12:00:00Z',
      since: '2026-10-29T12:00:00Z',
      scope: 'retained_activation_cohort',
      duration_basis: 'episode_activation',
      percentile_method: 'nearest_rank_whole_seconds',
      limitations: ['resolution_is_confirmed_observation'],
      collection,
      retention,
      totals: null,
      groups: [],
    }),
    getAlertRecurrence: () => ({
      as_of: '2026-10-30T12:00:00Z',
      since: '2026-10-29T12:00:00Z',
      scope: 'retained_activation_cohort',
      percentile_method: 'nearest_rank_whole_seconds',
      limitations: [],
      collection,
      retention,
      totals: null,
      items: [],
      truncated: false,
    }),
  };
});

vi.mock('@/lib/ops/telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ops/telemetry')>();
  const unavailable = { state: 'unavailable', reason: 'query_failed', value: null, window_seconds: 900, max_age_seconds: 120 };
  return {
    ...actual,
    getNotificationHealth: () => ({
      generated_at: '2026-10-30T12:00:00Z',
      state: 'partial',
      window_seconds: 900,
      alertmanager_api: { state: 'unavailable', reason: 'request_failed' },
      signals: { prometheus_dropped: unavailable, alertmanager_failures: unavailable },
      integrations: [],
      limitations: ['no_human_receipt_confirmation'],
    }),
    getRuleHealth: () => ({
      generated_at: '2026-10-30T12:00:00Z',
      scope: 'currently_loaded_alert_rules',
      state: 'unavailable',
      reason: 'source_unavailable',
      max_age_seconds: 120,
      clock_skew_tolerance_seconds: 30,
      totals: null,
      items: [],
      total_items: 0,
      limit: 50,
      truncated: false,
      limitations: [],
    }),
    getCollectionHistory: () => ({
      coverage: {
        since: '2026-10-29T12:00:00Z',
        as_of: '2026-10-30T12:00:00Z',
        scope: 'recorded_collection_cadence',
        state: 'unknown',
        max_age_seconds: 60,
        retention_seconds: 2592000,
        window_microseconds: 86_400_000_000,
        successful_observation_microseconds: 0,
        failed_observation_microseconds: 0,
        unknown_microseconds: 86_400_000_000,
        successes: 0,
        failures: 0,
        limitations: [],
      },
      collection,
      items: [],
      total_intervals: 0,
      limit: 200,
      truncated: false,
    }),
    getInputHealth: (role?: string) => ({
      generated_at: '2026-10-30T12:00:00Z',
      scope: 'selected_critical_telemetry_inputs',
      expected_role: role ?? '',
      available_roles: ['single-box-v1', 'control-plane-v1'],
      state: 'unknown',
      reason: 'expected_role_not_selected',
      max_age_seconds: 120,
      lookback_seconds: 900,
      jobs: [],
      limitations: [],
    }),
    getRuleCoverage: () => ({
      generated_at: '2026-10-30T12:00:00Z',
      scope: 'selected_expected_alert_rules',
      fingerprint_algorithm: 'sha256',
      selection_source: 'none',
      state: 'unknown',
      reason: 'expected_set_not_selected',
      expected_set: null,
      available_sets: [{ id: 'platform-alerts', revision: 'r1', files: ['alerts.yml'], expected_rules: 12 }],
      totals: null,
      items: [],
      total_items: 0,
      limit: 100,
      truncated: false,
      limitations: [],
    }),
    getRecordingCoverage: () => ({
      generated_at: '2026-10-30T12:00:00Z',
      scope: 'selected_expected_recording_rules',
      fingerprint_algorithm: 'sha256',
      selection_source: 'none',
      state: 'unknown',
      reason: 'expected_set_not_selected',
      expected_set: null,
      available_sets: [],
      totals: null,
      items: [],
      total_items: 0,
      limit: 100,
      truncated: false,
      dependencies: null,
      limitations: [],
    }),
  };
});

import IncidentsPage from '@/app/operations/incidents/page';
import TelemetryHealthPage from '@/app/operations/telemetry/page';

const ALERT_ID = 'b'.repeat(64);

const listPage = (items: unknown[], unavailable: string[]) => ({
  unavailable_sources: unavailable,
  generated_at: '2026-10-30T12:00:00Z',
  items,
  limit: 50,
  since: '2026-10-29T12:00:00Z',
  since_clamped: false,
  next_cursor: '',
});

beforeEach(() => {
  scenario.search = '';
  scenario.inboxKey = null;
  scenario.inbox = listPage([], ['prometheus']);
  scenario.summary = { as_of: '2026-10-30T12:00:00Z', scope: 'retained_platform_alert_episodes', age_basis: 'episode_started_at', collection, retention, counts: null, groups: [], oldest_unacknowledged: null, oldest_unowned: null };
  scenario.health = {
    generated_at: '2026-10-30T12:00:00Z',
    prometheus_available: false,
    audit_log_write_total_5m: 0,
    audit_log_write_failures_5m: 0,
    audit_log_coverage_ratio_5m: 1,
    alerts_firing: 0,
    operator_intent_outcome_missing_total: {},
    trace_id_completeness_ratio: {},
    signals: {
      audit_log_write_total_5m: { state: 'unavailable', reason: 'query_failed', window_seconds: 300, max_age_seconds: 120 },
      audit_log_write_failures_5m: { state: 'unavailable', reason: 'query_failed', window_seconds: 300, max_age_seconds: 120 },
      alerts_firing: { state: 'unavailable', reason: 'query_failed', window_seconds: 300, max_age_seconds: 120 },
    },
  };
});

const render = (page: React.ComponentType) => renderToStaticMarkup(React.createElement(page));

describe('incidents page', () => {
  it('shows an empty, incomplete snapshot as incomplete rather than all-clear', () => {
    const html = render(IncidentsPage);
    expect(html).toContain('Incomplete snapshot');
    expect(html).toContain('Prometheus (live alerts)');
    expect(html).toContain('this is not an all-clear');
    expect(html).not.toContain('No incidents match these filters');
  });

  it('reports unknown alert workload instead of zeros', () => {
    const html = render(IncidentsPage);
    expect(html).toContain('Not collected');
    expect(html).toContain('counts are unknown');
    expect(html).toContain('No cohort statistics');
    expect(html).toContain('missing evidence, not a quiet fleet');
  });

  it('lists incidents with triage state and console links while flagging the gap', () => {
    scenario.inbox = listPage(
      [
        {
          id: `platform_alert/${ALERT_ID}`,
          type: 'platform_alert',
          severity: 'critical',
          status: 'firing',
          summary: 'FaasApidDown (apid)',
          resource_id: 'FaasApidDown',
          resource_name: 'FaasApidDown (apid)',
          observed_at: '2026-10-30T11:50:00Z',
          dedupe_key: 'platform_alert/series',
          action_path: '/v1/admin/obs/health',
          runbook_url: '/docs/ops/alert-cookbook.md',
          triage: { revision: 1, acknowledged: false, owned: false, snoozed: false, as_of: '2026-10-30T12:00:00Z' },
        },
      ],
      ['prometheus_alert_metadata'],
    );
    const html = render(IncidentsPage);
    expect(html).toContain('FaasApidDown (apid)');
    expect(html).toContain('unacked');
    // The row opens the incident; its console and runbook links live in the row's menu.
    expect(html).toContain('aria-label="Open incident: FaasApidDown (apid)"');
    expect(html).toContain('aria-label="Actions for incident FaasApidDown (apid)"');
    expect(html).toContain('Incomplete snapshot');
  });

  it('never shows a page answered for other filters', () => {
    scenario.inboxKey = 'deployment|critical|0||||50|';
    scenario.inbox = listPage(
      [{ id: `job_run/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, type: 'job_run', severity: 'error', status: 'failed', summary: 'job run failed', resource_id: 'x', observed_at: '2026-10-30T11:00:00Z', dedupe_key: 'k' }],
      [],
    );
    const html = render(IncidentsPage);
    expect(html).not.toContain('job run failed');
    expect(html).toContain('Loading incidents');
  });

  it('queries with the filters in the URL, so a shared link shows the same inbox', () => {
    scenario.search = 'type=deployment&severity=critical';
    // The snapshot answers exactly the URL's filters (type|severity|window|…|limit|cursor).
    scenario.inboxKey = 'deployment|critical|0|||||50|';
    scenario.inbox = listPage(
      [{ id: `deployment/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, type: 'deployment', severity: 'critical', status: 'failed', summary: 'deploy failed', resource_id: `${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, observed_at: '2026-10-30T11:00:00Z', dedupe_key: 'k' }],
      [],
    );
    const html = render(IncidentsPage);
    expect(html).toContain('deploy failed');
    expect(html).toContain('<option value="deployment" selected="">');
    expect(html).toContain('aria-label="Open incident: deploy failed"');
  });
});

describe('telemetry page', () => {
  it('shows unavailable pipeline numbers as unavailable, not zero', () => {
    const html = render(TelemetryHealthPage);
    expect(html).toContain('Observability pipeline health');
    expect(html).toContain('Telemetry unavailable');
    expect(html).toContain('query failed');
  });

  it('asks for explicit selections and keeps unavailable signals unknown', () => {
    const html = render(TelemetryHealthPage);
    expect(html).toContain('Choose the expected set');
    expect(html).toContain('platform-alerts · rev r1 · 12 rules');
    expect(html).toContain('Choose the deployment role');
    expect(html).toContain('Not selected');
    expect(html).toContain('rule evaluation health is unknown');
    expect(html).toContain('— (query failed)');
    expect(html).toContain('never collected');
  });
});
