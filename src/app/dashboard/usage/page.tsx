'use client';

import React, { useState } from 'react';
import { getUsageSummary, changePlan, Plan, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/bits';
import { AsyncBoundary } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { PLANS, euros } from '@/lib/format';

const ORDER: Plan[] = ['free', 'hobby', 'pro', 'scale'];

export default function UsagePage() {
  const usage = useAsync(getUsageSummary, []);
  const { account, refresh } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<Plan | null>(null);

  async function select(plan: Plan) {
    if (plan === account?.plan) return;
    setBusy(plan);
    try {
      await changePlan(plan);
      await refresh();
      toast.success(`Switched to ${PLANS[plan].label}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change plan.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Usage & billing" subtitle="Monthly GB-hour consumption and plan management." />

      <AsyncBoundary state={usage} skeleton={<div className="card h-40 animate-pulse" />}>
        {(u) => {
          const pct = u.included_gb_hours > 0 ? Math.min(100, Math.round((u.used_gb_hours / u.included_gb_hours) * 100)) : 0;
          return (
            <div className="card p-6">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-semibold">Included GB-hours · {u.month}</span>
                <span className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                  {u.used_gb_hours.toFixed(2)} / {u.included_gb_hours} GB-h
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-surface-subtle)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--color-warn)' : 'var(--color-brand)' }} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-xl font-bold">{u.used_gb_hours.toFixed(2)}</div>
                  <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>Used GB-h</div>
                </div>
                <div>
                  <div className="text-xl font-bold">{u.overage_gb_hours.toFixed(2)}</div>
                  <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>Overage GB-h</div>
                </div>
                <div>
                  <div className="text-xl font-bold" style={{ color: u.overage_cents > 0 ? 'var(--color-warn)' : 'var(--color-ink)' }}>
                    {euros(u.overage_cents)}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>Overage cost</div>
                </div>
              </div>
            </div>
          );
        }}
      </AsyncBoundary>

      <h2 className="mb-3 mt-8 text-sm font-semibold">Plans</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ORDER.map((p) => {
          const info = PLANS[p];
          const current = account?.plan === p;
          return (
            <div key={p} className="card flex flex-col p-5" style={current ? { borderColor: 'var(--color-brand)', borderWidth: 2 } : undefined}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold">{info.label}</h3>
                {current && <span className="badge badge-brand">Current</span>}
              </div>
              <div className="mt-1 text-2xl font-bold">
                {info.price}<span className="text-sm font-normal" style={{ color: 'var(--color-ink-muted)' }}>/mo</span>
              </div>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
                <li>{info.apps} app{info.apps > 1 ? 's' : ''}</li>
                <li>{info.ramMb} MB RAM</li>
                <li>{info.concurrency} concurrent</li>
                <li>{info.gbHours} GB-h included</li>
              </ul>
              <button
                className={`btn ${current ? 'btn-secondary' : 'btn-primary'} mt-4 w-full`}
                disabled={current || busy === p}
                onClick={() => select(p)}
              >
                {current ? 'Current plan' : busy === p ? 'Switching…' : `Switch to ${info.label}`}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--color-ink-muted)' }}>Overage is billed at €0.01 per GB-hour beyond your included allowance.</p>
    </div>
  );
}
