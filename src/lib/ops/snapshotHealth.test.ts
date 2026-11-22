import { describe, expect, it } from 'vitest';
import { cpuLabel, footprintTone, formatMB } from './snapshotHealth';

const lines = { target_mb: 130, warn_mb: 160, page_mb: 200 };
const MB = 1024 * 1024;

describe('footprintTone', () => {
  it('grades a footprint against the target, warn and page lines', () => {
    expect(footprintTone(130 * MB, lines)).toBe('success');
    expect(footprintTone(150 * MB, lines)).toBe('neutral');
    expect(footprintTone(200 * MB, lines)).toBe('warning');
    expect(footprintTone(201 * MB, lines)).toBe('danger');
  });
});

describe('formatMB and cpuLabel', () => {
  it('formats sizes in whole MB and CPU keys readably', () => {
    expect(formatMB(140 * MB + 300_000)).toBe('140 MB');
    expect(cpuLabel('T2CL/icelake')).toBe('T2CL · icelake');
    expect(cpuLabel('/icelake')).toBe('icelake');
    expect(cpuLabel('unpinned')).toBe('unpinned');
  });
});
