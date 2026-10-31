'use client';

import React, { useMemo, useState } from 'react';
import {
  EMPTY_ENROLLMENT,
  draftFromNode,
  enrollComputeNode,
  enrollmentChanges,
  enrollmentLifecycleEffect,
  validateEnrollment,
  type ComputeNode,
  type EnrollmentDraft,
} from '@/lib/ops/nodes';
import { formatMegabytes } from '@/lib/operator';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';

const ENROLL_REASONS = ['new_capacity', 'node_replacement', 'address_change', 'capacity_rebalance', 'planned_maintenance'] as const;

/**
 * Enroll a new compute node, or edit an enrolled one (same upsert). apid
 * rewrites the node's lifecycle on every enrollment, so the dialog shows the
 * lifecycle the save will leave behind and refuses while a drain is running.
 */
export function EnrollNodeDialog({
  editing,
  enrolled,
  onClose,
  onDone,
}: {
  /** The node being edited; null to enroll a new one. */
  editing: ComputeNode | null;
  /** Every enrolled node, to catch a "new" name that already exists. */
  enrolled: ComputeNode[];
  onClose: () => void;
  onDone: (node: ComputeNode) => void;
}) {
  const [draft, setDraft] = useState<EnrollmentDraft>(() => (editing ? draftFromNode(editing) : EMPTY_ENROLLMENT));
  const [touched, setTouched] = useState<Set<keyof EnrollmentDraft>>(new Set());
  const { body, errors } = useMemo(() => validateEnrollment(draft), [draft]);

  // A "new" node whose name is already enrolled is an update of that node.
  const existing = editing ?? enrolled.find((node) => node.name === draft.name.trim()) ?? null;
  const lifecycle = existing ? enrollmentLifecycleEffect(existing, draft.defer_activation) : null;
  const changes = existing && body ? enrollmentChanges(existing, body) : [];

  const set = <K extends keyof EnrollmentDraft>(key: K, value: EnrollmentDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set(current).add(key));
  };
  const error = (key: keyof EnrollmentDraft) => (touched.has(key) ? errors[key] : undefined);

  const field = (key: keyof EnrollmentDraft, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="field field-sm font-mono"
        value={draft[key] as string}
        onChange={(event) => set(key, event.target.value as never)}
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
      {error(key) ? (
        <span className="mt-1 block text-xs text-[var(--color-danger)]">{error(key)}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">{hint}</span>
      ) : null}
    </label>
  );

  const isUpdate = !!existing;
  const title = isUpdate ? `Edit enrollment: ${existing.name}` : 'Enroll a compute node';

  return (
    <OperatorActionDialog
      open
      title={title}
      tone={lifecycle?.changes && lifecycle.after === 'active' ? 'warning' : 'default'}
      reason="code"
      reasonSuggestions={ENROLL_REASONS}
      submitLabel={isUpdate ? 'Save enrollment' : 'Enroll node'}
      canSubmit={!!body && !lifecycle?.blocked}
      fingerprint={JSON.stringify(body)}
      impact={
        <div className="space-y-1.5 text-xs">
          {!isUpdate ? (
            <p>
              Registers a new host with the control plane. vmmd fills in its overlay IP and starts heartbeating when it
              boots.{' '}
              {draft.defer_activation
                ? 'It stays out of placement (unavailable) until you activate it from the node panel.'
                : 'The scheduler can place customer workloads on it as soon as it heartbeats.'}
            </p>
          ) : (
            <p>
              Updates node <strong>{existing.name}</strong>. Region, zone, role, release and host certificate are kept.
            </p>
          )}
          {lifecycle?.blocked && <p className="font-semibold text-[var(--color-danger)]">{lifecycle.blocked}</p>}
          {lifecycle && !lifecycle.blocked && lifecycle.changes && (
            <p className="font-semibold text-[var(--color-warning-bold)]">
              Saving changes its lifecycle from {existing!.lifecycle} to {lifecycle.after}
              {lifecycle.after === 'active' ? ' — the scheduler will start placing workloads on it.' : '.'}
            </p>
          )}
          {isUpdate && changes.length > 0 && (
            <ul className="list-inside list-disc font-mono text-[11px] text-[var(--color-ink-soft)]">
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          )}
          {isUpdate && body && changes.length === 0 && <p className="text-[var(--color-ink-muted)]">No changes yet.</p>}
        </div>
      }
      onClose={onClose}
      onSubmit={async ({ reason, idempotencyKey }) => {
        if (!body) throw new Error('Fix the highlighted fields first.');
        const node = await enrollComputeNode(body, reason, { idempotencyKey });
        onDone(node);
        return isUpdate ? `Enrollment of ${node.name} saved (${node.lifecycle}).` : `Node ${node.name} enrolled (${node.lifecycle}).`;
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field('name', 'Node name', { readOnly: !!editing, placeholder: 'node-d' })}
        {field('target_url', 'vmmd target', { placeholder: 'tcp://10.8.0.5:7001' }, 'unix:///path or tcp://host:port')}
        {field('schedd_target_url', 'schedd target (optional)', { placeholder: 'tcp://10.8.0.5:7002' }, editing ? 'Empty keeps the current value' : 'tcp://host:port')}
        {field('gateway_target_url', 'Metrics scrape target (optional)', { placeholder: 'tcp://10.8.0.5:9100' }, 'tcp://host:port reachable from the control plane')}
        {field('vpcpus', 'vCPUs', { inputMode: 'numeric', placeholder: '16' })}
        {field('mem_mb', 'Memory (MB)', { inputMode: 'numeric', placeholder: '65536' }, draft.mem_mb && !errors.mem_mb ? formatMegabytes(Number(draft.mem_mb)) : undefined)}
        {field('max_concurrency', 'Max concurrent microVMs', { inputMode: 'numeric', placeholder: '200' })}
        {field(
          'admission_ceiling_mb',
          'Admission ceiling (MB)',
          { inputMode: 'numeric', placeholder: '55705' },
          'RAM the scheduler may commit to microVMs; keep headroom below total memory',
        )}
      </div>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={draft.defer_activation}
          onChange={(event) => set('defer_activation', event.target.checked)}
        />
        <span>
          Keep out of placement (enroll as <span className="font-mono">unavailable</span>) until activated
        </span>
      </label>
    </OperatorActionDialog>
  );
}
