import { describe, expect, it } from 'vitest';
import { diskStateLabel, diskStateTone, formatHoursToFull, roleLabel } from './diskPressure';

describe('disk pressure helpers', () => {
  it('grades and names states', () => {
    expect(diskStateTone('critical')).toBe('danger');
    expect(diskStateTone('filling')).toBe('danger');
    expect(diskStateTone('inodes_low')).toBe('warning');
    expect(diskStateTone('ok')).toBe('success');
    expect(diskStateTone('new_state')).toBe('neutral');
    expect(diskStateLabel('filling')).toBe('Filling fast');
    expect(diskStateLabel('new_state')).toBe('new_state');
    expect(roleLabel('control_plane')).toBe('Control plane');
  });

  it('formats hours to full', () => {
    expect(formatHoursToFull(undefined)).toBe('—');
    expect(formatHoursToFull(0.25)).toBe('15 min');
    expect(formatHoursToFull(0.001)).toBe('1 min');
    expect(formatHoursToFull(2.5)).toBe('2.5 h');
    expect(formatHoursToFull(100)).toBe('4.2 d');
  });
});
