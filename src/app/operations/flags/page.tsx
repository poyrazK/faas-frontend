'use client';

import React, { useMemo, useState } from 'react';
import {
  getAccountPlatformFlags,
  getOperatorRuntimeConfigRevisions,
  getPlatformFlags,
  rollbackPlatformFlagConfig,
  updatePlatformFlagConfig,
  type OperatorAccountPlatformFlags,
  type OperatorPlatformFlag,
  type OperatorRuntimeConfigRevision,
  type PlatformFlagDefinition,
  type PlatformFlagPlan,
} from '@/lib/api';
import {
  addGroupRule,
  allowAccount,
  denyAccount,
  describeRule,
  editGroup,
  expectedVersion,
  isAccountID,
  moveRule,
  removeRule,
  revokeAccount,
  setDefault,
  setRollout,
  setSwitch,
} from '@/lib/platformFlags';
import { useAsync } from '@/lib/useAsync';
import { Icon } from '@/components/ui/Icons';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Spinner } from '@/components/ui/States';

const PLANS: PlatformFlagPlan[] = ['free', 'hobby', 'pro', 'scale'];

const REASON_TEXT: Record<string, string> = {
  rule_match: 'matched a rule',
  default: 'no rule matched; default applies',
  flag_disabled: 'kill switch is off',
  account_missing: 'no account',
  unknown_flag: 'flag is not catalogued',
};

function convergenceBadge(flag: OperatorPlatformFlag) {
  const { converged, pending, failed } = flag.convergence;
  if (failed.length) return <span className="badge badge-danger">failed: {failed.join(', ')}</span>;
  if (pending.length) return <span className="badge badge-warning">pending: {pending.join(', ')}</span>;
  return <span className="badge badge-success">applied: {converged.join(', ')}</span>;
}

export default function PlatformFlagsPage() {
  const flags = useAsync(getPlatformFlags, [], 15000);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [accountInputs, setAccountInputs] = useState<Record<string, string>>({});
  const [rolloutInputs, setRolloutInputs] = useState<Record<string, { percent: string; plans: PlatformFlagPlan[] }>>({});
  const [groupInputs, setGroupInputs] = useState<Record<string, string>>({});
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<{ flag: OperatorPlatformFlag; items: OperatorRuntimeConfigRevision[] } | null>(null);
  const [newGroup, setNewGroup] = useState({ name: '', account: '' });
  const [inspectID, setInspectID] = useState('');
  const [inspected, setInspected] = useState<OperatorAccountPlatformFlags | null>(null);

  const groups = flags.data?.groups;
  const groupNames = useMemo(() => Object.keys(groups?.groups ?? {}).sort(), [groups]);

  function requireReason(): boolean {
    if (reason.trim().length < 3) {
      setMessage({ tone: 'error', text: 'Enter a change reason (at least 3 characters) before changing a flag.' });
      return false;
    }
    return true;
  }

  async function write(id: string, configKey: string, value: PlatformFlagDefinition | Record<string, string[]>, expected: number, done: string) {
    if (!requireReason()) return;
    setSaving(id);
    setMessage(null);
    try {
      const result = await updatePlatformFlagConfig(configKey, value, reason.trim(), expected);
      setMessage({ tone: 'ok', text: `${done} (v${result.version}). Consumers converge within seconds.` });
      flags.reload();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Platform flag update failed.' });
    } finally {
      setSaving(null);
    }
  }

  function editFlag(flag: OperatorPlatformFlag, id: string, next: PlatformFlagDefinition, done: string) {
    return write(`${flag.key}:${id}`, flag.config_key, next, expectedVersion(flag), done);
  }

  function accountAction(flag: OperatorPlatformFlag, action: 'allow' | 'deny' | 'revoke') {
    const account = (accountInputs[flag.key] ?? '').trim();
    if (!isAccountID(account)) {
      setMessage({ tone: 'error', text: 'Enter an account UUID.' });
      return;
    }
    const edit = { allow: allowAccount, deny: denyAccount, revoke: revokeAccount }[action];
    void editFlag(flag, action, edit(flag.definition, account), `${flag.label}: ${action} ${account}`);
  }

  function toggleSwitch(flag: OperatorPlatformFlag) {
    const enabling = !flag.definition.enabled;
    if (!enabling && !window.confirm(`Turn ${flag.label} off for every account? Rules are kept and apply again when it is re-enabled.`)) return;
    void editFlag(flag, 'switch', setSwitch(flag.definition, enabling), `${flag.label} ${enabling ? 'enabled' : 'disabled for every account'}`);
  }

  function applyRollout(flag: OperatorPlatformFlag) {
    const input = rolloutInputs[flag.key] ?? { percent: '', plans: [] };
    const percent = Number(input.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setMessage({ tone: 'error', text: 'Rollout must be between 0 and 100 percent.' });
      return;
    }
    void editFlag(flag, 'rollout', setRollout(flag.definition, percent, input.plans), `${flag.label} rollout set to ${percent}%`);
  }

  function saveJSON(flag: OperatorPlatformFlag) {
    let parsed: PlatformFlagDefinition;
    try {
      parsed = JSON.parse(jsonDrafts[flag.key] ?? '') as PlatformFlagDefinition;
    } catch {
      setMessage({ tone: 'error', text: 'The definition is not valid JSON.' });
      return;
    }
    void editFlag(flag, 'json', parsed, `${flag.label} definition replaced`);
  }

  function groupMember(group: string, account: string, add: boolean) {
    if (!groups) return;
    if (!isAccountID(account)) {
      setMessage({ tone: 'error', text: 'Enter an account UUID.' });
      return;
    }
    void write(`group:${group}`, groups.config_key, editGroup(groups.groups, group, account, add), groups.version,
      `${add ? 'Added' : 'Removed'} ${account} ${add ? 'to' : 'from'} ${group}`);
  }

  async function showHistory(flag: OperatorPlatformFlag) {
    try {
      const response = await getOperatorRuntimeConfigRevisions(flag.config_key, 20);
      setHistory({ flag, items: response.items });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not load the flag history.' });
    }
  }

  async function rollback(flag: OperatorPlatformFlag, revision: OperatorRuntimeConfigRevision) {
    if (!requireReason()) return;
    if (!window.confirm(`Restore ${flag.label} to revision v${revision.version}? This creates a new live revision.`)) return;
    setSaving(`${flag.key}:rollback`);
    try {
      await rollbackPlatformFlagConfig(flag.config_key, revision.version, reason.trim(), expectedVersion(flag));
      setMessage({ tone: 'ok', text: `${flag.label} restored to v${revision.version}.` });
      setHistory(null);
      flags.reload();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Rollback failed.' });
    } finally {
      setSaving(null);
    }
  }

  async function inspect() {
    if (!isAccountID(inspectID)) {
      setMessage({ tone: 'error', text: 'Enter an account UUID to inspect.' });
      return;
    }
    try {
      setInspected(await getAccountPlatformFlags(inspectID));
    } catch (error) {
      setInspected(null);
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not evaluate the account.' });
    }
  }

  if (flags.loading && !flags.data) {
    return <div className="flex h-64 items-center justify-center"><Spinner size={24} /></div>;
  }
  if (flags.error) {
    return (
      <div className="card p-8 text-center">
        <Icon name="shield" size={24} className="mx-auto text-[var(--color-danger)]" />
        <h2 className="mt-4 text-lg font-semibold">Operator access required</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{flags.error.message}</p>
        <button type="button" onClick={flags.reload} className="btn btn-secondary btn-sm mt-4">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Platform Flags"
        subtitle="Release platform features to selected accounts without a deploy. Changes apply within seconds and are audited."
        actions={<button type="button" onClick={flags.reload} className="btn btn-secondary btn-sm"><Icon name="refresh" size={14} />Refresh</button>}
      />

      <div className="mb-6 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-sm">
        <div className="flex items-start gap-3">
          <Icon name="filter" size={18} className="mt-0.5 text-[var(--color-brand-bright)]" />
          <p className="text-[var(--color-ink-muted)]">
            The switch turns a feature off for everyone. When it is on, rules run top to bottom and the first match decides;
            accounts no rule matches get the default. Explicit denies and allows always run first. Plan entitlement is still
            enforced: a flag never unlocks a capability an account&apos;s plan lacks.
          </p>
        </div>
      </div>

      <div className="mb-6 card p-4">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]" htmlFor="flag-reason">Change reason</label>
        <input id="flag-reason" className="input mt-2 w-full" value={reason} maxLength={500} placeholder="e.g. release to design partner acme (ticket 123)"
          onChange={(event) => setReason(event.target.value)} />
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Required for every change. Writes need a recent MFA step-up and fail with a conflict if someone else changed the flag first.</p>
      </div>

      {message && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${message.tone === 'error' ? 'border-[var(--color-danger)] text-[var(--color-danger)]' : 'border-[var(--color-line)]'}`}>
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        {(flags.data?.items ?? []).map((flag) => {
          const rules = flag.definition.rules ?? [];
          const rollout = rolloutInputs[flag.key] ?? { percent: '', plans: [] };
          return (
            <SectionCard
              key={flag.key}
              title={<span className="flex flex-wrap items-center gap-2">{flag.label}<span className="font-mono text-xs text-[var(--color-ink-muted)]">{flag.key}</span></span>}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${flag.definition.enabled ? 'badge-success' : 'badge-neutral'}`}>{flag.definition.enabled ? 'on' : 'off'}</span>
                  {convergenceBadge(flag)}
                  <button type="button" className={`btn btn-sm ${flag.definition.enabled ? 'btn-secondary' : 'btn-primary'}`}
                    disabled={saving !== null} onClick={() => toggleSwitch(flag)}>
                    {saving === `${flag.key}:switch` ? <Spinner size={14} /> : flag.definition.enabled ? 'Turn off' : 'Turn on'}
                  </button>
                </div>
              }
            >
              <div className="space-y-4 p-4 text-sm">
                <div className="text-xs text-[var(--color-ink-muted)]">
                  {flag.description}
                  <div className="mt-1">
                    {flag.capability ? <>Capability <span className="font-mono">{flag.capability}</span> · </> : null}
                    {flag.adr} · Consumers {flag.consumers.join(', ')} · {flag.source === 'operator' ? `operator value v${flag.version}` : `boot fallback (${flag.legacy_env.join(', ') || 'catalog default'})`}
                    {flag.retire_by ? ` · retire by ${flag.retire_by}` : ''}
                  </div>
                  {flag.last_error && <div className="mt-1 text-[var(--color-danger)]">{flag.last_error}</div>}
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Rules (first match wins)</div>
                  {rules.length === 0 ? (
                    <div className="text-xs text-[var(--color-ink-muted)]">No rules.</div>
                  ) : (
                    <div className="divide-y divide-[var(--color-line)] rounded border border-[var(--color-line)]">
                      {rules.map((rule, index) => (
                        <div key={rule.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                          <span className="w-6 text-[var(--color-ink-muted)]">{index + 1}</span>
                          <span className="font-mono font-semibold">{rule.id}</span>
                          <span className={`badge ${rule.value ? 'badge-success' : 'badge-danger'}`}>{rule.value ? 'enable' : 'deny'}</span>
                          <span className="flex-1 text-[var(--color-ink-muted)]" title={rule.accounts?.join('\n')}>{describeRule(rule, groups?.groups)}</span>
                          <button type="button" className="btn btn-secondary btn-sm" disabled={saving !== null || index === 0}
                            onClick={() => editFlag(flag, `up:${rule.id}`, moveRule(flag.definition, rule.id, -1), `${flag.label}: moved ${rule.id} up`)}>↑</button>
                          <button type="button" className="btn btn-secondary btn-sm" disabled={saving !== null || index === rules.length - 1}
                            onClick={() => editFlag(flag, `down:${rule.id}`, moveRule(flag.definition, rule.id, 1), `${flag.label}: moved ${rule.id} down`)}>↓</button>
                          <button type="button" className="btn btn-secondary btn-sm" disabled={saving !== null}
                            onClick={() => editFlag(flag, `remove:${rule.id}`, removeRule(flag.definition, rule.id), `${flag.label}: removed ${rule.id}`)}>
                            <Icon name="trash" size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[var(--color-ink-muted)]">Default for everyone else:</span>
                    <select className="input" value={String(flag.definition.default)} disabled={saving !== null}
                      onChange={(event) => editFlag(flag, 'default', setDefault(flag.definition, event.target.value === 'true'), `${flag.label} default set to ${event.target.value}`)}>
                      <option value="false">off</option>
                      <option value="true">on</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-[var(--color-ink-muted)]">Account</div>
                    <input className="input w-full font-mono text-xs" placeholder="account UUID" value={accountInputs[flag.key] ?? ''}
                      onChange={(event) => setAccountInputs((old) => ({ ...old, [flag.key]: event.target.value }))} />
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="btn btn-primary btn-sm" disabled={saving !== null} onClick={() => accountAction(flag, 'allow')}>Allow</button>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={saving !== null} onClick={() => accountAction(flag, 'deny')}>Deny</button>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={saving !== null} onClick={() => accountAction(flag, 'revoke')}>Revoke</button>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-[var(--color-ink-muted)]">Rollout</div>
                    <div className="flex items-center gap-2">
                      <input className="input w-24" type="number" min={0} max={100} step={0.01} placeholder="%" value={rollout.percent}
                        onChange={(event) => setRolloutInputs((old) => ({ ...old, [flag.key]: { ...rollout, percent: event.target.value } }))} />
                      <span className="text-xs text-[var(--color-ink-muted)]">% of</span>
                      {PLANS.map((plan) => (
                        <label key={plan} className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={rollout.plans.includes(plan)}
                            onChange={(event) => setRolloutInputs((old) => ({ ...old, [flag.key]: { ...rollout, plans: event.target.checked ? [...rollout.plans, plan] : rollout.plans.filter((p) => p !== plan) } }))} />
                          {plan}
                        </label>
                      ))}
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm mt-2" disabled={saving !== null} onClick={() => applyRollout(flag)}>Apply rollout</button>
                    <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">No plan selected means every plan. Widening keeps accounts already in.</p>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-[var(--color-ink-muted)]">Group</div>
                    <div className="flex gap-2">
                      <select className="input flex-1" value={groupInputs[flag.key] ?? ''}
                        onChange={(event) => setGroupInputs((old) => ({ ...old, [flag.key]: event.target.value }))}>
                        <option value="">choose a group</option>
                        {groupNames.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={saving !== null || !groupInputs[flag.key]}
                        onClick={() => editFlag(flag, 'group', addGroupRule(flag.definition, groupInputs[flag.key], true), `${flag.label}: enabled for group ${groupInputs[flag.key]}`)}>
                        Enable for group
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-[11px] font-semibold text-[var(--color-brand-bright)]">
                  <button type="button" className="hover:underline" onClick={() => setExpanded((cur) => (cur === `receipts:${flag.key}` ? null : `receipts:${flag.key}`))}>
                    Apply receipts ({flag.receipts.length})
                  </button>
                  <button type="button" className="hover:underline" onClick={() => {
                    setJsonDrafts((old) => ({ ...old, [flag.key]: old[flag.key] ?? JSON.stringify(flag.definition, null, 2) }));
                    setExpanded((cur) => (cur === `json:${flag.key}` ? null : `json:${flag.key}`));
                  }}>
                    Edit JSON
                  </button>
                  <button type="button" className="hover:underline" onClick={() => showHistory(flag)}>Version history</button>
                </div>

                {expanded === `receipts:${flag.key}` && (
                  <div className="space-y-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-2 text-[11px]">
                    {flag.receipts.length === 0 ? <div className="text-[var(--color-ink-muted)]">No daemon has reported this flag yet.</div> : flag.receipts.map((receipt) => (
                      <div key={`${receipt.daemon}:${receipt.instance}`} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono">{receipt.daemon} · {receipt.instance}</span>
                        <span className={`badge ${receipt.status === 'failed' ? 'badge-danger' : receipt.version < flag.version ? 'badge-warning' : 'badge-success'}`}>
                          {receipt.status === 'applied' && receipt.version < flag.version ? 'stale' : receipt.status}
                        </span>
                        <span className="text-[var(--color-ink-muted)]">v{receipt.version} · {new Date(receipt.reported_at).toLocaleString()}</span>
                        {receipt.error && <span className="text-[var(--color-danger)]">{receipt.error}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {expanded === `json:${flag.key}` && (
                  <div>
                    <textarea className="input h-48 w-full font-mono text-xs" value={jsonDrafts[flag.key] ?? ''}
                      onChange={(event) => setJsonDrafts((old) => ({ ...old, [flag.key]: event.target.value }))} />
                    <button type="button" className="btn btn-primary btn-sm mt-2" disabled={saving !== null} onClick={() => saveJSON(flag)}>Save definition</button>
                  </div>
                )}
              </div>
            </SectionCard>
          );
        })}
      </div>

      {history && (
        <SectionCard title={`Version history · ${history.flag.label}`} className="mt-6"
          action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setHistory(null)}>Close</button>}>
          {history.items.length === 0 ? <div className="p-4 text-sm text-[var(--color-ink-muted)]">No operator revisions yet.</div> : (
            <div className="divide-y divide-[var(--color-line)]">
              {history.items.map((revision) => (
                <div key={revision.id} className="grid gap-2 p-4 text-xs sm:grid-cols-[60px_1fr_auto]">
                  <span className="font-mono font-semibold">v{revision.version}</span>
                  <span className="text-[var(--color-ink-muted)]">
                    {revision.reason} · {new Date(revision.created_at).toLocaleString()}
                    <pre className="mt-1 overflow-x-auto font-mono text-[var(--color-ink)]">{JSON.stringify(revision.new_value)}</pre>
                  </span>
                  <span>
                    {revision.version < history.flag.version && (
                      <button type="button" className="btn btn-secondary btn-sm" disabled={saving !== null} onClick={() => rollback(history.flag, revision)}>Restore</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard title="Account groups" className="mt-6">
        <div className="divide-y divide-[var(--color-line)]">
          {groupNames.length === 0 && <div className="p-4 text-xs text-[var(--color-ink-muted)]">No groups yet.</div>}
          {groupNames.map((name) => (
            <div key={name} className="p-4 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{name}</span>
                <span className="badge badge-neutral">{groups?.groups[name].length ?? 0} accounts</span>
                {(groups?.references[name] ?? []).length > 0 && <span className="text-[var(--color-ink-muted)]">used by {groups?.references[name].join(', ')}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(groups?.groups[name] ?? []).map((account) => (
                  <span key={account} className="inline-flex items-center gap-1 rounded border border-[var(--color-line)] px-2 py-0.5 font-mono">
                    {account}
                    <button type="button" aria-label={`Remove ${account}`} disabled={saving !== null} onClick={() => groupMember(name, account, false)}>
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-2 p-4 text-xs">
            <label>
              <span className="text-[var(--color-ink-muted)]">Group</span>
              <input className="input mt-1 w-48" placeholder="design-partners" value={newGroup.name}
                onChange={(event) => setNewGroup((old) => ({ ...old, name: event.target.value.toLowerCase() }))} />
            </label>
            <label>
              <span className="text-[var(--color-ink-muted)]">Account UUID</span>
              <input className="input mt-1 w-80 font-mono" value={newGroup.account}
                onChange={(event) => setNewGroup((old) => ({ ...old, account: event.target.value }))} />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving !== null || !newGroup.name.trim()}
              onClick={() => groupMember(newGroup.name.trim(), newGroup.account, true)}>
              Add to group
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Account inspector" className="mt-6">
        <div className="p-4">
          <div className="flex flex-wrap gap-2">
            <input className="input w-96 font-mono text-xs" placeholder="account UUID" value={inspectID} onChange={(event) => setInspectID(event.target.value)} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={inspect}><Icon name="search" size={14} />Inspect</button>
          </div>
          {inspected && (
            <div className="mt-4 divide-y divide-[var(--color-line)] rounded border border-[var(--color-line)] text-xs">
              <div className="px-3 py-2 text-[var(--color-ink-muted)]">Account <span className="font-mono">{inspected.account_id}</span> · plan {inspected.plan}</div>
              {inspected.items.map((decision) => (
                <div key={decision.flag} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-mono font-semibold">{decision.flag}</span>
                  <span className={`badge ${decision.available ? 'badge-success' : 'badge-neutral'}`}>{decision.available ? 'available' : 'unavailable'}</span>
                  <span className="text-[var(--color-ink-muted)]">
                    flag {decision.enabled ? 'on' : 'off'} ({REASON_TEXT[decision.reason] ?? decision.reason}{decision.rule_id ? `: ${decision.rule_id}` : ''})
                    {decision.entitled === false ? ' · plan not entitled' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
