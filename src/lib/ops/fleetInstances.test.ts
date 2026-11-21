import { describe, expect, it } from 'vitest';
import type { ObsInvocationRow } from '@/lib/api';
import { instanceListQuery, invocationsOnInstance, wakePhases } from './fleetInstances';

describe('instanceListQuery', () => {
  it('sends only the filters apid accepts', () => {
    expect(instanceListQuery({})).toBe('');
    expect(instanceListQuery({ state: 'running' })).toBe('');
    expect(instanceListQuery({ state: 'resident', node: 'bhs-2', appId: 'a', accountId: 'b', limit: 5000 })).toBe(
      '?state=resident&node=bhs-2&app_id=a&account_id=b&limit=1000',
    );
  });
});

describe('invocationsOnInstance', () => {
  it('keeps the invocations the instance ran', () => {
    const inv = (id: string, instance?: string) => ({ id, instance_id: instance }) as ObsInvocationRow;
    expect(invocationsOnInstance([inv('a', 'i1'), inv('b', 'i2'), inv('c')], 'i1').map((r) => r.id)).toEqual(['a']);
  });
});

describe('wakePhases', () => {
  it('measures each event from the first', () => {
    const phases = wakePhases([
      { at: '2026-11-21T10:00:00.000Z', kind: 'wake.requested' },
      { at: '2026-11-21T10:00:00.212Z', kind: 'wake.ready' },
    ]);
    expect(phases.map((p) => [p.kind, p.offsetMs])).toEqual([
      ['wake.requested', 0],
      ['wake.ready', 212],
    ]);
  });
});
