'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  getOperatorRuntimeConfig,
  getOperatorRuntimeConfigOperation,
  getOperatorRuntimeConfigRevisions,
  rollbackOperatorRuntimeConfig,
  type OperatorRuntimeConfig,
  type OperatorRuntimeConfigAck,
  type OperatorRuntimeConfigOperation,
  type OperatorRuntimeConfigRevision,
  type OperatorRuntimeConfigTarget,
  type RuntimeConfigScope,
  updateOperatorRuntimeConfig,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { Icon } from '@/components/ui/Icons';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Spinner } from '@/components/ui/States';

function valueText(value: unknown, sensitive = false): string {
  if (sensitive) return 'redacted';
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

function statusClass(status: string): string {
  if (status === 'applied' || status === 'succeeded') return 'badge-success';
  if (status === 'failed' || status === 'blocked') return 'badge-danger';
  if (status === 'pending' || status === 'running' || status === 'stale') return 'badge-warning';
  return 'badge-neutral';
}

const SCOPE_OPTIONS: { value: RuntimeConfigScope; label: string; description: string }[] = [
  { value: 'global', label: 'Global', description: 'Default control-plane value' },
  { value: 'control_plane', label: 'Control plane', description: 'The apid control plane' },
  { value: 'daemon', label: 'Daemon', description: 'A deterministic daemon canary target' },
  { value: 'node', label: 'Node', description: 'One exact node target' },
];

function scopeLabel(scope: RuntimeConfigScope): string {
  return SCOPE_OPTIONS.find((option) => option.value === scope)?.label ?? scope;
}

function targetLabel(target: OperatorRuntimeConfigTarget): string {
  if (target.scope === 'global') return 'Global control plane';
  return `${scopeLabel(target.scope)} · ${target.scopeId || 'target required'}`;
}

function ackStatus(ack: OperatorRuntimeConfigAck, version: number): string {
  if (ack.status === 'applied' && ack.version < version) return 'stale';
  return ack.status;
}

function ackCounts(acks: OperatorRuntimeConfigAck[], version: number) {
  return acks.reduce(
    (counts, ack) => {
      const status = ackStatus(ack, version);
      counts.total += 1;
      if (status === 'applied') counts.applied += 1;
      if (status === 'failed') counts.failed += 1;
      if (status === 'stale') counts.stale += 1;
      return counts;
    },
    { total: 0, applied: 0, failed: 0, stale: 0 },
  );
}

function initialInput(item: OperatorRuntimeConfig): string {
  if (typeof item.desired_value === 'string') return item.desired_value;
  return String(item.desired_value);
}

function parseInput(item: OperatorRuntimeConfig, input: string): unknown {
  if (item.kind === 'boolean') return input === 'true';
  if (item.kind === 'integer') return Number(input);
  return input;
}

export default function RuntimeConfigurationPage() {
  const [target, setTarget] = useState<OperatorRuntimeConfigTarget>({ scope: 'global' });
  const [targetScope, setTargetScope] = useState<RuntimeConfigScope>('global');
  const [targetID, setTargetID] = useState('');
  const [rolloutPercent, setRolloutPercent] = useState('100');
  const config = useAsync(
    () => getOperatorRuntimeConfig(target.scope, target.scopeId),
    [target.scope, target.scopeId],
    30000,
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('Operator console runtime configuration change');
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [operation, setOperation] = useState<OperatorRuntimeConfigOperation | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [history, setHistory] = useState<OperatorRuntimeConfigRevision[]>([]);
  const [expandedAcks, setExpandedAcks] = useState<string | null>(null);

  const historyItem = config.data?.items.find((item) => item.key === historyKey);
  const supportsScopedRollouts = useMemo(
    () => (config.data?.items ?? []).some((item) => item.scope !== undefined),
    [config.data],
  );

  const convergence = useMemo(() => {
    const counts = { total: 0, applied: 0, failed: 0, stale: 0 };
    for (const item of config.data?.items ?? []) {
      const itemCounts = ackCounts(item.acks ?? [], item.version);
      counts.total += itemCounts.total;
      counts.applied += itemCounts.applied;
      counts.failed += itemCounts.failed;
      counts.stale += itemCounts.stale;
    }
    return counts;
  }, [config.data]);

  const groups = useMemo(() => {
    const grouped = new Map<string, OperatorRuntimeConfig[]>();
    for (const item of config.data?.items ?? []) {
      const list = grouped.get(item.category) ?? [];
      list.push(item);
      grouped.set(item.category, list);
    }
    return [...grouped.entries()];
  }, [config.data]);

  useEffect(() => {
    if (!operation || ['succeeded', 'failed', 'blocked', 'cancelled'].includes(operation.status)) return;
    const timer = window.setInterval(() => {
      getOperatorRuntimeConfigOperation(operation.id).then(setOperation).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [operation]);

  function selectScope(nextScope: RuntimeConfigScope) {
    setTargetScope(nextScope);
    if (nextScope === 'global') setTargetID('');
    if (nextScope === 'control_plane') setTargetID('apid');
  }

  function loadTarget() {
    if (targetScope !== 'global' && !supportsScopedRollouts) {
      setMessage('Scoped rollout controls are unavailable until the backend convergence API is deployed.');
      return;
    }
    const scopeID = targetScope === 'global' ? '' : targetID.trim();
    if (targetScope !== 'global' && !scopeID) {
      setMessage(`Enter a target identifier for the ${scopeLabel(targetScope).toLowerCase()} scope.`);
      return;
    }
    if (targetScope === 'control_plane' && scopeID !== 'apid') {
      setMessage('The control-plane target identifier must be apid.');
      return;
    }
    setMessage(null);
    setDrafts({});
    setOperation(null);
    setHistoryKey(null);
    setHistory([]);
    setExpandedAcks(null);
    setTarget({ scope: targetScope, ...(scopeID ? { scopeId: scopeID } : {}) });
  }

  async function save(item: OperatorRuntimeConfig) {
    const scopedDaemonTarget = target.scope === 'daemon' || target.scope === 'node';
    if (scopedDaemonTarget && item.apply_mode !== 'hot') {
      setMessage(`${item.label} cannot target a daemon or node because ${item.apply_mode} settings require a controller rollout.`);
      return;
    }
    const percent = target.scope === 'daemon' ? Number(rolloutPercent) : 100;
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      setMessage('Rollout percentage must be a whole number between 0 and 100.');
      return;
    }
    if (target.scope !== 'global' || percent < 100) {
      const rollout = target.scope === 'daemon' ? ` at ${percent}%` : '';
      if (!window.confirm(`Apply ${item.label} to ${targetLabel(target)}${rollout}? This change is audited and can be rolled back.`)) return;
    }
    setSaving(item.key);
    setMessage(null);
    try {
      const raw = drafts[item.key] ?? initialInput(item);
      const result = await updateOperatorRuntimeConfig(
        item.key,
        parseInput(item, raw),
        reason,
        item.version,
        target,
        percent,
      );
      if ('id' in result) {
        setOperation(result);
        setMessage(result.status === 'blocked'
          ? `${item.label} blocked: ${result.error ?? 'no controller is enabled for this apply mode.'}`
          : `${item.label} queued as operation ${result.id}.`);
      } else {
        setMessage(`${item.label} applied immediately.`);
      }
      config.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Configuration update failed.');
    } finally {
      setSaving(null);
    }
  }

  async function showHistory(key: string) {
    setHistoryKey(key);
    try {
      const response = await getOperatorRuntimeConfigRevisions(key, 20, target);
      setHistory(response.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load configuration history.');
    }
  }

  async function rollback(item: OperatorRuntimeConfig, revision: OperatorRuntimeConfigRevision) {
    if (!item.mutable || item.apply_mode !== 'hot' || revision.version >= item.version) return;
    if (!window.confirm(`Roll back ${item.label} on ${targetLabel(target)} to revision v${revision.version}? This creates a new live revision.`)) return;
    setSaving(`rollback:${item.key}:${revision.version}`);
    setMessage(null);
    try {
      await rollbackOperatorRuntimeConfig(
        item.key,
        revision.version,
        `Rollback from the operator console to v${revision.version}`,
        item.version,
        target,
      );
      setMessage(`${item.label} rolled back to v${revision.version} without restarting apid.`);
      await showHistory(item.key);
      config.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Configuration rollback failed.');
    } finally {
      setSaving(null);
    }
  }

  if (config.loading && !config.data) {
    return <div className="flex h-64 items-center justify-center"><Spinner size={24} /></div>;
  }

  if (config.error) {
    return (
      <div className="card p-8 text-center">
        <Icon name="shield" size={24} className="mx-auto text-[var(--color-danger)]" />
        <h2 className="mt-4 text-lg font-semibold">Operator access required</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{config.error.message}</p>
        <button type="button" onClick={config.reload} className="btn btn-secondary btn-sm mt-4">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Runtime Configuration"
        subtitle="Versioned platform settings with explicit desired/effective state and no SSH dependency."
        actions={<button type="button" onClick={config.reload} className="btn btn-secondary btn-sm"><Icon name="refresh" size={14} />Refresh</button>}
      />

      <div className="mb-6 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-sm">
        <div className="flex items-start gap-3">
          <Icon name="settings" size={18} className="mt-0.5 text-[var(--color-brand-bright)]" />
          <div>
            <div className="font-semibold">Safe change workflow</div>
            <p className="mt-1 text-[var(--color-ink-muted)]">
              Hot settings take effect immediately, and any earlier hot revision can be restored without restarting apid.
              Scoped daemon and node changes are acknowledged by the matching watcher, while graceful and rolling settings
              create a durable apply operation. Every write carries an operator reason, optimistic version, and idempotency key.
            </p>
          </div>
        </div>
      </div>

      <SectionCard
        title="Rollout target"
        className="mb-6"
        action={
          <span className={`badge ${target.scope === 'global' ? 'badge-neutral' : 'badge-info'}`}>
            {targetLabel(target)}
          </span>
        }
      >
        <div className="grid gap-4 p-4 md:grid-cols-[180px_1fr_150px_auto] md:items-end">
          <label className="text-xs">
            <span className="text-[var(--color-ink-muted)]">Scope</span>
            <select
              className="input mt-1 w-full"
              value={targetScope}
              onChange={(event) => selectScope(event.target.value as RuntimeConfigScope)}
            >
              {SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} disabled={option.value !== 'global' && !supportsScopedRollouts}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {targetScope === 'global' ? (
            <div className="text-xs text-[var(--color-ink-muted)]">
              <div>Target identifier</div>
              <div className="mt-1 font-mono text-[var(--color-ink)]">Not applicable</div>
            </div>
          ) : (
            <label className="text-xs">
              <span className="text-[var(--color-ink-muted)]">Target identifier</span>
              <input
                className="input mt-1 w-full"
                value={targetID}
                maxLength={128}
                readOnly={targetScope === 'control_plane'}
                placeholder={targetScope === 'daemon' ? 'e.g. gatewayd' : 'e.g. node-01'}
                onChange={(event) => setTargetID(event.target.value)}
              />
            </label>
          )}
          {targetScope === 'daemon' ? (
            <label className="text-xs">
              <span className="text-[var(--color-ink-muted)]">Canary rollout (%)</span>
              <input
                className="input mt-1 w-full"
                type="number"
                min={0}
                max={100}
                step={1}
                value={rolloutPercent}
                onChange={(event) => setRolloutPercent(event.target.value)}
              />
            </label>
          ) : (
            <div className="text-xs text-[var(--color-ink-muted)]">
              <div>Rollout</div>
              <div className="mt-1 font-mono text-[var(--color-ink)]">100% exact target</div>
            </div>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadTarget} disabled={config.loading && !config.data}>
            <Icon name="check" size={14} />
            Load target
          </button>
        </div>
        <div className="border-t border-[var(--color-line)] px-4 py-3 text-xs text-[var(--color-ink-muted)]">
          <div className="flex flex-wrap items-center gap-2">
            <span>Active target: <strong className="text-[var(--color-ink)]">{targetLabel(target)}</strong></span>
            {supportsScopedRollouts ? (
              <span className="badge badge-success">convergence reporting enabled</span>
            ) : (
              <span className="badge badge-warning">global API only</span>
            )}
            {supportsScopedRollouts && convergence.total > 0 && (
              <span>
                {convergence.applied}/{convergence.total} consumers applied
                {convergence.failed > 0 ? ` · ${convergence.failed} failed` : ''}
                {convergence.stale > 0 ? ` · ${convergence.stale} stale` : ''}
              </span>
            )}
          </div>
          {!supportsScopedRollouts && (
            <p className="mt-1">Scoped targeting is disabled until the backend convergence and rollout contract is deployed.</p>
          )}
        </div>
      </SectionCard>

      {message && <div className="mb-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm">{message}</div>}

      {operation && (
        <SectionCard title="Latest apply operation" className="mb-6" action={<span className={`badge ${statusClass(operation.status)}`}>{operation.status}</span>}>
          <div className="grid gap-3 p-4 text-sm sm:grid-cols-6">
            <div><div className="text-xs text-[var(--color-ink-muted)]">Setting</div><div className="font-mono">{operation.key}</div></div>
            <div><div className="text-xs text-[var(--color-ink-muted)]">Target</div><div>{scopeLabel(operation.scope)}{operation.scope_id ? ` · ${operation.scope_id}` : ''}</div></div>
            <div><div className="text-xs text-[var(--color-ink-muted)]">Mode</div><div>{operation.apply_mode}</div></div>
            <div><div className="text-xs text-[var(--color-ink-muted)]">Phase</div><div>{operation.phase}</div></div>
            <div><div className="text-xs text-[var(--color-ink-muted)]">Progress</div><div>{operation.applied_count}/{operation.target_count} applied{operation.failed_count ? ` · ${operation.failed_count} failed` : ''}</div></div>
            <div><div className="text-xs text-[var(--color-ink-muted)]">Operation</div><div className="truncate font-mono text-xs">{operation.id}</div></div>
          </div>
          {operation.error && <div className="border-t border-[var(--color-line)] px-4 py-3 text-sm text-[var(--color-danger)]">{operation.error}</div>}
        </SectionCard>
      )}

      <div className="space-y-6">
        {groups.map(([category, items]) => (
          <SectionCard key={category} title={category}>
            <div className="divide-y divide-[var(--color-line)]">
              {items.map((item) => {
                const draft = drafts[item.key] ?? initialInput(item);
                const itemScope = item.scope ?? target.scope;
                const itemScopeID = item.scope_id ?? target.scopeId;
                const itemRollout = item.rollout_percent ?? 100;
                const itemAcks = item.acks ?? [];
                const itemAckCounts = ackCounts(itemAcks, item.version);
                const ackKey = `${target.scope}:${target.scopeId ?? ''}:${item.key}`;
                const scopedControllerRequired = (target.scope === 'daemon' || target.scope === 'node') && item.apply_mode !== 'hot';
                const editable = item.mutable && !scopedControllerRequired;
                return (
                  <div key={item.key} className="grid gap-4 p-4 lg:grid-cols-[1fr_180px_180px_120px] lg:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{item.label}</span>
                        <span className={`badge ${statusClass(item.status)}`}>{item.status}</span>
                        <span className="badge badge-neutral">{item.apply_mode}</span>
                        {item.mutable && item.controller_enabled === false && <span className="badge badge-danger">controller unavailable</span>}
                      </div>
                      <div className="mt-1 text-xs text-[var(--color-ink-muted)]">{item.description}</div>
                      <div className="mt-2 text-[11px] text-[var(--color-ink-muted)]">
                        Effective: <span className="font-mono text-[var(--color-ink)]">{valueText(item.effective_value, item.sensitive)}</span>
                        {' · '}Source: {item.source}{item.version ? ` · v${item.version}` : ''}
                        {' · '}Target: {scopeLabel(itemScope)}{itemScopeID ? ` · ${itemScopeID}` : ''}{itemScope === 'daemon' ? ` · ${itemRollout}%` : ''}
                      </div>
                      {item.last_error && <div className="mt-1 text-xs text-[var(--color-danger)]">{item.last_error}</div>}
                      {supportsScopedRollouts && (
                        <div className="mt-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 text-[11px] font-semibold text-[var(--color-brand-bright)] hover:underline"
                            aria-expanded={expandedAcks === ackKey}
                            onClick={() => setExpandedAcks((current) => (current === ackKey ? null : ackKey))}
                          >
                            <span>Convergence</span>
                            {itemAcks.length === 0 ? (
                              <span className="badge badge-neutral">no reports</span>
                            ) : (
                              <span className={`badge ${itemAckCounts.failed > 0 ? 'badge-danger' : itemAckCounts.stale > 0 ? 'badge-warning' : 'badge-success'}`}>
                                {itemAckCounts.applied}/{itemAckCounts.total} applied
                              </span>
                            )}
                          </button>
                          {itemAcks.length > 0 && expandedAcks === ackKey && (
                            <div className="mt-2 space-y-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-2 text-[11px]">
                              {itemAcks.map((ack) => {
                                const status = ackStatus(ack, item.version);
                                return (
                                  <div key={`${ack.consumer}:${ack.node_id ?? ''}`} className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-[var(--color-ink)]">{ack.consumer}{ack.node_id ? ` · ${ack.node_id}` : ''}</span>
                                    <span className={`badge ${statusClass(status)}`}>{status}</span>
                                    <span className="text-[var(--color-ink-muted)]">v{ack.version} · {new Date(ack.updated_at).toLocaleString()}</span>
                                    {ack.error && <span className="text-[var(--color-danger)]">{ack.error}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      <button type="button" className="mt-2 text-[11px] font-semibold text-[var(--color-brand-bright)] hover:underline" onClick={() => showHistory(item.key)}>
                        View version history
                      </button>
                    </div>
                    <div className="text-xs">
                      <div className="text-[var(--color-ink-muted)]">Desired</div>
                      {item.kind === 'boolean' ? (
                        <select className="input mt-1 w-full" disabled={!editable} value={draft} onChange={(event) => setDrafts((old) => ({ ...old, [item.key]: event.target.value }))}>
                          <option value="true">true</option><option value="false">false</option>
                        </select>
                      ) : (
                        <input className="input mt-1 w-full" disabled={!editable} type={item.kind === 'integer' ? 'number' : 'text'} value={draft} onChange={(event) => setDrafts((old) => ({ ...old, [item.key]: event.target.value }))} />
                      )}
                    </div>
                    <div className="text-xs text-[var(--color-ink-muted)]">
                      <div>Default</div><div className="mt-1 font-mono text-[var(--color-ink)]">{valueText(item.default_value, item.sensitive)}</div>
                    </div>
                    <div className="flex justify-start lg:justify-end">
                      {editable ? (
                        <button type="button" className="btn btn-primary btn-sm" disabled={saving === item.key || !reason.trim()} onClick={() => save(item)}>
                          {saving === item.key ? <Spinner size={14} /> : 'Apply'}
                        </button>
                      ) : (
                        <span className="text-right text-[11px] text-[var(--color-ink-muted)]">
                          {scopedControllerRequired ? 'Hot setting required for scoped target' : 'Deployment managed'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        ))}
      </div>

      {historyKey && (
        <SectionCard title={`Version history · ${historyKey} · ${targetLabel(target)}`} className="mt-6" action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setHistoryKey(null)}>Close</button>}>
          {history.length === 0 ? <div className="p-4 text-sm text-[var(--color-ink-muted)]">No revisions recorded.</div> : (
            <div className="divide-y divide-[var(--color-line)]">
              {history.map((revision) => (
                <div key={revision.id} className="grid gap-2 p-4 text-xs sm:grid-cols-[80px_1fr_1fr_1fr_auto]">
                  <span className="font-mono font-semibold">v{revision.version}</span>
                  <span><span className="text-[var(--color-ink-muted)]">Old: </span><span className="font-mono">{valueText(revision.old_value, historyItem?.sensitive)}</span></span>
                  <span><span className="text-[var(--color-ink-muted)]">New: </span><span className="font-mono">{valueText(revision.new_value, historyItem?.sensitive)}</span></span>
                  <span className="text-[var(--color-ink-muted)]">
                    {revision.reason} · {scopeLabel(revision.scope)}{revision.scope_id ? ` · ${revision.scope_id}` : ''} · {revision.rollout_percent ?? 100}% · {new Date(revision.created_at).toLocaleString()}
                  </span>
                  <span>
                    {historyItem && historyItem.mutable && historyItem.apply_mode === 'hot' && revision.version < historyItem.version ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={saving === `rollback:${historyItem.key}:${revision.version}`}
                        onClick={() => rollback(historyItem, revision)}
                      >
                        {saving === `rollback:${historyItem.key}:${revision.version}` ? <Spinner size={14} /> : 'Rollback'}
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      <div className="mt-6 card p-4">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]" htmlFor="change-reason">Change reason</label>
        <input id="change-reason" className="input mt-2 w-full" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Every change is stored with the operator identity, reason, version, and apply outcome.</p>
      </div>
    </div>
  );
}
