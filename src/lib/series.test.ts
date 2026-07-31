/* ==========================================================================
   Tests for the chart maths.

   These functions matter more than their size suggests: a wrong percentile or
   an off-by-one bucket doesn't throw, it renders a plausible-looking chart.
   That is the failure mode worth pinning — every case here is one where a
   plain-looking implementation gives a believable but wrong answer.
   ========================================================================== */

import { describe, it, expect } from 'vitest';
import {
  invocationsByDay, failuresByDay, totals, rollupByApp, trend, compact, ms,
} from './series';
import type { Invocation, App, AppUsage } from './api';

const DAY = 86_400_000;

/** Minimal invocation row; only the fields the maths reads are meaningful. */
function inv(over: Partial<Invocation> = {}): Invocation {
  return {
    id: Math.random().toString(16).slice(2),
    app_id: 'app1',
    account_id: 'acct',
    source: 'queue',
    state: 'completed',
    created_at: new Date().toISOString(),
    ...over,
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

describe('invocationsByDay', () => {
  it('returns exactly one bucket per requested day, oldest first', () => {
    const points = invocationsByDay([], 7);
    expect(points).toHaveLength(7);
    const times = points.map((p) => p.date.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('counts a row into the day it was created', () => {
    const points = invocationsByDay([inv({ created_at: daysAgo(2) })], 7);
    // 7 buckets, today last → two days ago is index 4.
    expect(points[4].value).toBe(1);
    expect(points.reduce((s, p) => s + p.value, 0)).toBe(1);
  });

  it('drops rows outside the window instead of clamping them into the edge bucket', () => {
    const points = invocationsByDay([inv({ created_at: daysAgo(30) })], 7);
    expect(points.reduce((s, p) => s + p.value, 0)).toBe(0);
  });

  it('ignores rows with an unparseable timestamp rather than counting them as epoch', () => {
    const points = invocationsByDay([inv({ created_at: 'not-a-date' })], 7);
    expect(points.reduce((s, p) => s + p.value, 0)).toBe(0);
  });

  it('keeps empty days as zero so the x-axis stays evenly spaced', () => {
    const points = invocationsByDay([inv({ created_at: daysAgo(0) })], 5);
    expect(points.filter((p) => p.value === 0)).toHaveLength(4);
  });
});

describe('failuresByDay', () => {
  it('counts only failed rows', () => {
    const rows = [
      inv({ state: 'failed', created_at: daysAgo(1) }),
      inv({ state: 'completed', created_at: daysAgo(1) }),
      inv({ state: 'cancelled', created_at: daysAgo(1) }),
    ];
    expect(failuresByDay(rows, 7).reduce((s, p) => s + p.value, 0)).toBe(1);
  });
});

describe('totals', () => {
  it('excludes cancelled rows from the error-rate denominator', () => {
    const rows = [
      inv({ state: 'completed' }),
      inv({ state: 'failed' }),
      inv({ state: 'cancelled' }),
    ];
    // 1 failed of 2 that actually ran — cancelled work never got a verdict,
    // so counting it would let a burst of cancellations read as improvement.
    expect(totals(rows).errorRatePct).toBe(50);
  });

  it('matches the "N failed of M finished" denominator the UI prints', () => {
    const rows = [
      inv({ state: 'completed' }),
      inv({ state: 'failed' }),
      inv({ state: 'cancelled' }),
      inv({ state: 'pending' }),
    ];
    const t = totals(rows);
    const labelDenominator = t.completed + t.failed;
    expect(t.errorRatePct).toBeCloseTo((t.failed / labelDenominator) * 100, 10);
  });

  it('reports a zero error rate when nothing has finished, not NaN', () => {
    const t = totals([inv({ state: 'pending' }), inv({ state: 'dispatching' })]);
    expect(t.errorRatePct).toBe(0);
    expect(t.pending).toBe(2);
  });

  it('returns null durations when no row has completed', () => {
    const t = totals([inv({ state: 'pending' })]);
    expect(t.avgCompletionMs).toBeNull();
    expect(t.p95CompletionMs).toBeNull();
  });

  it('averages only completed rows that carry a completed_at', () => {
    const base = new Date('2026-07-01T00:00:00Z').getTime();
    const rows = [
      inv({
        state: 'completed',
        created_at: new Date(base).toISOString(),
        completed_at: new Date(base + 100).toISOString(),
      }),
      inv({
        state: 'completed',
        created_at: new Date(base).toISOString(),
        completed_at: new Date(base + 300).toISOString(),
      }),
      // Completed but missing completed_at — must not be read as 0ms, which
      // would drag the mean down.
      inv({ state: 'completed', created_at: new Date(base).toISOString() }),
    ];
    expect(totals(rows).avgCompletionMs).toBe(200);
  });

  it('discards negative durations from clock skew rather than averaging them in', () => {
    const base = new Date('2026-07-01T00:00:00Z').getTime();
    const rows = [
      inv({
        state: 'completed',
        created_at: new Date(base).toISOString(),
        completed_at: new Date(base - 5_000).toISOString(),
      }),
      inv({
        state: 'completed',
        created_at: new Date(base).toISOString(),
        completed_at: new Date(base + 100).toISOString(),
      }),
    ];
    expect(totals(rows).avgCompletionMs).toBe(100);
  });

  it('picks a p95 that is a real observation and never exceeds the maximum', () => {
    const base = new Date('2026-07-01T00:00:00Z').getTime();
    const rows = Array.from({ length: 100 }, (_, i) =>
      inv({
        state: 'completed',
        created_at: new Date(base).toISOString(),
        completed_at: new Date(base + (i + 1)).toISOString(),
      }),
    );
    const t = totals(rows);
    expect(t.p95CompletionMs).toBeGreaterThanOrEqual(t.avgCompletionMs!);
    expect(t.p95CompletionMs).toBeLessThanOrEqual(100);
  });

  it('does not index past the end of a single-sample set', () => {
    const base = Date.now();
    const t = totals([
      inv({
        state: 'completed',
        created_at: new Date(base).toISOString(),
        completed_at: new Date(base + 42).toISOString(),
      }),
    ]);
    expect(t.p95CompletionMs).toBe(42);
  });
});

describe('rollupByApp', () => {
  const apps = [
    { id: 'a1', slug: 'alpha' },
    { id: 'a2', slug: 'beta' },
  ] as App[];

  it('keeps apps with no activity, reporting zeroes rather than dropping them', () => {
    const out = rollupByApp(apps, [inv({ app_id: 'a1' })]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.slug === 'beta')!.invocations).toBe(0);
  });

  it('reports null — not zero — for metered fields when usage is absent', () => {
    const out = rollupByApp(apps, []);
    expect(out[0].requests).toBeNull();
    expect(out[0].usedGbHours).toBeNull();
  });

  it('derives GB-hours from mb_seconds when used_gb_hours is missing', () => {
    const usage = [{ app_id: 'a1', mb_seconds: 1024 * 3600, requests: 5, included_gb_hours: 50 }] as AppUsage[];
    const row = rollupByApp(apps, [], usage).find((r) => r.slug === 'alpha')!;
    expect(row.usedGbHours).toBeCloseTo(1, 6);
  });

  it('ranks by metered requests when available, falling back to invocation count', () => {
    const usage = [
      { app_id: 'a1', mb_seconds: 0, requests: 1, included_gb_hours: 50 },
      { app_id: 'a2', mb_seconds: 0, requests: 99, included_gb_hours: 50 },
    ] as AppUsage[];
    expect(rollupByApp(apps, [], usage)[0].slug).toBe('beta');
  });
});

describe('trend', () => {
  it('returns null when the earlier half is empty, since growth from zero is not a percentage', () => {
    const points = [0, 0, 5, 5].map((v, i) => ({ date: new Date(i), label: `${i}`, value: v }));
    expect(trend(points)).toBeNull();
  });

  it('returns null for a series too short to split', () => {
    expect(trend([{ date: new Date(), label: 'a', value: 1 }])).toBeNull();
  });

  it('reports direction and magnitude of a doubling', () => {
    const points = [5, 5, 10, 10].map((v, i) => ({ date: new Date(i), label: `${i}`, value: v }));
    const t = trend(points)!;
    expect(t.direction).toBe('up');
    expect(t.pct).toBeCloseTo(100, 5);
  });

  it('calls a flat series flat rather than up by 0%', () => {
    const points = [7, 7, 7, 7].map((v, i) => ({ date: new Date(i), label: `${i}`, value: v }));
    expect(trend(points)!.direction).toBe('flat');
  });
});

describe('formatters', () => {
  it('compacts only at or above a thousand', () => {
    expect(compact(999)).toBe('999');
    expect(compact(24_800_000)).toMatch(/24\.8M/);
  });

  it('renders a dash for a missing duration instead of 0ms', () => {
    expect(ms(null)).toBe('—');
  });

  it('switches units at the second and minute boundaries', () => {
    expect(ms(999)).toBe('999ms');
    expect(ms(1_500)).toMatch(/s$/);
    expect(ms(120_000)).toBe('2m');
  });
});
