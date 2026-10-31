import { describe, expect, it } from 'vitest';
import type { IncidentBundle } from './incidentBundle';
import {
  INCIDENT_BUNDLE_SCHEMA,
  incidentBundleFileName,
  serializeIncidentBundle,
  summarizeIncidentBundle,
} from './incidentBundle';

const UUID = '7a1b2c3d-0000-4000-8000-000000000001';

function sections(overrides: { type?: string; health?: object; rule?: boolean } = {}) {
  return {
    evidence: {
      collected_at: '2026-10-31T12:00:00.000Z',
      data: {
        generated_at: '2026-10-31T12:00:00Z',
        incident: {
          id: `${overrides.type ?? 'deployment'}/${UUID}`,
          type: overrides.type ?? 'deployment',
          severity: 'error',
          status: 'failed',
          summary: 'deploy failed',
          resource_id: UUID,
          observed_at: '2026-10-31T11:00:00Z',
          dedupe_key: 'k',
          triage: { revision: 3, acknowledged: true, owned: true, owner_account_id: 'op-secret', snoozed: false, as_of: '2026-10-31T12:00:00Z' },
        },
        since: '2026-10-30T12:00:00Z',
        limit: 25,
        truncated: true,
        history: [],
        unavailable_sources: ['audit'],
      },
    },
    context: {
      collected_at: '2026-10-31T12:00:01.000Z',
      data: {
        as_of: '2026-10-31T12:00:01Z',
        incident_id: `deployment/${UUID}`,
        scope: { state: 'known' },
        resources: [],
        limit: 25,
        next_cursor: 'c1',
        since: '2026-10-30T12:00:00Z',
        until: '2026-10-31T12:00:00Z',
        timeline: [],
        timeline_scope: 'incident_scope_and_returned_resources',
        timeline_limit: 25,
        timeline_truncated: false,
        unavailable_sources: ['jobs'],
      },
    },
    health: {
      collected_at: '2026-10-31T12:00:02.000Z',
      data: {
        generated_at: '2026-10-31T12:00:02Z',
        signals: {
          audit_log_write_total_5m: { state: 'healthy', observed_at: '2026-10-31T12:00:00Z' },
          audit_log_write_failures_5m: { state: 'unavailable' },
        },
        alert_history: { state: 'current', collection_state: 'collected', diagnostics_path: '/v1/admin/obs/secret-debug' },
        ...overrides.health,
      },
    },
    ...(overrides.rule ? { rule_health: { collected_at: '2026-10-31T12:00:03.000Z', data: { state: 'healthy', truncated: true } } } : {}),
  } as unknown as Pick<IncidentBundle, 'evidence' | 'context' | 'health' | 'rule_health'>;
}

const bundleOf = (parts: ReturnType<typeof sections>): IncidentBundle => ({
  schema_version: INCIDENT_BUNDLE_SCHEMA,
  started_at: '2026-10-31T12:00:00.000Z',
  completed_at: '2026-10-31T12:00:03.000Z',
  requested_incident_id: `deployment/${UUID}`,
  incident_id: `deployment/${UUID}`,
  ...parts,
  ...summarizeIncidentBundle(parts),
});

describe('incident bundle coverage', () => {
  it('records gaps the way gregalectl obs bundle does', () => {
    const { coverage, redaction, limitations } = summarizeIncidentBundle(sections());
    expect(coverage).toEqual({
      rule_health_state: 'unknown',
      rule_health_truncated: false,
      suppression_state: 'not_applicable',
      triage_history_state: 'not_applicable',
      triage_history_truncated: false,
      triage_history_missing_entries: null,
      evidence_history_truncated: true,
      related_resources_truncated: true,
      related_timeline_truncated: false,
      unavailable_sources: ['evidence.audit', 'context.jobs'],
      unhealthy_signals: ['audit_log_write_failures_5m', 'alerts_firing'],
      missing_health_metadata: ['audit_log_write_failures_5m', 'alerts_firing', 'alert_retention', 'rule_health'],
      alert_collection_state: 'collected',
      retention_state: 'unknown',
      expired_episodes: null,
      relationship_scope: 'known',
      timeline_scope: 'incident_scope_and_returned_resources',
    });
    expect(redaction.profile).toBe('operator-metadata-only');
    expect(limitations).toHaveLength(10);
  });

  it('reports rule health, and suppression and triage state for platform alerts', () => {
    const { coverage } = summarizeIncidentBundle(sections({ type: 'platform_alert', rule: true }));
    expect(coverage).toMatchObject({ rule_health_state: 'healthy', rule_health_truncated: true, suppression_state: 'unknown', triage_history_state: 'unknown' });
  });
});

describe('incident bundle file', () => {
  it('drops unknown diagnostics paths and the triage owner, and ends with a newline', () => {
    const bundle = bundleOf(sections());
    const body = serializeIncidentBundle(bundle);
    const parsed = JSON.parse(body);
    expect(body.endsWith('}\n')).toBe(true);
    expect(parsed.schema_version).toBe('gregale.operator.incident-bundle/v1');
    expect(parsed.health.data.alert_history.diagnostics_path).toBeUndefined();
    expect(parsed.evidence.data.incident.triage).toMatchObject({ revision: 3 });
    expect(parsed.evidence.data.incident.triage.owner_account_id).toBeUndefined();
    // The in-memory bundle is left as collected.
    expect(bundle.evidence.data.incident.triage?.owner_account_id).toBe('op-secret');
  });

  it('keeps the known rule-health path and refuses oversized bundles', () => {
    const parts = sections({ health: { alert_history: { state: 'current', collection_state: 'collected', diagnostics_path: '/v1/admin/obs/rule-health' } } });
    expect(JSON.parse(serializeIncidentBundle(bundleOf(parts))).health.data.alert_history.diagnostics_path).toBe('/v1/admin/obs/rule-health');
    const huge = bundleOf(sections());
    (huge.evidence.data as unknown as { history: unknown[] }).history = [{ id: 'x'.repeat(4 << 20) }];
    expect(() => serializeIncidentBundle(huge)).toThrow(/larger than/);
  });

  it('names the file after the incident and the time', () => {
    expect(incidentBundleFileName(`deployment/${UUID}`, new Date('2026-10-31T14:02:11.123Z'))).toBe(
      `incident-deployment-${UUID}-2026-10-31T14-02-11Z.json`,
    );
  });
});
