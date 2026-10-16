'use client';

import { useRef, useState } from 'react';
import type { App } from '@/lib/api';
import { createFinancialBudget, deleteFinancialBudget, listFinancialBudgets, updateFinancialBudget } from '@/lib/api';
import type { BudgetPolicy, BudgetSpec } from '@/lib/budgets';
import { budgetMoney, budgetWarningThreshold, parseBudgetEuros } from '@/lib/budgets';
import { useAsync } from '@/lib/useAsync';
import { SectionCard } from '@/components/ui/Panels';

export function BudgetHealth({ policy }: { policy: BudgetPolicy }) {
  const evaluation = policy.runtime?.evaluation;
  return (
    <div className="space-y-2 text-sm">
      <p>{policy.status === 'active' ? 'Spending alerts active. Workloads continue running.' : 'Draft: spending alerts are inactive.'}</p>
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
      </> : policy.status === 'active' && <p>Awaiting the first evaluation. Spending is not yet known.</p>}
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
    const spec: BudgetSpec = {
      name: name.trim(), scope: target ? { kind: 'app', id: target } : { kind: 'account' },
      currency: 'EUR', meters: ['compute'], basis, limit_millicents: limit,
      notify_millicents: [budgetWarningThreshold(limit)], mode: 'monitored', action: 'notify',
      drain_seconds: 0, resume_rule: 'next_period', enabled,
    };
    void mutate(`create:${JSON.stringify(spec)}`, (key) => createFinancialBudget(spec, key));
  }

  return <SectionCard className="mt-4" title="Spending alerts" bodyClassName="space-y-5 px-5 py-5"
    action={<button className="btn btn-secondary" onClick={policies.reload} disabled={busy}>Refresh</button>}>
    <p className="text-sm">Monthly compute budgets send email to your account address at 80% and 100%. They cover selected usage, rather than the full invoice. Budgets monitor the current UTC month, regardless of the usage month selected above. Re-enabling alerts checks this month’s existing spending again.</p>
    <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Budget name<input className="field mt-1 w-full" required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="text-sm">Scope<select className="field mt-1 w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Entire account</option>{apps.filter((a) => a.status !== 'deleted').map((a) => <option key={a.id} value={a.id}>{a.slug}</option>)}
      </select></label>
      <label className="text-sm">Monthly amount (EUR)<input className="field mt-1 w-full" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="text-sm">Spending basis<select className="field mt-1 w-full" value={basis} onChange={(e) => setBasis(e.target.value as BudgetSpec['basis'])}>
        <option value="net_usage">After included allowance</option><option value="gross_usage">Before included allowance</option>
      </select></label>
      <label className="text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enable spending alerts</label>
      <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Create budget'}</button>
    </form>
    {message && <p role="status" className="text-sm">{message}</p>}
    {policies.loading && <p>Loading budgets…</p>}
    {policies.error && <p role="alert">Could not load budgets: {policies.error.message}</p>}
    {!policies.loading && !policies.error && policies.data?.budgets.length === 0 && <p>No budgets configured.</p>}
    {!policies.error && policies.data?.budgets.map((policy) => <article key={policy.id} className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{policy.spec.name} · {budgetMoney(policy.spec.limit_millicents)}</h3>
        <div className="flex gap-2">
          {policy.spec.mode === 'monitored' && policy.spec.action === 'notify' && <button className="btn btn-secondary" disabled={busy} onClick={() => {
            const spec = { ...policy.spec, enabled: !policy.spec.enabled };
            void mutate(`update:${policy.id}:${policy.revision}:${JSON.stringify(spec)}`, (key) => updateFinancialBudget(policy, spec, key));
          }}>{policy.spec.enabled ? 'Disable alerts' : 'Enable alerts'}</button>}
          <button className="btn btn-secondary" disabled={busy} onClick={() => void mutate(`delete:${policy.id}:${policy.revision}`, (key) => deleteFinancialBudget(policy, key))}>Delete</button>
        </div>
      </div>
      <p className="text-sm">{policy.spec.scope.kind}{policy.spec.scope.id ? ` · ${apps.find((a) => a.id === policy.spec.scope.id)?.slug ?? policy.spec.scope.id}` : ''} · {policy.spec.basis === 'net_usage' ? 'after allowance' : 'before allowance'}</p>
      {policy.spec.action !== 'notify' && <p className="text-sm">Automatic stopping is unavailable. This policy remains a draft.</p>}
      <BudgetHealth policy={policy} />
    </article>)}
  </SectionCard>;
}
