'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  getOperatorRuntimeConfig,
  getOperatorRuntimeConfigOperation,
  getOperatorRuntimeConfigRevisions,
  rollbackOperatorRuntimeConfig,
  type OperatorRuntimeConfig,
  type OperatorRuntimeConfigOperation,
  type OperatorRuntimeConfigRevision,
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
  return JSON.stringify(value);
}

function statusClass(status: string): string {
  if (status === 'applied' || status === 'succeeded') return 'badge-success';
  if (status === 'failed' || status === 'blocked') return 'badge-danger';
  if (status === 'pending' || status === 'running') return 'badge-warning';
  return 'badge-neutral';
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
  const config = useAsync(getOperatorRuntimeConfig, [], 30000);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('Operator console runtime configuration change');
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [operation, setOperation] = useState<OperatorRuntimeConfigOperation | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [history, setHistory] = useState<OperatorRuntimeConfigRevision[]>([]);

  const historyItem = config.data?.items.find((item) => item.key === historyKey);

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

  async function save(item: OperatorRuntimeConfig) {
    setSaving(item.key);
    setMessage(null);
    try {
      const raw = drafts[item.key] ?? initialInput(item);
      const result = await updateOperatorRuntimeConfig(
        item.key,
        parseInput(item, raw),
        reason,
        item.version,
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
      const response = await getOperatorRuntimeConfigRevisions(key);
      setHistory(response.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load configuration history.');
    }
  }

  async function rollback(item: OperatorRuntimeConfig, revision: OperatorRuntimeConfigRevision) {
    if (!item.mutable || item.apply_mode !== 'hot' || revision.version >= item.version) return;
    if (!window.confirm(`Roll back ${item.label} to revision v${revision.version}? This creates a new live revision.`)) return;
    setSaving(`rollback:${item.key}:${revision.version}`);
    setMessage(null);
    try {
      await rollbackOperatorRuntimeConfig(item.key, revision.version, `Rollback from the operator console to v${revision.version}`, item.version);
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
              Graceful and rolling settings create a durable apply operation;
              the console reports pending or blocked rather than claiming a restart-free change succeeded.
              Bootstrap secrets and topology identity remain deployment-managed.
            </p>
          </div>
        </div>
      </div>

      {message && <div className="mb-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm">{message}</div>}

      {operation && (
        <SectionCard title="Latest apply operation" className="mb-6" action={<span className={`badge ${statusClass(operation.status)}`}>{operation.status}</span>}>
          <div className="grid gap-3 p-4 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-[var(--color-ink-muted)]">Setting</div><div className="font-mono">{operation.key}</div></div>
            <div><div className="text-xs text-[var(--color-ink-muted)]">Mode</div><div>{operation.apply_mode}</div></div>
            <div><div className="text-xs text-[var(--color-ink-muted)]">Phase</div><div>{operation.phase}</div></div>
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
                const editable = item.mutable;
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
                      </div>
                      {item.last_error && <div className="mt-1 text-xs text-[var(--color-danger)]">{item.last_error}</div>}
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
                      {editable ? <button type="button" className="btn btn-primary btn-sm" disabled={saving === item.key || !reason.trim()} onClick={() => save(item)}>{saving === item.key ? <Spinner size={14} /> : 'Apply'}</button> : <span className="text-right text-[11px] text-[var(--color-ink-muted)]">Deployment managed</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        ))}
      </div>

      {historyKey && (
        <SectionCard title={`Version history · ${historyKey}`} className="mt-6" action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setHistoryKey(null)}>Close</button>}>
          {history.length === 0 ? <div className="p-4 text-sm text-[var(--color-ink-muted)]">No revisions recorded.</div> : (
            <div className="divide-y divide-[var(--color-line)]">
              {history.map((revision) => (
                <div key={revision.id} className="grid gap-2 p-4 text-xs sm:grid-cols-[80px_1fr_1fr_1fr_auto]">
                  <span className="font-mono font-semibold">v{revision.version}</span>
                  <span><span className="text-[var(--color-ink-muted)]">Old: </span><span className="font-mono">{valueText(revision.old_value)}</span></span>
                  <span><span className="text-[var(--color-ink-muted)]">New: </span><span className="font-mono">{valueText(revision.new_value)}</span></span>
                  <span className="text-[var(--color-ink-muted)]">{revision.reason} · {new Date(revision.created_at).toLocaleString()}</span>
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
