import { describe, expect, it } from 'vitest';
import { instanceActionAllowed, instanceActionBlocked } from './instances';

describe('instance recovery eligibility', () => {
  it('mirrors apid: park running, waking or cold-booting instances; restart only running ones', () => {
    for (const state of ['running', 'waking', 'cold_booting', 'RUNNING']) expect(instanceActionAllowed('force_park', state)).toBe(true);
    for (const state of ['parked', 'snapshotting', 'stopped', 'failed', 'migrating', '']) expect(instanceActionAllowed('force_park', state)).toBe(false);
    expect(instanceActionAllowed('force_restart', 'running')).toBe(true);
    expect(instanceActionAllowed('force_restart', 'waking')).toBe(false);
  });

  it('explains why an action is unavailable', () => {
    expect(instanceActionBlocked('force_park', 'running')).toBeNull();
    expect(instanceActionBlocked('force_park', 'parked')).toBe(
      'Force park needs a running, waking or cold booting instance; this one is parked.',
    );
    expect(instanceActionBlocked('force_restart', 'cold_booting')).toBe(
      'Force restart needs a running instance; this one is cold booting.',
    );
  });
});
