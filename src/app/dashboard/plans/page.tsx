'use client';

/* ==========================================================================
   Plans — plan comparison and switching via PATCH /v1/account/plan.
   Quotas come from lib/format's PLANS table, kept in sync with the backend's
   pkg/api/limits.go, and the live account's own limits are shown alongside.
   ========================================================================== */

import React, { useState } from 'react';
import Link from 'next/link';
import { changePlan, getUsageSummary, Plan, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icons';
import { PLANS, euros } from '@/lib/format';

const ORDER: Plan[] = ['free', 'hobby', 'pro', 'scale'];

export default function PlansPage() {
  const { account, refresh } = useAuth();
  const usage = useAsync(() => getUsageSummary(), []);
  const toast = useToast();
  const [pending, setPending] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await changePlan(pending);
      await refresh();
      usage.reload();
      toast.success(`Switched to ${PLANS[pending].label}.`);
      setPending(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change plan.');
    } finally {
      setBusy(false);
    }
  }

  const currentIndex = account ? ORDER.indexOf(account.plan) : -1;

  return (
    <div>
      <PageHeader
        title="Plans"
        subtitle="Capacity-based pricing. Change plans at any time."
        actions={
          <Link href="/dashboard/usage" className="btn btn-secondary">
            <Icon name="usage" size={14} /> View usage
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {ORDER.map((p, i) => {
          const info = PLANS[p];
          const current = account?.plan === p;
          const downgrade = currentIndex >= 0 && i < currentIndex;
          return (
            <div
              key={p}
              className="card flex flex-col p-5"
              style={current ? { borderColor: 'var(--color-brand)', boxShadow: '0 0 0 1px var(--color-brand)' } : undefined}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold">{info.label}</h3>
                {current && <span className="badge badge-brand">Current</span>}
                {!current && p === 'pro' && <span className="badge badge-muted">Popular</span>}
              </div>
              <div className="mt-1.5 text-[28px] font-bold leading-none">
                {info.price}
                <span className="text-sm font-normal" style={{ color: 'var(--color-ink-muted)' }}>
                  /mo
                </span>
              </div>
              <ul className="mt-5 flex-1 space-y-2 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
                <Feature>{info.apps} workflow{info.apps > 1 ? 's' : ''}</Feature>
                <Feature>{info.ramMb} MB RAM per microVM</Feature>
                <Feature>{info.concurrency} concurrent wake{info.concurrency > 1 ? 's' : ''}</Feature>
                <Feature>{info.gbHours} GB-hours included</Feature>
              </ul>
              <button
                className={`btn ${current ? 'btn-secondary' : downgrade ? 'btn-secondary' : 'btn-primary'} mt-5 w-full`}
                disabled={current}
                onClick={() => setPending(p)}
              >
                {current ? 'Current plan' : downgrade ? `Downgrade to ${info.label}` : `Upgrade to ${info.label}`}
              </button>
            </div>
          );
        })}
      </div>

      {account && (
        <SectionCard className="mt-4" title="Your current limits">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Limit k="Plan" v={PLANS[account.plan].label} />
            <Limit k="RAM per microVM" v={`${account.limits.ram_mb} MB`} />
            <Limit k="Max concurrency" v={String(account.limits.max_concurrency)} />
            <Limit k="Workflows" v={`${account.app_count} / ${account.limits.deployed_apps}`} />
            <Limit k="Included GB-hours" v={String(account.limits.included_gb_hours)} />
            <Limit k="Max layer size" v={`${account.limits.app_layer_max_mb} MB`} />
          </dl>
          {usage.data && usage.data.overage_cents > 0 && (
            <div className="px-5 pb-5">
              <p className="text-sm" style={{ color: 'var(--color-warn)' }}>
                You&apos;re {usage.data.overage_gb_hours.toFixed(2)} GB-h over this month — {euros(usage.data.overage_cents)} in
                overage. A higher plan includes more GB-hours at a lower effective rate.
              </p>
            </div>
          )}
        </SectionCard>
      )}

      <p className="mt-4 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
        Overage beyond your included allowance is billed at €0.01 per GB-hour. Changing plan takes effect immediately and
        applies the new RAM and concurrency limits to subsequent wakes.
      </p>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? `Switch to ${PLANS[pending].label}?` : ''}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPending(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={confirm} disabled={busy}>
              {busy ? 'Switching…' : 'Confirm change'}
            </button>
          </>
        }
      >
        {pending && (
          <div className="space-y-3 text-sm" style={{ color: 'var(--color-ink-soft)' }}>
            <p>
              Your account moves to <strong>{PLANS[pending].label}</strong> ({PLANS[pending].price}/mo) immediately.
            </p>
            <p>
              New limits: {PLANS[pending].ramMb} MB RAM, {PLANS[pending].concurrency} concurrent wakes,{' '}
              {PLANS[pending].apps} workflows, {PLANS[pending].gbHours} GB-hours included.
            </p>
            {account && ORDER.indexOf(pending) < ORDER.indexOf(account.plan) && (
              <p style={{ color: 'var(--color-warn)' }}>
                This is a downgrade. If you currently run more than {PLANS[pending].apps} workflows or rely on more RAM,
                deploys and wakes can start failing against the lower caps.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon name="check" size={14} style={{ color: 'var(--color-brand)', marginTop: 3, flex: 'none' }} />
      <span>{children}</span>
    </li>
  );
}

function Limit({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>{k}</dt>
      <dd className="mt-1 font-semibold" style={{ color: 'var(--color-ink)' }}>{v}</dd>
    </div>
  );
}
