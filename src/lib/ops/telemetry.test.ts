import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RETAINED_WINDOWS,
  collectionHistoryPath,
  coverageAnswers,
  coverageShares,
  formatSeconds,
  getCollectionHistory,
  getInputHealth,
  getNotificationHealth,
  getRecordingCoverage,
  getRuleCoverage,
  getRuleHealth,
  healthMetric,
  humanize,
  inputHealthAnswers,
  stateTone,
  windowSince,
  type ObsAlertCollectionCoverage,
  type ObsHealthDetail,
} from './telemetry';

let urls: string[];

beforeEach(() => {
  urls = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('telemetry request shapes', () => {
  it('sends no query string where the handler accepts none', async () => {
    await getNotificationHealth();
    await getRuleHealth();
    expect(urls).toEqual(['/v1/admin/obs/notification-health', '/v1/admin/obs/rule-health']);
  });

  it('sends an explicit selection only when one was made (empty values are rejected)', async () => {
    await getRuleCoverage();
    await getRuleCoverage('');
    await getRuleCoverage('platform-alerts-v1');
    await getRecordingCoverage('platform recording');
    await getInputHealth('');
    await getInputHealth('control-plane-v1');
    expect(urls).toEqual([
      '/v1/admin/obs/rule-coverage',
      '/v1/admin/obs/rule-coverage',
      '/v1/admin/obs/rule-coverage?expected_set=platform-alerts-v1',
      '/v1/admin/obs/recording-coverage?expected_set=platform+recording',
      '/v1/admin/obs/input-health',
      '/v1/admin/obs/input-health?expected_role=control-plane-v1',
    ]);
  });

  it('builds collection-history queries from nonempty since and details=true only', async () => {
    expect(collectionHistoryPath()).toBe('/v1/admin/obs/collection-history');
    expect(collectionHistoryPath({ details: false })).toBe('/v1/admin/obs/collection-history');
    expect(collectionHistoryPath({ since: '', details: true })).toBe('/v1/admin/obs/collection-history?details=true');
    await getCollectionHistory({ since: '2026-10-29T00:00:00Z', details: true });
    expect(urls[0]).toBe('/v1/admin/obs/collection-history?since=2026-10-29T00%3A00%3A00Z&details=true');
  });

  it('keeps the longest retained window inside the 30-day server bound', () => {
    const now = Date.UTC(2026, 9, 30, 12, 0, 0, 999);
    expect(windowSince(0, now)).toBeUndefined();
    expect(windowSince(24, now)).toBe('2026-10-29T12:00:00Z');
    const longest = Math.max(...RETAINED_WINDOWS.map((w) => w.hours));
    expect(now - Date.parse(windowSince(longest, now)!)).toBeLessThan(30 * 24 * 3_600_000);
  });
});

describe('selection echoes', () => {
  it('matches coverage responses to the selection they answer', () => {
    expect(coverageAnswers({ selection_source: 'none', expected_set: null }, '')).toBe(true);
    expect(coverageAnswers({ selection_source: 'none', expected_set: null }, 'set-a')).toBe(false);
    const setA = { id: 'set-a', revision: '1', files: [], expected_rules: 3 };
    expect(coverageAnswers({ selection_source: 'explicit_request', expected_set: setA }, 'set-a')).toBe(true);
    expect(coverageAnswers({ selection_source: 'explicit_request', expected_set: setA }, 'set-b')).toBe(false);
    // expected_set_unavailable: selected but absent from the loaded catalog.
    expect(coverageAnswers({ selection_source: 'explicit_request', expected_set: null }, 'set-b')).toBe(true);
    expect(inputHealthAnswers({ expected_role: '' }, '')).toBe(true);
    expect(inputHealthAnswers({ expected_role: 'single-box-v1' }, 'control-plane-v1')).toBe(false);
  });
});

describe('obs health metrics', () => {
  const health: ObsHealthDetail = {
    generated_at: '2026-10-30T12:00:00Z',
    prometheus_available: true,
    audit_log_write_total_5m: 0,
    audit_log_write_failures_5m: 0,
    audit_log_coverage_ratio_5m: 1,
    operator_intent_outcome_missing_total: {},
    trace_id_completeness_ratio: {},
    alerts_firing: 0,
  };

  it('uses a number only when its signal is healthy', () => {
    const withSignals: ObsHealthDetail = {
      ...health,
      signals: {
        alerts_firing: { state: 'healthy', window_seconds: 300, max_age_seconds: 120 },
        audit_log_write_total_5m: { state: 'stale', reason: 'observation_stale', window_seconds: 300, max_age_seconds: 120 },
      },
    };
    expect(healthMetric(withSignals, 'alerts_firing').value).toBe(0);
    expect(healthMetric(withSignals, 'audit_log_write_total_5m')).toMatchObject({ value: null, reason: 'observation stale' });
  });

  it('falls back to prometheus_available for legacy responses', () => {
    expect(healthMetric(health, 'audit_log_write_failures_5m').value).toBe(0);
    expect(healthMetric({ ...health, prometheus_available: false }, 'audit_log_write_failures_5m')).toMatchObject({ value: null });
  });
});

describe('presentation helpers', () => {
  it('never renders missing evidence as healthy', () => {
    for (const state of ['unknown', 'unavailable', 'no_samples', 'stale', 'partial', 'never_collected', undefined]) {
      expect(stateTone(state)).toBe('warning');
    }
    expect(stateTone('healthy')).toBe('success');
    expect(stateTone('degraded')).toBe('danger');
    expect(stateTone('disabled')).toBe('neutral');
  });

  it('splits a coverage window and treats an empty window as unknown', () => {
    const coverage = {
      window_microseconds: 1000,
      successful_observation_microseconds: 700,
      failed_observation_microseconds: 100,
      unknown_microseconds: 200,
    } as ObsAlertCollectionCoverage;
    expect(coverageShares(coverage)).toEqual({ success: 0.7, failed: 0.1, unknown: 0.2 });
    expect(coverageShares({ ...coverage, window_microseconds: 0 })).toEqual({ success: 0, failed: 0, unknown: 1 });
  });

  it('formats durations and codes', () => {
    expect(formatSeconds(null)).toBe('—');
    expect(formatSeconds(45)).toBe('45s');
    expect(formatSeconds(725)).toBe('12m 5s');
    expect(formatSeconds(3 * 3600 + 20 * 60)).toBe('3h 20m');
    expect(formatSeconds(2 * 86400 + 4 * 3600)).toBe('2d 4h');
    expect(humanize('expected_set_not_selected')).toBe('expected set not selected');
  });
});
