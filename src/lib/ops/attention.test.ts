import { describe, expect, it } from 'vitest';
import type { ObsAlertWorkloadSummary, ObsIncident, ObsIncidentListResponse } from './incidents';
import { buildAttention } from './attention';

const UUID = '7a1b2c3d-0000-4000-8000-000000000001';

const incident = (id: string, severity: ObsIncident['severity'], minutesAgo: number, type: ObsIncident['type'] = 'deployment') =>
  ({
    id: `${type}/${id}`,
    type,
    severity,
    status: 'failed',
    summary: `${id} ${severity}`,
    resource_id: id,
    resource_name: 'checkout-api',
    observed_at: new Date(Date.parse('2026-11-01T12:00:00Z') - minutesAgo * 60_000).toISOString(),
    dedupe_key: id,
  }) as ObsIncident;

const inbox = (items: ObsIncident[], unavailable: string[] = []) =>
  ({ items, unavailable_sources: unavailable, generated_at: '', limit: 200, since: '', since_clamped: false, next_cursor: '' }) as ObsIncidentListResponse;

const alerts = (counts: ObsAlertWorkloadSummary['counts']) => ({ counts }) as ObsAlertWorkloadSummary;

describe('buildAttention', () => {
  it('says all clear only when every source answered and nothing is wrong', () => {
    const report = buildAttention({ incidents: inbox([]), alerts: alerts({ total: 0, firing: 0, unknown: 0, resolved: 0, needs_attention: 0 }), nodes: [] });
    expect(report.headline).toEqual({ tone: 'ok', text: 'All clear' });
    expect(report.items).toEqual([]);
  });

  it('never says all clear when a source is missing or incomplete', () => {
    const report = buildAttention({ incidents: inbox([], ['prometheus']), alerts: alerts(null), nodes: new Error('timed out') });
    expect(report.headline.tone).toBe('unknown');
    expect(report.unknown).toEqual([
      'Incident source prometheus is unavailable',
      'Platform alerts have not been collected yet',
      'Node heartbeats: timed out',
    ]);
  });

  it('lists the operator’s failed actions first, then incidents by severity and recency', () => {
    const report = buildAttention({
      intents: [
        { intentId: 'i1', kind: 'force_park', target: 'checkout-api · c0ffee00…', status: 'failed' },
        { intentId: 'i2', kind: 'node_drain', target: 'node-a', status: 'running' },
      ],
      incidents: inbox([incident('w', 'warning', 1), incident('e-old', 'error', 30), incident('c', 'critical', 60), incident('e-new', 'error', 5)]),
    });
    expect(report.items.map((item) => item.title)).toEqual(['Your force park failed', 'c critical', 'e-new error', 'e-old error', 'w warning']);
    expect(report.items[1]).toMatchObject({ tone: 'danger', detail: 'Deployment · checkout-api', href: '/incidents?incident=deployment%2Fc' });
    expect(report.items[4].tone).toBe('warning');
    expect(report.headline).toEqual({ tone: 'danger', text: '5 things need attention' });
  });

  it('caps the incident rows but keeps counting them', () => {
    const many = Array.from({ length: 12 }, (_, i) => incident(`${UUID}-${i}`, 'error', i));
    const report = buildAttention({ incidents: inbox(many) }, 8);
    expect(report.items).toHaveLength(8);
    expect(report.incidentCount).toBe(12);
    expect(report.headline.text).toBe('12 things need attention');
  });

  it('flags alerts needing an owner and active nodes with stale heartbeats', () => {
    const report = buildAttention({
      alerts: alerts({ total: 4, firing: 0, unknown: 1, resolved: 1, needs_attention: 2 }),
      nodes: [
        { name: 'node-a', active: true, stale: true, last_heartbeat_at: '2026-11-01T11:50:00Z' },
        { name: 'node-c', active: false, stale: true },
      ],
    });
    expect(report.items.map((item) => [item.title, item.tone, item.href])).toEqual([
      ['2 platform alerts need an owner or acknowledgment', 'warning', '/incidents?type=platform_alert&ack=unacknowledged'],
      ['node-a has a stale heartbeat', 'warning', '/nodes?node=node-a'],
    ]);
    expect(report.headline).toEqual({ tone: 'warning', text: '2 warnings to look at' });
  });
});
