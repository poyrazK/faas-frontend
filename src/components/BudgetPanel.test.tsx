import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BudgetHealth } from './BudgetPanel';
import type { BudgetPolicy } from '@/lib/budgets';

const policy: BudgetPolicy = {
  id: 'budget', account_id: 'account', revision: 1, status: 'active',
  enforcement_ready: false, notification_ready: true, reasons: [],
  spec: { name: 'Compute', scope: { kind: 'account' }, currency: 'EUR', meters: ['compute'], basis: 'net_usage', limit_millicents: 1000000, notify_millicents: [800000], mode: 'monitored', action: 'notify', drain_seconds: 0, resume_rule: 'next_period', enabled: true },
};

describe('budget monitoring health', () => {
  it('does not present missing evaluation as zero spend or protection', () => {
    const html = renderToStaticMarkup(<BudgetHealth policy={policy} />);
    expect(html).toContain('Spending is not yet known');
    expect(html).toContain('Workloads continue running');
    expect(html).not.toContain('€0.00');
  });
  it('keeps unavailable cost, stale coverage and retry state visible', () => {
    const evaluation = { period_start: '2026-10-01T00:00:00Z', period_end: '2026-11-01T00:00:00Z', as_of: '2026-10-16T10:00:00Z', evaluated_at: '2026-10-16T10:01:00Z', evidence_through_id: 0, coverage_complete: false, fresh: false, reasons: ['cost_evaluation_unavailable'] };
    const html = renderToStaticMarkup(<BudgetHealth policy={{ ...policy, runtime: { evaluation, alerts: [{ id: 'alert', policy_revision: 1, threshold_millicents: 800000, evaluation, state: 'retrying', attempts: 2, next_attempt_at: '2026-10-16T10:05:00Z' }] } }} />);
    expect(html).toContain('Known spending: Unavailable');
    expect(html).toContain('Cost coverage is partial');
    expect(html).toContain('stale or unavailable');
    expect(html).toContain('retrying');
    expect(html).toContain('next attempt');
  });
});
