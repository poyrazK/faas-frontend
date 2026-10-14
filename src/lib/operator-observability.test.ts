import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  getObsOverview: () => ({ generated_at: '2026-10-14T12:00:00Z', totals: {}, node_health: [], recent_failures_1h: null, top_rate_limited_accounts_24h: null }),
  getObsHealth: () => ({ generated_at: '2026-10-14T12:00:00Z', prometheus_available: false, audit_log_write_total_5m: 0, audit_log_write_failures_5m: 0, audit_log_coverage_ratio_5m: 1, alerts_firing: 0, operator_intent_outcome_missing_total: {}, trace_id_completeness_ratio: {} }),
  getObsWakeLatencies: () => ({ window: '5m', prometheus_available: true, quantiles: [{ node_id: 'node-1', node_name: 'test-node', p50_ms: 100, p95_ms: 200, p99_ms: 300, sample_count: 10 }] }),
  getObsIncidents: () => ({ items: [{ id: 'job_run/failed', type: 'job_run', severity: 'error', summary: 'job run failed', resource_id: 'failed', observed_at: '2026-10-14T12:00:00Z' }], next_cursor: '', unavailable_sources: ['prometheus'] }),
  listObsNodes: () => ({ items: [] }),
  getObsBuilderHeartbeats: () => ({ items: [], queued_builds: 0 }),
  getObsAnomalies: () => ({ items: [] }),
  getObsRateLimits: () => ({ live: [], durable: [] }),
  listObsEvents: () => ({ items: [] }),
  searchObsAuditLog: () => ({ items: [] }),
  obsNodeEventsUrl: () => '/events',
}));

vi.mock('@/lib/useAsync', () => ({ useAsync: (fetcher: () => unknown) => ({ data: fetcher(), loading: false, error: null, reload: () => {}, setData: () => {}, stale: false, lastSuccessAt: Date.now() }) }));

import IncidentCenterPage from '@/app/operations/incidents/page';

describe('operator observability contracts', () => {
  it('renders legacy null summaries, the canonical wake response, and unavailable telemetry honestly', () => {
    const html = renderToStaticMarkup(React.createElement(IncidentCenterPage));
    expect(html).toContain('Telemetry unavailable');
    expect(html).toContain('Prometheus could not be queried');
    expect(html).toContain('test-node');
    expect(html).toContain('10 samples');
    expect(html).toContain('five-minute');
    expect(html).toContain('job run failed');
    expect(html).toContain('Incomplete snapshot: prometheus is unavailable');
    expect(html).not.toContain('No wake latency samples');
  });
});
