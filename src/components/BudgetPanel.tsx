'use client';

import { useRef, useState } from 'react';
import type { App } from '@/lib/api';
import { createFinancialBudget, deleteFinancialBudget, listFinancialBudgets, updateFinancialBudget } from '@/lib/api';
import type { BudgetPolicy, BudgetSpec } from '@/lib/budgets';
import { budgetMoney, budgetWarningThreshold, parseBudgetEuros, strictCompute } from '@/lib/budgets';
import { useAsync } from '@/lib/useAsync';
import { SectionCard } from '@/components/ui/Panels';

export function BudgetHealth({ policy, apps = [] }: { policy: BudgetPolicy; apps?: App[] }) {
  const evaluation = policy.runtime?.evaluation;
  const stopping = policy.spec.action === 'stop_previews' && policy.spec.mode === 'monitored';
  const strict = strictCompute(policy.spec);
  const compute = policy.runtime?.compute;
  return (
    <div className="space-y-2 text-sm">
      <p>{policy.status === 'active'
        ? strict ? policy.spec.scope.kind === 'account' ? 'Strict account compute budget active. All apps share included allowance and paid compute funding.' : 'Strict app compute budget active. Every VM execution window requires reserved funding.' : stopping ? 'Preview stopping active. Production can continue. Metering and shutdown delays can exceed the budget.' : 'Spending alerts active. Workloads continue running.'
        : policy.status === 'unavailable' ? 'Budget monitoring is unavailable.' : 'Draft: this budget is inactive.'}</p>
      {compute && <div className="space-y-1">
        <p>Committed compute: {budgetMoney(compute.committed_millicents)} · Reserved: {budgetMoney(compute.reserved_millicents)} · Remaining: {budgetMoney(compute.remaining_millicents)}</p>
        {compute.scope_kind === 'account' && <>
          <p>Shared included compute (MB-seconds): granted {compute.allowance_granted_mb_seconds?.toLocaleString() ?? 'Unavailable'} · Committed: {compute.allowance_committed_mb_seconds?.toLocaleString() ?? 'Unavailable'} · Reserved: {compute.allowance_reserved_mb_seconds?.toLocaleString() ?? 'Unavailable'} · Remaining: {compute.allowance_remaining_mb_seconds?.toLocaleString() ?? 'Unavailable'}</p>
          <p>Compute money balances cover paid usage after the shared allowance. App budgets also apply.</p>
        </>}
        <p>Commitments include startup and round up conservatively. They can exceed the compute charge on your bill.</p>
        <p>{compute.unconfirmed_leases} active or unsettled VM attempts. Funding remains reserved until shutdown and settlement are confirmed.</p>
        {compute.held && <p role="status">Compute budget held. {policy.spec.resume_rule === 'manual' ? 'Change or disable this policy to resume.' : `This hold resets at ${compute.period_end} (UTC).`}</p>}
        {!compute.initialized && <p role="status">Awaiting accounting initialization for this UTC month.</p>}
        <p>Subscription, storage, network egress, builds, and taxes are outside this compute budget.</p>
      </div>}
      {(policy.runtime?.stops ?? []).map((stop) => <div key={stop.id} className="space-y-1">
        <p>Preview stop requested. Drain deadline: <time dateTime={stop.drain_deadline}>{stop.drain_deadline}</time>.</p>
        <p>{stop.resume_rule === 'manual' ? 'Disable or change this policy to release its hold.' : `This hold releases at ${stop.period_end} (UTC).`}</p>
        {stop.targets.length === 0 && <p role="status">Awaiting scheduler acknowledgement. Stopping is not yet confirmed.</p>}
        {stop.targets.map((target) => <p key={`${target.app_id}:${target.environment_id ?? ''}`} role="status">
          {apps.find((app) => app.id === target.app_id)?.slug ?? target.app_id}{target.environment_id ? ` · ${target.environment_id}` : ''}: {target.state === 'enforced' ? 'Stopped' : target.state}
          {' · '}{target.resident_count} resident instances · observed <time dateTime={target.observed_at}>{target.observed_at}</time>
          {target.state === 'failed' && ' · Shutdown could not be confirmed. Gregale will retry.'}
          {target.state === 'unavailable' && ' · Scheduler status is stale; stopping is not confirmed.'}
        </p>)}
      </div>)}
      {evaluation ? <>
        <p>Known spending: {evaluation.known_millicents === undefined ? 'Unavailable' : budgetMoney(evaluation.known_millicents)}</p>
        <p>Last evaluation: <time dateTime={evaluation.evaluated_at}>{evaluation.evaluated_at}</time></p>
        <p>Evidence through: <time dateTime={evaluation.as_of}>{evaluation.as_of}</time></p>
        {(!evaluation.coverage_complete || !evaluation.fresh) &&
          <p role="status" style={{ color: 'var(--color-warn)' }}>
            {!evaluation.coverage_complete ? 'Cost coverage is partial. ' : ''}
            {!evaluation.fresh ? 'Cost evidence or monitoring is stale or unavailable. ' : ''}
            This subtotal does not establish that spending is below the budget.
          </p>}
      </> : policy.status === 'active' && !strict && <p>Awaiting the first evaluation. Spending is not yet known.</p>}
      {(policy.runtime?.alerts ?? []).map((alert) => <p key={alert.id}>
        {budgetMoney(alert.threshold_millicents)} alert: {alert.state} · {alert.attempts} delivery attempts
        {alert.state === 'retrying' && <> · next attempt <time dateTime={alert.next_attempt_at}>{alert.next_attempt_at}</time></>}
        {alert.delivered_at && <> · accepted by email transport <time dateTime={alert.delivered_at}>{alert.delivered_at}</time></>}
      </p>)}
    </div>
  );
}

export default function BudgetPanel({ apps }: { apps: App[] }) {
  const policies = useAsync(listFinancialBudgets, []);
  const [name, setName] = useState('Monthly compute');
  const [target, setTarget] = useState('');
  const [amount, setAmount] = useState('10.00');
  const [basis, setBasis] = useState<BudgetSpec['basis']>('net_usage');
  const [enabled, setEnabled] = useState(true);
  const [action, setAction] = useState<'notify' | 'stop_previews' | 'suspend_workloads'>('notify');
  const [drain, setDrain] = useState('30');
  const [resume, setResume] = useState<BudgetSpec['resume_rule']>('next_period');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // A retried operation retains its key and exact payload, even after a network
  // failure. Changing intent starts a new operation rather than replaying it.
  const operation = useRef<{ signature: string; key: string } | null>(null);

  async function mutate(signature: string, run: (key: string) => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    if (operation.current?.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
    try {
      await run(operation.current.key);
      operation.current = null;
      setMessage('Budget saved.');
      policies.reload();
    } catch (err) {
      setMessage((err as Error).message);
      policies.reload();
    } finally {
      setBusy(false);
    }
  }

  function create(event: React.FormEvent) {
    event.preventDefault();
    let limit: number;
    try { limit = parseBudgetEuros(amount); } catch (err) { setMessage((err as Error).message); return; }
    const strict = action === 'suspend_workloads';
    const drainSeconds = action === 'stop_previews' ? Number(drain) : 0;
    if (!Number.isInteger(drainSeconds) || drainSeconds < 0 || drainSeconds > 300) {
      setMessage('Drain time must be a whole number from 0 to 300 seconds.'); return;
    }
    const spec: BudgetSpec = {
      name: name.trim(), scope: target ? { kind: 'app', id: target } : { kind: 'account' },
      currency: 'EUR', meters: ['compute'], basis: strict ? target ? 'gross_usage' : 'net_usage' : basis, limit_millicents: limit,
      notify_millicents: strict ? [] : [budgetWarningThreshold(limit)], mode: strict ? 'strict' : 'monitored', action,
      drain_seconds: drainSeconds, resume_rule: resume, enabled,
    };
    void mutate(`create:${JSON.stringify(spec)}`, (key) => createFinancialBudget(spec, key));
  }

  return <SectionCard className="mt-4" title="Compute budgets" bodyClassName="space-y-5 px-5 py-5"
    action={<button className="btn btn-secondary" onClick={policies.reload} disabled={busy}>Refresh</button>}>
    <p className="text-sm">Monitor spending, stop previews after a threshold, or reserve compute funding across your account or for one app. Budgets use the current UTC month. Changing a policy keeps the month’s spending.</p>
    <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Budget name<input className="field mt-1 w-full" required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="text-sm">Scope<select className="field mt-1 w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Entire account</option>{apps.filter((a) => a.status !== 'deleted').map((a) => <option key={a.id} value={a.id}>{a.slug}</option>)}
      </select></label>
      <label className="text-sm">Monthly amount (EUR)<input className="field mt-1 w-full" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="text-sm">Spending basis<select className="field mt-1 w-full" disabled={action === 'suspend_workloads'} value={action === 'suspend_workloads' ? target ? 'gross_usage' : 'net_usage' : basis} onChange={(e) => setBasis(e.target.value as BudgetSpec['basis'])}>
        <option value="net_usage">After included allowance</option><option value="gross_usage">Before included allowance</option>
      </select></label>
      <label className="text-sm">At the limit<select className="field mt-1 w-full" value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
        <option value="notify">Send alerts; keep workloads running</option><option value="stop_previews">Stop preview workloads</option><option value="suspend_workloads">Strict: reserve compute funding</option>
      </select></label>
      {action === 'stop_previews' && <>
        <label className="text-sm">Drain time (seconds)<input className="field mt-1 w-full" type="number" min="0" max="300" step="1" required value={drain} onChange={(e) => setDrain(e.target.value)} /></label>
        <label className="text-sm">Resume<select className="field mt-1 w-full" value={resume} onChange={(e) => setResume(e.target.value as BudgetSpec['resume_rule'])}>
          <option value="next_period">At the next UTC month</option><option value="manual">When I change or disable the policy</option>
        </select></label>
        <p className="text-sm">Only workloads recorded as previews can be stopped. Queued work is retained. Releasing this budget hold keeps any other payment, security, or user hold in place.</p>
      </>}
      {action === 'suspend_workloads' && <>
        <label className="text-sm">Resume<select className="field mt-1 w-full" value={resume} onChange={(e) => setResume(e.target.value as BudgetSpec['resume_rule'])}>
          <option value="next_period">At the next UTC month</option><option value="manual">When I change or disable the policy</option>
        </select></label>
        <p className="text-sm">Activation requires quiet covered workloads and complete compute accounting. Account budgets share included compute and cap paid usage across all apps; independent job definitions must first be removed. App budgets cap gross compute before allowance. Funding covers startup, execution, and shutdown. This budget takes precedence over instance floors. Strict budgets do not send spending alerts; you can configure a separate monitored policy.</p>
      </>}
      <label className="text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enable budget</label>
      <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Create budget'}</button>
    </form>
    {message && <p role="status" className="text-sm">{message}</p>}
    {policies.loading && <p>Loading budgets…</p>}
    {policies.error && <p role="alert">Could not load budgets: {policies.error.message}</p>}
    {!policies.loading && !policies.error && policies.data?.budgets.length === 0 && <p>No budgets configured.</p>}
    {!policies.error && policies.data?.budgets.map((policy) => <article key={policy.id} className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{policy.spec.name} · {budgetMoney(policy.spec.limit_millicents)}</h3>
        <div className="flex gap-2">
          {(strictCompute(policy.spec) || policy.spec.mode === 'monitored' && (policy.spec.action === 'notify' || policy.spec.action === 'stop_previews' && policy.spec.meters.length === 1 && policy.spec.meters[0] === 'compute')) && <button className="btn btn-secondary" disabled={busy} onClick={() => {
            const spec = { ...policy.spec, enabled: !policy.spec.enabled };
            void mutate(`update:${policy.id}:${policy.revision}:${JSON.stringify(spec)}`, (key) => updateFinancialBudget(policy, spec, key));
          }}>{strictCompute(policy.spec) ? policy.spec.enabled ? 'Disable strict budget' : 'Enable strict budget' : policy.spec.action === 'stop_previews' ? policy.spec.enabled ? 'Disable and release this budget hold' : 'Enable preview stopping' : policy.spec.enabled ? 'Disable alerts' : 'Enable alerts'}</button>}
          <button className="btn btn-secondary" disabled={busy} onClick={() => void mutate(`delete:${policy.id}:${policy.revision}`, (key) => deleteFinancialBudget(policy, key))}>Delete</button>
        </div>
      </div>
      <p className="text-sm">{policy.spec.scope.kind}{policy.spec.scope.id ? ` · ${apps.find((a) => a.id === policy.spec.scope.id)?.slug ?? policy.spec.scope.id}` : ''} · {policy.spec.basis === 'net_usage' ? 'after allowance' : 'before allowance'}</p>
      {policy.spec.action !== 'notify' && policy.spec.action !== 'stop_previews' && !strictCompute(policy.spec) && <p className="text-sm">This stopping action is unavailable and remains a draft.</p>}
      <BudgetHealth policy={policy} apps={apps} />
    </article>)}
  </SectionCard>;
}
