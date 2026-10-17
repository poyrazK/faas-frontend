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
  it('separates strict commitments from invoice costs and retains a manual hold', () => {
    const html = renderToStaticMarkup(<BudgetHealth policy={{ ...policy, enforcement_ready: true, notification_ready: false,
      spec: { ...policy.spec, scope: { kind: 'app', id: 'app' }, basis: 'gross_usage', mode: 'strict', action: 'suspend_workloads', notify_millicents: [], resume_rule: 'manual' },
      runtime: { alerts: [], compute: { initialized: true, app_id: 'app', period_start: '2026-10-01T00:00:00Z', period_end: '2026-11-01T00:00:00Z', committed_millicents: 100000, reserved_millicents: 200000, remaining_millicents: 700000, unconfirmed_leases: 2, held: true, observed_at: '2026-10-17T10:00:00Z' } } }} />);
    expect(html).toContain('Strict app compute budget active');
    expect(html).toContain('Committed compute: €1.00');
    expect(html).toContain('Reserved: €2.00');
    expect(html).toContain('Remaining: €7.00');
    expect(html).toContain('2 active or unsettled VM attempts');
    expect(html).toContain('Change or disable this policy');
    expect(html).toContain('can exceed the compute charge on your bill');
    expect(html).not.toContain('Spending alerts active');
    expect(html).not.toContain('Awaiting the first evaluation');
  });
  it('keeps a latched manual stop visible before the new month has an evaluation', () => {
    const html = renderToStaticMarkup(<BudgetHealth policy={{ ...policy, enforcement_ready: true,
      spec: { ...policy.spec, action: 'stop_previews', resume_rule: 'manual' },
      runtime: { alerts: [], stops: [{ id: 'stop', policy_id: 'budget', revision: 1, period_start: '2026-09-01T00:00:00Z', period_end: '2026-10-01T00:00:00Z', requested_at: '2026-09-20T10:00:00Z', drain_deadline: '2026-09-20T10:00:30Z', resume_rule: 'manual', evaluation: { period_start: '2026-09-01T00:00:00Z', period_end: '2026-10-01T00:00:00Z', as_of: '2026-09-20T10:00:00Z', evaluated_at: '2026-09-20T10:00:00Z', evidence_through_id: 1, coverage_complete: true, fresh: true, reasons: [] }, targets: [] }] } }} />);
    expect(html).toContain('Preview stopping active');
    expect(html).toContain('Production can continue');
    expect(html).toContain('Awaiting scheduler acknowledgement');
    expect(html).toContain('Stopping is not yet confirmed');
    expect(html).toContain('Disable or change this policy');
    expect(html).not.toContain('Workloads continue running');
  });
  it('does not show a failed shutdown as a stopped preview', () => {
    const html = renderToStaticMarkup(<BudgetHealth policy={{ ...policy, spec: { ...policy.spec, action: 'stop_previews' }, runtime: { alerts: [], stops: [{ id: 'stop', policy_id: 'budget', revision: 1, period_start: '2026-10-01T00:00:00Z', period_end: '2026-11-01T00:00:00Z', requested_at: '2026-10-16T10:00:00Z', drain_deadline: '2026-10-16T10:00:30Z', resume_rule: 'next_period', evaluation: { period_start: '2026-10-01T00:00:00Z', period_end: '2026-11-01T00:00:00Z', as_of: '2026-10-16T10:00:00Z', evaluated_at: '2026-10-16T10:00:00Z', evidence_through_id: 1, coverage_complete: true, fresh: true, reasons: [] }, targets: [{ app_id: 'preview', state: 'failed', resident_count: 1, observed_at: '2026-10-16T10:01:00Z', last_error: 'vm_teardown_failed' }] }] } }} />);
    expect(html).toContain('preview: failed');
    expect(html).toContain('1 resident instances');
    expect(html).toContain('Shutdown could not be confirmed');
    expect(html).not.toContain('preview: Stopped');
  });
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
