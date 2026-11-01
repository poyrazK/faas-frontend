'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  getOperatorRuntimeConfig,
  getOperatorRuntimeConfigOperation,
  getOperatorRuntimeConfigRevisions,
  rollbackOperatorRuntimeConfig,
  updateOperatorRuntimeConfig,
  type OperatorRuntimeConfig,
  type OperatorRuntimeConfigOperation,
  type OperatorRuntimeConfigRevision,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { Icon } from '@/components/ui/Icons';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Spinner } from '@/components/ui/States';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';

const JSON_KINDS = new Set(['platform_flag', 'platform_flag_groups', 'platform_flag_opt_ins']);
const TERMINAL_OPERATION = new Set(['succeeded', 'failed', 'blocked', 'cancelled']);

function valueText(value: unknown, sensitive = false): string {
  if (sensitive) return 'redacted';
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

function statusClass(status: string): string {
  if (status === 'applied' || status === 'succeeded') return 'badge-success';
  if (status === 'failed' || status === 'blocked') return 'badge-danger';
  if (status === 'pending' || status === 'running') return 'badge-warning';
  return 'badge-neutral';
}

function editableText(item: OperatorRuntimeConfig): string {
  if (JSON_KINDS.has(item.kind)) return JSON.stringify(item.desired_value ?? null, null, 2);
  if (typeof item.desired_value === 'string') return item.desired_value;
  return String(item.desired_value);
}

/** Parses the operator's text into the value the backend expects, or explains why it can't. */
function parseDraft(item: OperatorRuntimeConfig, input: string): { value: unknown } | { error: string } {
  if (item.kind === 'boolean') return { value: input === 'true' };
  if (item.kind === 'integer') {
    const n = Number(input);
    return Number.isSafeInteger(n) ? { value: n } : { error: 'Enter a whole number.' };
  }
  if (JSON_KINDS.has(item.kind)) {
    try {
      return { value: JSON.parse(input) };
    } catch (err) {
      return { error: `Invalid JSON: ${(err as Error).message}` };
    }
  }
  return { value: input };
}

/** A draft remembers the version it was started from, so a concurrent change is a conflict, not an overwrite. */
interface Draft {
  text: string;
  baseVersion: number;
}

type PendingChange =
  | { type: 'apply'; item: OperatorRuntimeConfig; value: unknown; baseVersion: number }
  | { type: 'rollback'; item: OperatorRuntimeConfig; revision: OperatorRuntimeConfigRevision };

export default function RuntimeConfigurationPage() {
  const config = useAsync(getOperatorRuntimeConfig, [], 30000);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [needsForce, setNeedsForce] = useState(false);
  const [force, setForce] = useState(false);
  const [operation, setOperation] = useState<OperatorRuntimeConfigOperation | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [history, setHistory] = useState<{ key: string; items?: OperatorRuntimeConfigRevision[]; error?: string } | null>(null);
  const historySeq = useRef(0);

  const items = useMemo(() => config.data?.items ?? [], [config.data]);
  const groups = useMemo(() => {
    const grouped = new Map<string, OperatorRuntimeConfig[]>();
    for (const item of items) grouped.set(item.category, [...(grouped.get(item.category) ?? []), item]);
    return [...grouped.entries()];
  }, [items]);
  const historyItem = items.find((item) => item.key === historyKey);
  const visibleHistory = history && history.key === historyKey ? history : null;

  useEffect(() => {
    if (!operation || TERMINAL_OPERATION.has(operation.status)) return;
    const timer = window.setInterval(() => {
      getOperatorRuntimeConfigOperation(operation.id)
        .then((next) => {
          setOperation(next);
          setOperationError(null);
        })
        .catch((err: Error) => setOperationError(err.message));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [operation]);

  const loadHistory = async (key: string) => {
    const seq = ++historySeq.current;
    setHistoryKey(key);
    setHistory(null);
    try {
      const res = await getOperatorRuntimeConfigRevisions(key, 20);
      if (seq === historySeq.current) setHistory({ key, items: res.items });
    } catch (err) {
      if (seq === historySeq.current) setHistory({ key, error: (err as Error).message });
    }
  };

  const startEdit = (item: OperatorRuntimeConfig, text: string) => {
    setDrafts((current) => ({
      ...current,
      [item.key]: { text, baseVersion: current[item.key]?.baseVersion ?? item.version },
    }));
  };

  const discard = (key: string) =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

  const openChange = (change: PendingChange) => {
    setNeedsForce(false);
    setForce(false);
    setPending(change);
  };

  if (config.loading && !config.data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (config.error && !config.data) {
    return (
      <div className="card p-8 text-center">
        <Icon name="shield" size={24} className="mx-auto text-[var(--color-danger)]" />
        <h2 className="mt-4 text-lg font-semibold">Could not load runtime configuration</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{config.error.message}</p>
        <button type="button" onClick={config.reload} className="btn btn-secondary btn-sm mt-4">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Runtime configuration"
        subtitle="Platform settings with desired and effective values. Every change is audited and can be rolled back."
        actions={
          <button type="button" onClick={config.reload} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />

      {config.error && (
        <div role="alert" className="mb-4 rounded-lg bg-[var(--color-danger-subtle)] p-3 text-sm text-[var(--color-danger)]">
          Refresh failed: {config.error.message}. Showing the last loaded values.
        </div>
      )}

      {operation && (
        <SectionCard
          title="Latest apply operation"
          className="mb-6"
          action={<span className={`badge ${statusClass(operation.status)}`}>{operation.status}</span>}
        >
          <div className="grid gap-3 p-4 text-sm sm:grid-cols-5">
            <Fact label="Setting" value={<span className="font-mono">{operation.key}</span>} />
            <Fact label="Mode" value={operation.apply_mode} />
            <Fact label="Phase" value={operation.phase} />
            <Fact
              label="Progress"
              value={`${operation.applied_count}/${operation.target_count} applied${operation.failed_count ? ` · ${operation.failed_count} failed` : ''}`}
            />
            <Fact label="Operation" value={<span className="truncate font-mono text-xs">{operation.id}</span>} />
          </div>
          {(operation.error || operationError) && (
            <div className="border-t border-[var(--color-line)] px-4 py-3 text-sm text-[var(--color-danger)]">
              {operation.error ?? `Status check failing: ${operationError}`}
            </div>
          )}
        </SectionCard>
      )}

      <div className="space-y-6">
        {groups.map(([category, groupItems]) => (
          <SectionCard key={category} title={category}>
            <div className="divide-y divide-[var(--color-line)]">
              {groupItems.map((item) => {
                const draft = drafts[item.key];
                const text = draft?.text ?? editableText(item);
                const parsed = parseDraft(item, text);
                const dirty = draft !== undefined && draft.text !== editableText(item);
                const conflict = draft !== undefined && draft.baseVersion !== item.version;
                const isJson = JSON_KINDS.has(item.kind);
                return (
                  <div
                    key={item.key}
                    className={`grid gap-4 p-4 ${isJson ? '' : 'lg:grid-cols-[1fr_220px_180px_auto] lg:items-start'}`}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{item.label}</span>
                        <span className={`badge ${statusClass(item.status)}`}>{item.status}</span>
                        <span className="badge badge-neutral">{item.apply_mode}</span>
                        {item.mutable && !item.controller_enabled && (
                          <span className="badge badge-danger">controller unavailable</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-[var(--color-ink-muted)]">{item.description}</div>
                      <div className="mt-2 text-[11px] text-[var(--color-ink-muted)]">
                        Effective:{' '}
                        <span className="font-mono text-[var(--color-ink)]">
                          {valueText(item.effective_value, item.sensitive)}
                        </span>
                        {' · '}
                        {item.source === 'operator' ? 'set by an operator' : 'default or environment'}
                        {item.version ? ` · v${item.version}` : ''}
                      </div>
                      {item.last_error && <div className="mt-1 text-xs text-[var(--color-danger)]">{item.last_error}</div>}
                      {conflict && (
                        <div role="alert" className="mt-2 rounded bg-[var(--color-warning-subtle)] p-2 text-xs text-[var(--color-warning-bold)]">
                          Someone changed this setting (v{draft.baseVersion} → v{item.version}) while you were editing.
                          Discard your edit and review the new value before applying.
                        </div>
                      )}
                      <button
                        type="button"
                        className="mt-2 text-[11px] font-semibold text-[var(--color-brand-bright)] hover:underline"
                        onClick={() => loadHistory(item.key)}
                      >
                        Version history
                      </button>
                    </div>

                    <div className="text-xs">
                      <div className="text-[var(--color-ink-muted)]">Desired</div>
                      {item.kind === 'boolean' ? (
                        <select
                          className="field field-sm mt-1"
                          disabled={!item.mutable}
                          value={text}
                          onChange={(event) => startEdit(item, event.target.value)}
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : isJson ? (
                        <textarea
                          className="field field-sm mt-1 font-mono"
                          rows={Math.min(16, text.split('\n').length + 1)}
                          disabled={!item.mutable}
                          value={text}
                          spellCheck={false}
                          onChange={(event) => startEdit(item, event.target.value)}
                        />
                      ) : (
                        <input
                          className="field field-sm mt-1"
                          disabled={!item.mutable}
                          type={item.kind === 'integer' ? 'number' : 'text'}
                          value={item.sensitive && !draft ? '' : text}
                          placeholder={item.sensitive ? 'redacted — enter a new value' : undefined}
                          onChange={(event) => startEdit(item, event.target.value)}
                        />
                      )}
                      {dirty && 'error' in parsed && <div className="mt-1 text-[var(--color-danger)]">{parsed.error}</div>}
                    </div>

                    {!isJson && (
                      <div className="text-xs text-[var(--color-ink-muted)]">
                        <div>Default</div>
                        <div className="mt-1 font-mono text-[var(--color-ink)]">
                          {valueText(item.default_value, item.sensitive)}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 lg:justify-end">
                      {!item.mutable ? (
                        <span className="text-[11px] text-[var(--color-ink-muted)]">Deployment managed</span>
                      ) : (
                        <>
                          {draft && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => discard(item.key)}>
                              Discard
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={!dirty || conflict || 'error' in parsed}
                            onClick={() =>
                              'value' in parsed &&
                              draft &&
                              openChange({ type: 'apply', item, value: parsed.value, baseVersion: draft.baseVersion })
                            }
                          >
                            Review & apply
                          </button>
                        </>
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
        <SectionCard
          title={`Version history · ${historyItem?.label ?? historyKey}`}
          className="mt-6"
          action={
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHistoryKey(null)}>
              Close
            </button>
          }
        >
          {!visibleHistory ? (
            <div className="p-4 text-sm text-[var(--color-ink-muted)]">Loading revisions…</div>
          ) : visibleHistory.error ? (
            <div role="alert" className="p-4 text-sm text-[var(--color-danger)]">
              Could not load history: {visibleHistory.error}
            </div>
          ) : !visibleHistory.items?.length ? (
            <div className="p-4 text-sm text-[var(--color-ink-muted)]">No revisions recorded.</div>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {visibleHistory.items.map((revision) => (
                <div key={revision.id} className="grid gap-2 p-4 text-xs sm:grid-cols-[70px_1fr_1fr_1fr_auto]">
                  <span className="font-mono font-semibold">v{revision.version}</span>
                  <span>
                    <span className="text-[var(--color-ink-muted)]">Old: </span>
                    <span className="font-mono">{valueText(revision.old_value, historyItem?.sensitive)}</span>
                  </span>
                  <span>
                    <span className="text-[var(--color-ink-muted)]">New: </span>
                    <span className="font-mono">{valueText(revision.new_value, historyItem?.sensitive)}</span>
                  </span>
                  <span className="text-[var(--color-ink-muted)]">
                    {revision.reason} · {new Date(revision.created_at).toLocaleString()}
                  </span>
                  <span>
                    {historyItem?.mutable && historyItem.apply_mode === 'hot' && revision.version < historyItem.version && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => openChange({ type: 'rollback', item: historyItem, revision })}
                      >
                        Roll back…
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {pending && (
        <OperatorActionDialog
          open
          title={pending.type === 'apply' ? `Apply ${pending.item.label}` : `Roll back ${pending.item.label}`}
          tone={pending.item.category === 'Platform flags' || pending.item.apply_mode === 'break_glass' ? 'danger' : 'warning'}
          reason="text"
          submitLabel={pending.type === 'apply' ? 'Apply change' : `Roll back to v${pending.revision.version}`}
          fingerprint={`${pending.type}|${pending.item.key}|${force}`}
          impact={
            <div className="space-y-2 text-xs">
              <p>
                {pending.item.apply_mode === 'hot'
                  ? 'Takes effect immediately across the platform.'
                  : `Applied by the ${pending.item.apply_mode} controller as a tracked operation.`}
              </p>
              <div className="grid gap-1 font-mono">
                <span>
                  <span className="text-[var(--color-ink-muted)]">from </span>
                  {valueText(pending.item.desired_value, pending.item.sensitive)}
                </span>
                <span>
                  <span className="text-[var(--color-ink-muted)]">to&nbsp;&nbsp; </span>
                  {pending.type === 'apply'
                    ? valueText(pending.value, pending.item.sensitive)
                    : valueText(pending.revision.new_value, pending.item.sensitive)}
                </span>
              </div>
            </div>
          }
          onClose={() => setPending(null)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const opts = { idempotencyKey, force };
            try {
              const result =
                pending.type === 'apply'
                  ? await updateOperatorRuntimeConfig(pending.item.key, pending.value, reason, pending.baseVersion, opts)
                  : await rollbackOperatorRuntimeConfig(
                      pending.item.key,
                      pending.revision.version,
                      reason,
                      pending.item.version,
                      opts,
                    );
              discard(pending.item.key);
              config.reload();
              if (historyKey === pending.item.key) void loadHistory(pending.item.key);
              if ('phase' in result) {
                setOperation(result);
                return result.status === 'blocked'
                  ? `${pending.item.label} blocked: ${result.error ?? 'no controller is enabled for this apply mode.'}`
                  : `${pending.item.label} queued as operation ${result.id}.`;
              }
              return `${pending.item.label} applied.`;
            } catch (err) {
              if (err instanceof ApiError && err.status === 409 && err.problem?.title === 'Core capability flag') {
                setNeedsForce(true);
              }
              throw err;
            }
          }}
        >
          {needsForce && (
            <label className="flex items-start gap-2 rounded-lg border border-[#f5d5d5] bg-[var(--color-danger-subtle)] p-3 text-xs">
              <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
              <span>
                This turns off a core capability for every account. I understand and want to force the change.
              </span>
            </label>
          )}
        </OperatorActionDialog>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--color-ink-muted)]">{label}</div>
      <div>{value}</div>
    </div>
  );
}
