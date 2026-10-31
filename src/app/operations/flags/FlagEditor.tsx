'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  getOperatorRuntimeConfig,
  getOperatorRuntimeConfigRevisions,
  type OperatorRuntimeConfigRevision,
  type Plan,
} from '@/lib/api';
import {
  getPlatformFlag,
  optInsConfigKey,
  writePlatformFlag,
  writePlatformFlagOptIns,
  type OperatorPlatformFlag,
  type OperatorPlatformFlagGroups,
  type PlatformFlagDefinition,
  type PlatformFlagOptIns,
  type PlatformFlagSelfServe,
} from '@/lib/ops/flags';
import {
  addGroupRule,
  allowAccount,
  CORE_FLAG_PROBLEM_TITLE,
  denyAccount,
  describeRule,
  diffDefinition,
  diffOptIns,
  editOptIns,
  expectedVersion,
  isUUID,
  moveRule,
  needsForce,
  normalizeDefinition,
  parseDefinitionJSON,
  PLANS,
  removeRule,
  resumeRamp,
  revokeAccount,
  setDefault,
  setRollout,
  setSelfServe,
  setSwitch,
  toOptIns,
  validateDefinition,
  validateOptIns,
  ROLLOUT_RULE_ID,
} from '@/lib/ops/flags-edit';
import { relativeTime } from '@/lib/format';
import { Mono } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { TenantLink } from '@/components/operator/TenantLink';
import { EntityId } from '@/components/operator/EntityId';

/** A draft remembers the version editing started from, so a concurrent change is a conflict, not an overwrite. */
export interface FlagDraft {
  def: PlatformFlagDefinition;
  baseVersion: number;
}

interface PendingApply {
  value: PlatformFlagDefinition;
  before: PlatformFlagDefinition;
  baseVersion: number;
  changes: string[];
}

export function convergenceBadge(flag: OperatorPlatformFlag) {
  const { pending, failed } = flag.convergence;
  if (failed.length) return <span className="badge badge-danger">failed: {failed.join(', ')}</span>;
  if (pending.length) return <span className="badge badge-warning">pending: {pending.join(', ')}</span>;
  return <span className="badge badge-success">converged</span>;
}

export function FlagEditor({
  summary,
  groups,
  draft,
  setDraft,
  onChanged,
  onClose,
}: {
  summary: OperatorPlatformFlag;
  groups: OperatorPlatformFlagGroups;
  draft: FlagDraft | undefined;
  setDraft: (draft: FlagDraft | undefined) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const flagKey = summary.key;

  // Detail fetch: a slow response for an earlier request never replaces a newer one.
  const detailSeq = useRef(0);
  const [detail, setDetail] = useState<{ key: string; data?: OperatorPlatformFlag; error?: string } | null>(null);
  const loadDetail = useCallback(async () => {
    const seq = ++detailSeq.current;
    try {
      const data = await getPlatformFlag(flagKey);
      if (seq === detailSeq.current) setDetail({ key: flagKey, data });
    } catch (err) {
      if (seq === detailSeq.current) setDetail((prev) => ({ key: flagKey, data: prev?.key === flagKey ? prev.data : undefined, error: (err as Error).message }));
    }
  }, [flagKey]);
  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const fresh = detail?.key === flagKey ? detail.data : undefined;
  // The polled list may be newer than the detail fetched on open; show whichever is newer.
  const current = fresh && fresh.version >= summary.version ? fresh : summary;
  const working = draft?.def ?? current.definition;
  const normalized = useMemo(() => normalizeDefinition(working), [working]);
  const errors = useMemo(
    () => validateDefinition(normalized, { groups: groups.groups, attributes: current.attributes }),
    [normalized, groups.groups, current.attributes],
  );
  const changes = useMemo(() => diffDefinition(current.definition, normalized, groups.groups), [current.definition, normalized, groups.groups]);
  const conflict = draft !== undefined && draft.baseVersion !== expectedVersion(current);
  const supportsPlan = current.attributes.includes('plan');
  const supportsOrg = current.attributes.includes('org');

  const edit = (next: PlatformFlagDefinition) =>
    setDraft({ def: next, baseVersion: draft?.baseVersion ?? expectedVersion(current) });

  /* Quick-edit inputs. */
  const [account, setAccount] = useState('');
  const [accountError, setAccountError] = useState<string | null>(null);
  const [groupChoice, setGroupChoice] = useState('');
  const [groupValue, setGroupValue] = useState<'on' | 'off'>('on');
  const existingRollout = working.rules?.find((rule) => rule.id === ROLLOUT_RULE_ID);
  const [rolloutPercent, setRolloutPercent] = useState(existingRollout?.rollout != null ? String(existingRollout.rollout / 100) : '');
  const [rolloutPlans, setRolloutPlans] = useState<Plan[]>(existingRollout?.plans ?? []);
  const [rolloutError, setRolloutError] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);
  const [showReceipts, setShowReceipts] = useState(false);

  const accountAction = (action: 'allow' | 'deny' | 'revoke') => {
    if (!isUUID(account)) {
      setAccountError('Enter an account UUID.');
      return;
    }
    setAccountError(null);
    edit({ allow: allowAccount, deny: denyAccount, revoke: revokeAccount }[action](working, account));
    setAccount('');
  };

  const applyRollout = () => {
    const percent = Number(rolloutPercent);
    if (rolloutPercent.trim() === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      setRolloutError('Rollout is a percentage between 0 and 100 (0 removes the rollout rule).');
      return;
    }
    setRolloutError(null);
    edit(setRollout(working, percent, supportsPlan ? rolloutPlans : []));
  };

  /* History. */
  const historySeq = useRef(0);
  const [history, setHistory] = useState<{ key: string; items?: OperatorRuntimeConfigRevision[]; error?: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const loadHistory = async () => {
    const seq = ++historySeq.current;
    setHistoryOpen(true);
    setHistory(null);
    try {
      const res = await getOperatorRuntimeConfigRevisions(current.config_key, 20);
      if (seq === historySeq.current) setHistory({ key: flagKey, items: res.items });
    } catch (err) {
      if (seq === historySeq.current) setHistory({ key: flagKey, error: (err as Error).message });
    }
  };
  const loadRevision = (revision: OperatorRuntimeConfigRevision) => {
    const parsed = parseDefinitionJSON(JSON.stringify(revision.new_value));
    if ('errors' in parsed) {
      setJsonErrors([`v${revision.version} no longer validates: ${parsed.errors.join('; ')}`]);
      return;
    }
    setJsonErrors([]);
    edit(parsed.value);
  };

  /* Apply dialog. */
  const [pending, setPending] = useState<PendingApply | null>(null);
  const [forceFrom409, setForceFrom409] = useState(false);
  const [force, setForce] = useState(false);
  const forceRequired = pending ? needsForce(current, pending.value) || forceFrom409 : false;
  const turningOff = pending ? pending.before.enabled && !pending.value.enabled : false;

  const openApply = () => {
    if (!draft) return;
    setForceFrom409(false);
    setForce(false);
    setPending({ value: normalized, before: current.definition, baseVersion: draft.baseVersion, changes });
  };

  return (
    <SectionCard
      title={
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="card-title">{current.label}</h2>
          <Mono>{current.key}</Mono>
          {current.maturity && <span className="badge badge-neutral">{current.maturity}</span>}
          {current.core && <span className="badge badge-danger">core</span>}
          {current.enforcement && <span className="badge badge-info">enforces {current.enforcement}</span>}
        </div>
      }
      action={
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadDetail()}>
            <Icon name="refresh" size={14} />
            Refresh
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-5 p-4 text-sm">
        {detail?.key === flagKey && detail.error && (
          <div role="alert" className="rounded-lg bg-[var(--color-danger-subtle)] p-2 text-xs text-[var(--color-danger)]">
            Could not refresh this flag: {detail.error}. Showing the {fresh ? 'last loaded' : 'list'} values.
          </div>
        )}

        <div>
          <p className="text-xs text-[var(--color-ink-muted)]">{current.description}</p>
          <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
            <Fact label="Capability" value={current.capability ? <Mono>{current.capability}</Mono> : '—'} />
            <Fact label="Parent" value={current.parent ? <Mono>{current.parent}</Mono> : '—'} />
            <Fact label="Decided by" value={current.consumers.join(', ')} />
            <Fact label="Rules may use" value={current.attributes.join(', ')} />
            <Fact label="Decision" value={current.adr} />
            <Fact label="Retire by" value={current.retire_by ?? '—'} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
            <span className={`badge ${current.status === 'applied' ? 'badge-success' : current.status === 'pending' ? 'badge-warning' : 'badge-danger'}`}>
              {current.status}
            </span>
            {convergenceBadge(current)}
            <span>
              {current.source === 'operator'
                ? `operator value v${current.version}${current.updated_at ? ` · ${relativeTime(current.updated_at)}` : ''}`
                : `boot fallback${current.legacy_env.length ? ` (${current.legacy_env.join(', ')})` : ' (catalog default)'}`}
            </span>
            <button type="button" className="font-semibold text-[var(--color-brand-bright)] hover:underline" onClick={() => setShowReceipts((open) => !open)}>
              Apply receipts ({current.receipts.length})
            </button>
          </div>
          {current.last_error && <div className="mt-1 text-xs text-[var(--color-danger)]">{current.last_error}</div>}
          {showReceipts && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--color-line)]">
              {current.receipts.length === 0 ? (
                <div className="p-3 text-xs text-[var(--color-ink-muted)]">No daemon has reported this flag yet.</div>
              ) : (
                <table className="dtable text-xs">
                  <thead>
                    <tr>
                      <th>Daemon</th>
                      <th>Instance</th>
                      <th>Version</th>
                      <th>Status</th>
                      <th>Reported</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.receipts.map((receipt) => {
                      const stale = receipt.status === 'applied' && receipt.version < current.version;
                      return (
                        <tr key={`${receipt.daemon}:${receipt.instance}`}>
                          <td className="cell-primary">{receipt.daemon}</td>
                          <td className="font-mono">{receipt.instance}</td>
                          <td className="font-mono">v{receipt.version}</td>
                          <td>
                            <span className={`badge ${receipt.status === 'failed' ? 'badge-danger' : stale ? 'badge-warning' : 'badge-success'}`}>
                              {stale ? 'stale' : receipt.status}
                            </span>
                            {receipt.error && <span className="ml-2 text-[var(--color-danger)]">{receipt.error}</span>}
                          </td>
                          <td>{relativeTime(receipt.reported_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* ───────────── Definition ───────────── */}
        <div className="rounded-lg border border-[var(--color-line)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Definition{draft ? ' (draft)' : ''}</span>
            <label className="flex items-center gap-2 text-xs">
              Kill switch
              <button
                type="button"
                className={`btn btn-xs ${working.enabled ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => edit(setSwitch(working, !working.enabled))}
              >
                {working.enabled ? 'On — turn off' : 'Off — turn on'}
              </button>
            </label>
            <label className="flex items-center gap-2 text-xs">
              Default for everyone else
              <select
                className="field field-sm"
                style={{ width: 'auto' }}
                value={String(working.default)}
                onChange={(event) => edit(setDefault(working, event.target.value === 'true'))}
              >
                <option value="false">off</option>
                <option value="true">on</option>
              </select>
            </label>
          </div>

          <div className="p-3">
            <div className="mb-2 text-xs text-[var(--color-ink-muted)]">
              Rules run top to bottom when the kill switch is on; the first match decides. Explicit denies and allows stay first.
            </div>
            {!working.rules?.length ? (
              <div className="text-xs text-[var(--color-ink-muted)]">No rules: every account gets the default.</div>
            ) : (
              <div className="overflow-x-auto rounded border border-[var(--color-line)]">
                <table className="dtable text-xs">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Rule</th>
                      <th>Sets</th>
                      <th>Targets</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {working.rules.map((rule, index, rules) => (
                      <tr key={`${rule.id}-${index}`}>
                        <td className="text-[var(--color-ink-muted)]">{index + 1}</td>
                        <td className="cell-primary font-mono">{rule.id}</td>
                        <td>
                          <span className={`badge ${rule.value === true ? 'badge-success' : rule.value === false ? 'badge-danger' : 'badge-warning'}`}>
                            {rule.value === true ? 'on' : rule.value === false ? 'off' : 'unset'}
                          </span>
                        </td>
                        <td title={[...(rule.accounts ?? []), ...(rule.orgs ?? [])].join('\n') || undefined}>
                          {describeRule(rule, groups.groups)}
                          {rule.ramp?.paused && rule.ramp.paused_reason && (
                            <div className="text-[var(--color-warning-bold)]">Ramp paused: {rule.ramp.paused_reason}</div>
                          )}
                        </td>
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            {rule.ramp?.paused && (
                              <button type="button" className="btn btn-secondary btn-xs" onClick={() => edit(resumeRamp(working, rule.id))}>
                                Resume ramp
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              aria-label={`Move ${rule.id} up`}
                              disabled={index === 0}
                              onClick={() => edit(moveRule(working, rule.id, -1))}
                            >
                              <Icon name="arrowUp" size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              aria-label={`Move ${rule.id} down`}
                              disabled={index === rules.length - 1}
                              onClick={() => edit(moveRule(working, rule.id, 1))}
                            >
                              <Icon name="arrowDown" size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              aria-label={`Remove ${rule.id}`}
                              onClick={() => edit(removeRule(working, rule.id))}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid gap-4 border-t border-[var(--color-line)] p-3 lg:grid-cols-3">
            <div>
              <div className="label">Account decision</div>
              <input
                className="field field-sm font-mono"
                placeholder="account UUID"
                value={account}
                spellCheck={false}
                onChange={(event) => setAccount(event.target.value)}
              />
              {accountError && <div className="mt-1 text-xs text-[var(--color-danger)]">{accountError}</div>}
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn btn-secondary btn-xs" onClick={() => accountAction('allow')}>
                  Allow
                </button>
                <button type="button" className="btn btn-secondary btn-xs" onClick={() => accountAction('deny')}>
                  Deny
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => accountAction('revoke')}>
                  Revoke
                </button>
              </div>
            </div>
            <div>
              <div className="label">Group rule</div>
              <div className="flex gap-2">
                <select className="field field-sm" value={groupChoice} onChange={(event) => setGroupChoice(event.target.value)}>
                  <option value="">choose a group</option>
                  {Object.keys(groups.groups)
                    .sort()
                    .map((name) => (
                      <option key={name} value={name}>
                        {name} ({groups.groups[name].length})
                      </option>
                    ))}
                </select>
                <select
                  className="field field-sm"
                  style={{ width: 'auto' }}
                  value={groupValue}
                  onChange={(event) => setGroupValue(event.target.value as 'on' | 'off')}
                >
                  <option value="on">on</option>
                  <option value="off">off</option>
                </select>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-xs mt-2"
                disabled={!groupChoice}
                onClick={() => edit(addGroupRule(working, groupChoice, groupValue === 'on'))}
              >
                Add group rule
              </button>
            </div>
            <div>
              <div className="label">Rollout</div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="field field-sm"
                  style={{ width: 90 }}
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  placeholder="%"
                  value={rolloutPercent}
                  onChange={(event) => setRolloutPercent(event.target.value)}
                />
                <span className="text-xs text-[var(--color-ink-muted)]">% of</span>
                {supportsPlan ? (
                  PLANS.map((plan) => (
                    <label key={plan} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={rolloutPlans.includes(plan)}
                        onChange={(event) =>
                          setRolloutPlans((plans) => (event.target.checked ? [...plans, plan] : plans.filter((p) => p !== plan)))
                        }
                      />
                      {plan}
                    </label>
                  ))
                ) : (
                  <span className="text-xs text-[var(--color-ink-muted)]">every account (plan is unknown where this flag is decided)</span>
                )}
              </div>
              {rolloutError && <div className="mt-1 text-xs text-[var(--color-danger)]">{rolloutError}</div>}
              <button type="button" className="btn btn-secondary btn-xs mt-2" onClick={applyRollout}>
                Set rollout
              </button>
              <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
                Stable hash per account: widening keeps everyone already in. No plan ticked means every plan.
              </p>
            </div>
          </div>

          <SelfServeEditor
            flag={current}
            working={working}
            supportsPlan={supportsPlan}
            onChange={(selfServe) => edit(setSelfServe(working, selfServe))}
          />

          <div className="border-t border-[var(--color-line)] p-3">
            <div className="flex flex-wrap gap-4 text-[11px] font-semibold text-[var(--color-brand-bright)]">
              <button
                type="button"
                className="hover:underline"
                onClick={() => {
                  setJsonErrors([]);
                  setJsonText((text) => (text === null ? JSON.stringify(working, null, 2) : null));
                }}
              >
                {jsonText === null ? 'Edit as JSON (orgs, windows, ramps)' : 'Close JSON editor'}
              </button>
              <button type="button" className="hover:underline" onClick={() => (historyOpen ? setHistoryOpen(false) : void loadHistory())}>
                {historyOpen ? 'Hide version history' : 'Version history'}
              </button>
            </div>
            {jsonText !== null && (
              <div className="mt-2">
                <textarea
                  className="field field-sm font-mono"
                  rows={Math.min(24, jsonText.split('\n').length + 1)}
                  spellCheck={false}
                  value={jsonText}
                  onChange={(event) => setJsonText(event.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-xs mt-2"
                  onClick={() => {
                    const parsed = parseDefinitionJSON(jsonText);
                    if ('errors' in parsed) setJsonErrors(parsed.errors);
                    else {
                      setJsonErrors([]);
                      edit(parsed.value);
                      setJsonText(JSON.stringify(parsed.value, null, 2));
                    }
                  }}
                >
                  Use this JSON as the draft
                </button>
              </div>
            )}
            {jsonErrors.length > 0 && (
              <ul role="alert" className="mt-2 list-disc pl-5 text-xs text-[var(--color-danger)]">
                {jsonErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
            {historyOpen && (
              <div className="mt-3 rounded border border-[var(--color-line)]">
                {!history || history.key !== flagKey ? (
                  <div className="p-3 text-xs text-[var(--color-ink-muted)]">Loading revisions…</div>
                ) : history.error ? (
                  <div role="alert" className="p-3 text-xs text-[var(--color-danger)]">
                    Could not load history: {history.error}
                  </div>
                ) : !history.items?.length ? (
                  <div className="p-3 text-xs text-[var(--color-ink-muted)]">No operator revisions yet: the flag runs its boot fallback.</div>
                ) : (
                  <div className="divide-y divide-[var(--color-line)]">
                    {history.items.map((revision) => (
                      <div key={revision.id} className="grid gap-2 p-3 text-xs sm:grid-cols-[60px_1fr_auto]">
                        <span className="font-mono font-semibold">v{revision.version}</span>
                        <span className="min-w-0 text-[var(--color-ink-muted)]">
                          {revision.reason} · {new Date(revision.created_at).toLocaleString()}
                          <pre className="mt-1 overflow-x-auto font-mono text-[var(--color-ink)]">{JSON.stringify(revision.new_value)}</pre>
                        </span>
                        <span>
                          {revision.version < current.version && (
                            <button type="button" className="btn btn-secondary btn-xs" onClick={() => loadRevision(revision)}>
                              Load into draft
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {draft && (
            <div className="space-y-2 border-t border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-3">
              {conflict && (
                <div role="alert" className="rounded bg-[var(--color-warning-subtle)] p-2 text-xs text-[var(--color-warning-bold)]">
                  Someone changed this flag (v{draft.baseVersion} → v{expectedVersion(current)}) while you were editing. Discard your
                  draft and review the new definition before applying.
                </div>
              )}
              {errors.length > 0 && (
                <ul role="alert" className="list-disc pl-5 text-xs text-[var(--color-danger)]">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
              {changes.length === 0 ? (
                <div className="text-xs text-[var(--color-ink-muted)]">The draft matches the live definition.</div>
              ) : (
                <ul className="list-disc pl-5 text-xs">
                  {changes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(undefined)}>
                  Discard draft
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={conflict || errors.length > 0 || changes.length === 0}
                  onClick={openApply}
                >
                  Review & apply…
                </button>
              </div>
            </div>
          )}
        </div>

        <OptInsPanel flag={current} supportsOrg={supportsOrg} />
      </div>

      {pending && (
        <OperatorActionDialog
          open
          title={`Apply ${current.label}`}
          tone={turningOff || forceRequired ? 'danger' : 'warning'}
          reason="text"
          confirmText={turningOff || forceRequired ? current.key : undefined}
          submitLabel="Apply flag change"
          canSubmit={!forceRequired || force}
          fingerprint={`flag|${current.config_key}|${pending.baseVersion}|${JSON.stringify(pending.value)}|${forceRequired && force}`}
          impact={
            <div className="space-y-2 text-xs">
              <p>
                Hot change: apid applies it immediately and {current.consumers.join(', ')} converge within seconds. Written against
                v{pending.baseVersion}; if the flag changed since, nothing is applied.
              </p>
              <ul className="list-disc pl-5">
                {pending.changes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          }
          onClose={() => setPending(null)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            try {
              const result = await writePlatformFlag(current, pending.value, reason, pending.baseVersion, {
                idempotencyKey,
                ...(forceRequired && force ? { force: true } : {}),
              });
              setDraft(undefined);
              onChanged();
              void loadDetail();
              if (historyOpen) void loadHistory();
              return 'phase' in result
                ? `${current.label}: change queued as operation ${result.id}.`
                : `${current.label} is now v${result.version}; consumers converge within seconds.`;
            } catch (err) {
              if (err instanceof ApiError && err.status === 409) {
                if (err.problem?.title === CORE_FLAG_PROBLEM_TITLE) setForceFrom409(true);
                else {
                  onChanged();
                  void loadDetail();
                }
              }
              throw err;
            }
          }}
        >
          {forceRequired && (
            <label className="flex items-start gap-2 rounded-lg border border-[#f5d5d5] bg-[var(--color-danger-subtle)] p-3 text-xs">
              <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
              <span>
                <strong>{current.key}</strong> releases the core <Mono>{current.capability ?? 'platform'}</Mono> capability. Leaving its
                kill switch or default off hides it from accounts. I understand and want to force this change.
              </span>
            </label>
          )}
        </OperatorActionDialog>
      )}
    </SectionCard>
  );
}

function SelfServeEditor({
  flag,
  working,
  supportsPlan,
  onChange,
}: {
  flag: OperatorPlatformFlag;
  working: PlatformFlagDefinition;
  supportsPlan: boolean;
  onChange: (selfServe: PlatformFlagSelfServe | null) => void;
}) {
  const selfServe = working.self_serve;
  return (
    <div className="border-t border-[var(--color-line)] p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="label mb-0">Self-serve preview</span>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!selfServe?.enabled}
            onChange={(event) => onChange({ ...(selfServe ?? {}), enabled: event.target.checked })}
          />
          customers may opt in
        </label>
        {supportsPlan && selfServe && (
          <span className="flex flex-wrap items-center gap-2">
            plans:
            {PLANS.map((plan) => (
              <label key={plan} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={selfServe.plans?.includes(plan) ?? false}
                  onChange={(event) => {
                    const plans = event.target.checked ? [...(selfServe.plans ?? []), plan] : (selfServe.plans ?? []).filter((p) => p !== plan);
                    onChange({ ...selfServe, plans: plans.length ? plans : undefined });
                  }}
                />
                {plan}
              </label>
            ))}
          </span>
        )}
        {selfServe && (
          <label className="flex items-center gap-1">
            max subjects
            <input
              className="field field-sm"
              style={{ width: 90 }}
              type="number"
              min={0}
              max={5000}
              value={selfServe.max_subjects ?? 0}
              onChange={(event) => onChange({ ...selfServe, max_subjects: Number(event.target.value) || undefined })}
            />
          </label>
        )}
        {selfServe && (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onChange(null)}>
            Remove block
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
        An opt-in applies only when no rule matched. Turning it off ignores existing opt-ins without deleting them.
        {flag.capability ? ' apid only accepts plans entitled to the capability.' : ''} Max 0 means the platform limit (5000).
      </p>
    </div>
  );
}

/** The opt-in row (platform_flag_opt_ins.<key>) is only readable through the runtime-config list. */
function OptInsPanel({ flag, supportsOrg }: { flag: OperatorPlatformFlag; supportsOrg: boolean }) {
  const configKey = optInsConfigKey(flag.key);
  const seq = useRef(0);
  const [loaded, setLoaded] = useState<{ key: string; value?: PlatformFlagOptIns; version?: number; error?: string } | null>(null);
  const [draft, setDraft] = useState<{ value: PlatformFlagOptIns; baseVersion: number } | null>(null);
  const [input, setInput] = useState('');
  const [kind, setKind] = useState<'account' | 'org'>('account');
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    const mine = ++seq.current;
    setLoaded({ key: configKey });
    try {
      const res = await getOperatorRuntimeConfig();
      const item = res.items.find((entry) => entry.key === configKey);
      if (mine !== seq.current) return;
      if (!item) setLoaded({ key: configKey, error: `apid does not list ${configKey}.` });
      else setLoaded({ key: configKey, value: toOptIns(item.desired_value), version: item.version });
    } catch (err) {
      if (mine === seq.current) setLoaded({ key: configKey, error: (err as Error).message });
    }
  };

  const live = loaded?.key === configKey ? loaded : null;
  const working = draft?.value ?? live?.value ?? {};
  const conflict = !!draft && live?.version !== undefined && draft.baseVersion !== live.version;
  const errors = validateOptIns(working, flag.attributes);
  const changes = live?.value ? diffOptIns(live.value, working) : [];

  const edit = (next: PlatformFlagOptIns) => setDraft({ value: next, baseVersion: draft?.baseVersion ?? live?.version ?? 0 });

  return (
    <div className="rounded-lg border border-[var(--color-line)] p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Opt-ins</span>
        <span className="text-[var(--color-ink-muted)]">
          {flag.opt_ins.accounts} account(s), {flag.opt_ins.orgs} organization(s) joined{flag.opt_ins.version ? ` · v${flag.opt_ins.version}` : ''}
        </span>
        <button type="button" className="btn btn-secondary btn-xs ml-auto" onClick={() => void load()}>
          {live ? 'Reload opt-ins' : 'Manage opt-ins'}
        </button>
      </div>
      {live && !live.value && !live.error && <div className="mt-2 text-[var(--color-ink-muted)]">Loading opt-ins…</div>}
      {live?.error && (
        <div role="alert" className="mt-2 text-[var(--color-danger)]">
          Could not load opt-ins: {live.error}
        </div>
      )}
      {live?.value && (
        <div className="mt-3 space-y-3">
          {(['accounts', 'orgs'] as const).map((field) => (
            <div key={field}>
              <div className="text-[var(--color-ink-muted)]">{field === 'accounts' ? 'Accounts' : 'Organizations'}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(working[field] ?? []).length === 0 && <span className="text-[var(--color-ink-muted)]">none</span>}
                {(working[field] ?? []).map((id) => (
                  <span key={id} className="inline-flex items-center gap-1">
                    {field === 'accounts' ? <TenantLink accountId={id} short /> : <EntityId id={id} chars={13} />}
                    <button
                      type="button"
                      aria-label={`Remove ${id}`}
                      className="text-[var(--color-ink-muted)] hover:text-[var(--color-danger)]"
                      onClick={() => edit(editOptIns(working, id, field === 'orgs' ? 'org' : 'account', false))}
                    >
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <select className="field field-sm" style={{ width: 'auto' }} value={kind} onChange={(event) => setKind(event.target.value as 'account' | 'org')}>
              <option value="account">account</option>
              {supportsOrg && <option value="org">organization</option>}
            </select>
            <input
              className="field field-sm font-mono"
              style={{ maxWidth: 340 }}
              placeholder="UUID"
              value={input}
              spellCheck={false}
              onChange={(event) => setInput(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => {
                if (!isUUID(input)) {
                  setInputError('Enter a UUID.');
                  return;
                }
                setInputError(null);
                edit(editOptIns(working, input, kind, true));
                setInput('');
              }}
            >
              Opt in
            </button>
            {inputError && <span className="text-[var(--color-danger)]">{inputError}</span>}
          </div>
          {draft && (
            <div className="space-y-2 rounded bg-[var(--color-surface-subtle)] p-2">
              {conflict && (
                <div role="alert" className="text-[var(--color-warning-bold)]">
                  The opt-ins changed (v{draft.baseVersion} → v{live.version}) while you were editing. Discard and reload.
                </div>
              )}
              {errors.map((error) => (
                <div key={error} role="alert" className="text-[var(--color-danger)]">
                  {error}
                </div>
              ))}
              <ul className="list-disc pl-5">
                {changes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setDraft(null)}>
                  Discard
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  disabled={conflict || errors.length > 0 || changes.length === 0}
                  onClick={() => setConfirming(true)}
                >
                  Review & apply…
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {confirming && draft && live?.value && (
        <OperatorActionDialog
          open
          title={`Change ${flag.label} opt-ins`}
          tone="warning"
          reason="text"
          submitLabel="Apply opt-ins"
          fingerprint={`optins|${configKey}|${draft.baseVersion}|${JSON.stringify(draft.value)}`}
          impact={
            <div className="space-y-2 text-xs">
              <p>
                Opt-ins decide only for accounts no rule matched, and only while self-serve is enabled
                {flag.definition.self_serve?.enabled ? '' : ' (it is currently off, so this has no effect until it is turned on)'}.
              </p>
              <ul className="list-disc pl-5">
                {changes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          }
          onClose={() => setConfirming(false)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const result = await writePlatformFlagOptIns(flag.key, draft.value, reason, draft.baseVersion, { idempotencyKey });
            setDraft(null);
            void load();
            return `${flag.label} opt-ins are now v${result.version}.`;
          }}
        />
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[var(--color-ink-muted)]">{label}</div>
      <div className="truncate">{value}</div>
    </div>
  );
}
