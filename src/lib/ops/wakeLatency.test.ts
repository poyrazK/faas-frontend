import { describe, expect, it } from 'vitest';
import {
  coldBootPct,
  formatMs,
  isWakeWindow,
  latencyTone,
  restoresWithinTargetPct,
  wakeLatencyQuery,
  type ObsWakeTotals,
} from './wakeLatency';

const totals = (t: Partial<ObsWakeTotals>): ObsWakeTotals => ({
  wakes: 0,
  restores: 0,
  cold_boots: 0,
  thaws: 0,
  failures: 0,
  fallbacks: 0,
  restores_over_target: 0,
  platform_refreshes: 0,
  ...t,
});

describe('wakeLatencyQuery', () => {
  it('leaves the default window out and sends the filters apid accepts', () => {
    expect(wakeLatencyQuery({})).toBe('');
    expect(wakeLatencyQuery({ window: '1h' })).toBe('');
    expect(wakeLatencyQuery({ window: '24h', node: 'fsn-2', appId: 'a' })).toBe('?window=24h&node=fsn-2&app_id=a');
  });
});

describe('isWakeWindow', () => {
  it('accepts only the offered windows', () => {
    expect(isWakeWindow('6h')).toBe(true);
    expect(isWakeWindow('48h')).toBe(false);
    expect(isWakeWindow(null)).toBe(false);
  });
});

describe('shares', () => {
  it('rounds the within-target share down so 99.9% never reads 100%', () => {
    expect(restoresWithinTargetPct(totals({ restores: 1000, restores_over_target: 1 }))).toBe(99);
    expect(restoresWithinTargetPct(totals({}))).toBeNull();
    expect(coldBootPct(totals({ wakes: 8, cold_boots: 1 }))).toBe(13);
    expect(coldBootPct(totals({}))).toBeNull();
  });
});

describe('formatMs and latencyTone', () => {
  it('formats and grades durations against the target', () => {
    expect(formatMs(212)).toBe('212 ms');
    expect(formatMs(2410)).toBe('2.41 s');
    expect(formatMs(12500)).toBe('12.5 s');
    expect(latencyTone(350, 350)).toBe('success');
    expect(latencyTone(700, 350)).toBe('warning');
    expect(latencyTone(701, 350)).toBe('danger');
  });
});
