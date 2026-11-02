import { describe, expect, it } from 'vitest';
import { hasDeploymentInFlight, hasJobRunInFlight, splitOperatorViews, viewCount } from './auditedReads';
import type { OperatorDeployment, OperatorJobRun } from './workloads';

const deployment = (status: string) => ({ status }) as OperatorDeployment;
const run = (aggregate_status: string) => ({ aggregate_status }) as OperatorJobRun;

describe('audited reads', () => {
  it('polls a list only while it shows work in flight', () => {
    expect(hasDeploymentInFlight([deployment('failed'), deployment('building')])).toBe(true);
    expect(hasDeploymentInFlight([deployment('failed'), deployment('live'), deployment('cancelled')])).toBe(false);
    expect(hasDeploymentInFlight(null)).toBe(false);
    expect(hasJobRunInFlight([run('succeeded'), run('queued')])).toBe(true);
    expect(hasJobRunInFlight([run('failed'), run('dead_letter')])).toBe(false);
    expect(hasJobRunInFlight(undefined)).toBe(false);
  });

  it('leaves operator views out of a list of actions, keeping order, and counts them', () => {
    const rows = [
      { id: '1', kind: 'operator.action.view' },
      { id: '2', kind: 'operator.action.node_drain' },
      { id: '3', kind: 'operator.action.view' },
      { id: '4', kind: 'operator.action.force_park.outcome' },
    ];
    expect(splitOperatorViews(rows)).toEqual({ others: [rows[1], rows[3]], views: 2 });
    expect(splitOperatorViews([])).toEqual({ others: [], views: 0 });
    expect(viewCount(1)).toBe('1 operator view');
    expect(viewCount(3)).toBe('3 operator views');
  });
});
