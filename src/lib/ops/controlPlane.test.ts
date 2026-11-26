import { describe, expect, it } from 'vitest';
import { checksOf, cpStateLabel, cpStateTone, formatSeconds, formatThreshold, type ObsControlPlaneCheck, type ObsControlPlaneReport } from './controlPlane';

const check = (key: string, group: string, state: string, extra: Partial<ObsControlPlaneCheck> = {}): ObsControlPlaneCheck => ({
  key,
  group,
  label: key,
  state,
  unit: 'seconds',
  detail: '',
  ...extra,
});

describe('control-plane helpers', () => {
  it('grades and names states', () => {
    expect(cpStateTone('critical')).toBe('danger');
    expect(cpStateTone('warning')).toBe('warning');
    expect(cpStateTone('unknown')).toBe('warning');
    expect(cpStateTone('ok')).toBe('success');
    expect(cpStateTone('new')).toBe('neutral');
    expect(cpStateLabel('unknown')).toBe('Not reported');
    expect(cpStateLabel('new')).toBe('new');
  });

  it('formats seconds and thresholds', () => {
    expect(formatSeconds(undefined)).toBe('—');
    expect(formatSeconds(45)).toBe('45 s');
    expect(formatSeconds(600)).toBe('10 min');
    expect(formatSeconds(93600)).toBe('26 h');
    expect(formatSeconds(259200)).toBe('3 d');
    expect(formatThreshold(check('c', 'postgres', 'ok', { unit: 'percent', warn_at: 75, critical_at: 90 }))).toBe('warn > 75% · critical > 90%');
    expect(formatThreshold(check('t', 'postgres', 'ok', { warn_at: 600 }))).toBe('warn > 10 min');
    expect(formatThreshold(check('n', 'daemons', 'ok', { unit: 'count' }))).toBe('');
  });

  it('lists a group worst first, keeping report order', () => {
    const r = {
      checks: [check('a', 'postgres', 'ok'), check('b', 'backups', 'critical'), check('c', 'postgres', 'warning'), check('d', 'postgres', 'ok')],
    } as ObsControlPlaneReport;
    expect(checksOf(r, 'postgres').map((c) => c.key)).toEqual(['c', 'a', 'd']);
    expect(checksOf(r, 'delivery')).toEqual([]);
  });
});
