import { describe, expect, it } from 'vitest';
import { buildQueueQuery, cacheHitRate, failureLabel, isBuildQueueWindow, slotSummary, waitTone, windowLabel, type ObsBuilderNodeSlots } from './buildQueue';

const node = (o: Partial<ObsBuilderNodeSlots>): ObsBuilderNodeSlots => ({
  node: 'fsn-2', running_builds: 0, observed: true, conflicting: false, limit: 2, reserved: 1, in_use: 0, active_reserved: 0, opportunistic: 0, active_borrowed: 0, ...o,
});

describe('build queue helpers', () => {
  it('validates and labels windows', () => {
    expect(isBuildQueueWindow('24h')).toBe(true);
    expect(isBuildQueueWindow('30d')).toBe(false);
    expect(isBuildQueueWindow(null)).toBe(false);
    expect(windowLabel('168h')).toBe('7d');
    expect(buildQueueQuery('6h')).toBe('?window=6h');
  });

  it('names failure classes and the cache hit rate', () => {
    expect(failureLabel('oom')).toBe('Out of memory');
    expect(failureLabel('unclassified')).toBe('Unclassified');
    expect(cacheHitRate({ cache_hits: 3, cache_misses: 1, cache_invalidated: 0 })).toBe(0.75);
    expect(cacheHitRate({ cache_hits: 0, cache_misses: 0, cache_invalidated: 0 })).toBeNull();
  });

  it('grades waits against the warn line', () => {
    expect(waitTone(60, 300)).toBe('neutral');
    expect(waitTone(301, 300)).toBe('warning');
    expect(waitTone(901, 300)).toBe('danger');
  });

  it('summarises slot use per node', () => {
    expect(slotSummary(node({ active_reserved: 2, opportunistic: 1, active_borrowed: 1 }))).toBe('1/1 reserved · 1 opportunistic · 1 borrowed');
    expect(slotSummary(node({}))).toBe('0/1 reserved');
    expect(slotSummary(node({ observed: false }))).toBe('no slot data');
    expect(slotSummary(node({ observed: false, conflicting: true }))).toBe('conflicting builderd reports');
  });
});
