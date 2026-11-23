import { describe, expect, it } from 'vitest';
import { eventLabel, gradedMB, isMemoryWindow, memoryWindowLabel, nodeStateTone, pctOf } from './memoryPressure';

describe('memory pressure helpers', () => {
  it('validates and labels windows', () => {
    expect(isMemoryWindow('24h')).toBe(true);
    expect(isMemoryWindow('2d')).toBe(false);
    expect(memoryWindowLabel('72h')).toBe('3d');
  });

  it('grades node states and shares of the ceiling', () => {
    expect(nodeStateTone('over')).toBe('danger');
    expect(nodeStateTone('stale')).toBe('warning');
    expect(nodeStateTone('ok')).toBe('success');
    expect(nodeStateTone('unmeasured')).toBe('neutral');
    expect(pctOf(48100, 47600)).toBe(101);
    expect(pctOf(undefined, 47600)).toBeNull();
    expect(pctOf(100, 0)).toBeNull();
    expect(gradedMB({ used_mb: 49000, measured_mb: 40000 })).toBe(49000);
    expect(gradedMB({ measured_mb: 40000 })).toBe(40000);
    expect(gradedMB({})).toBeUndefined();
  });

  it('names events', () => {
    expect(eventLabel({ kind: 'oom_kill' })).toBe('OOM kill');
    expect(eventLabel({ kind: 'frozen_park', reason: 'memory_pressure' })).toBe('Frozen VM parked');
    expect(eventLabel({ kind: 'eviction', reason: 'measured_memory' })).toBe('Evicted: measured memory');
    expect(eventLabel({ kind: 'eviction', reason: 'ram_pressure' })).toBe('Evicted: reservations');
  });
});
