import { describe, expect, it } from 'vitest';
import { buildTimeline, groupByDay, humanizeKind } from './timeline';
import type { ObsIncident } from './incidents';
import type { OperatorDeployment } from './workloads';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const OTHER = '66666666-7777-4888-8999-aaaaaaaaaaaa';

const deployment = (id: string, status: string, at: string): OperatorDeployment => ({
  id,
  app_id: 'app-1',
  app_slug: 'checkout-api',
  app_status: 'active',
  account_id: ACCOUNT,
  kind: 'git',
  status,
  source_bytes: 1,
  priority: 0,
  created_at: at,
  ...(status === 'failed' ? { error_code: 'build_failed', error: 'npm ERR!' } : {}),
});

const incident = (id: string, account: string | undefined, at: string): ObsIncident => ({
  id,
  type: 'deployment',
  severity: 'error',
  status: 'open',
  summary: `incident ${id}`,
  account_id: account,
  resource_id: 'dep-1',
  observed_at: at,
  dedupe_key: id,
});

describe('buildTimeline', () => {
  it('merges every source newest first', () => {
    const entries = buildTimeline(ACCOUNT, {
      operatorActions: [{ id: 'a1', kind: 'operator.action.account.suspend', received_at: '2026-10-30T10:00:00Z', actor: 'op@x' }],
      accountEvents: [{ id: 'a2', kind: 'deploy.succeeded', at: '2026-10-30T09:00:00Z' }],
      deployments: [deployment('d1', 'failed', '2026-10-30T11:00:00Z')],
      incidents: [incident('i1', ACCOUNT, '2026-10-30T12:00:00Z')],
      invocations: [
        { id: 'v1', app_id: 'app-1', app_slug: 'checkout-api', state: 'failed', source: 'http', method: 'POST', path: '/orders', outcome: 'error_5xx', attempts: 1, created_at: '2026-10-30T08:00:00Z' },
      ],
    });
    expect(entries.map((e) => e.kind)).toEqual(['incident', 'deployment', 'operator', 'audit', 'invocation']);
    expect(entries[1]).toMatchObject({ tone: 'danger', href: '/deployments?deployment=d1' });
    expect(entries[2]).toMatchObject({ title: 'Account suspend', tone: 'warning', actor: 'op@x' });
    expect(entries[4].tone).toBe('danger');
  });

  it('shows an audit row present in both audit sources once, as an operator action', () => {
    const entries = buildTimeline(ACCOUNT, {
      operatorActions: [{ id: 'same', kind: 'operator.action.account.credit', received_at: '2026-10-30T10:00:00Z' }],
      accountEvents: [{ id: 'same', kind: 'operator.action.account.credit', at: '2026-10-30T10:00:00Z' }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('operator');
  });

  it('keeps only incidents that name this account and drops unparseable times', () => {
    const entries = buildTimeline(ACCOUNT, {
      incidents: [incident('mine', ACCOUNT, '2026-10-30T12:00:00Z'), incident('theirs', OTHER, '2026-10-30T12:00:00Z'), incident('fleet', undefined, '2026-10-30T12:00:00Z')],
      accountEvents: [{ id: 'bad', kind: 'x', at: 'not-a-date' }],
    });
    expect(entries.map((e) => e.key)).toEqual(['incident:mine']);
  });

  it('is empty, not broken, when every source is missing', () => {
    expect(buildTimeline(ACCOUNT, {})).toEqual([]);
  });
});

describe('helpers', () => {
  it('humanizes audit kinds', () => {
    expect(humanizeKind('operator.action.account.revoke_sessions')).toBe('Account revoke sessions');
    expect(humanizeKind('deploy.succeeded')).toBe('Deploy succeeded');
  });

  it('groups entries by day, preserving order', () => {
    const entries = buildTimeline(ACCOUNT, {
      accountEvents: [
        { id: '1', kind: 'a', at: '2026-10-30T12:00:00Z' },
        { id: '2', kind: 'b', at: '2026-10-30T11:00:00Z' },
        { id: '3', kind: 'c', at: '2026-10-28T11:00:00Z' },
      ],
    });
    const groups = groupByDay(entries, 'en-GB');
    expect(groups).toHaveLength(2);
    expect(groups[0].entries.map((e) => e.key)).toEqual(['audit:1', 'audit:2']);
  });
});
