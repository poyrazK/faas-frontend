'use client';

import React, { useState } from 'react';
import {
  ApiError,
  forceParkInstance,
  forceRestartInstance,
  forceColdBootApp,
  sweepStuckBuilds,
  getObsBuilderHeartbeats,
  getRekeyProgress,
  setGithubWebhookSecret,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { formatBytes, REASON_SUGGESTIONS } from '@/lib/operator';
import { PageHeader, Mono } from '@/components/ui/bits';
import { StatTile, SectionCard } from '@/components/ui/Panels';
import { Icon, type IconName } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import {
  IntentStatusBadge,
  intentOutcome,
  isTerminalIntent,
  useOperatorIntents,
} from '@/components/operator/OperatorIntents';

type ActionId = 'park' | 'restart' | 'cold-boot' | 'sweep' | 'webhook';

const ACTIONS: { id: ActionId; title: string; icon: IconName; summary: string; tone: 'danger' | 'warning' | 'default' }[] = [
  {
    id: 'park',
    title: 'Force-park a microVM',
    icon: 'bolt',
    summary: 'Captures and stops one live instance. The customer’s next request wakes it from the snapshot.',
    tone: 'warning',
  },
  {
    id: 'restart',
    title: 'Force-restart a microVM',
    icon: 'refresh',
    summary: 'Terminates one RUNNING instance and marks its snapshots stale; the next wake cold boots.',
    tone: 'danger',
  },
  {
    id: 'cold-boot',
    title: 'Force cold boot for an app',
    icon: 'spark',
    summary: 'Invalidates warm and init snapshots for every instance of an app; next wakes cold boot.',
    tone: 'warning',
  },
  {
    id: 'sweep',
    title: 'Sweep stuck builds',
    icon: 'trash',
    summary: 'Fails builds stuck in running longer than a threshold so the queue can drain.',
    tone: 'warning',
  },
  {
    id: 'webhook',
    title: 'Rotate GitHub webhook secret',
    icon: 'keys',
    summary: 'Replaces the encrypted webhook secret for one GitHub App installation.',
    tone: 'default',
  },
];

const SWEEP_THRESHOLDS = ['1m', '5m', '15m', '30m', '60m'];

export default function OperatorControlsPage() {
  const builderQuery = useAsync(getObsBuilderHeartbeats, [], 15000);
  const rekeyQuery = useAsync(getRekeyProgress, [], 30000);
  const { intents, track, dismiss, clearFinished } = useOperatorIntents();

  const [open, setOpen] = useState<ActionId | null>(null);
  const [target, setTarget] = useState('');
  const [sweepThreshold, setSweepThreshold] = useState('15m');
  const [installationId, setInstallationId] = useState('');
  const [secretHex, setSecretHex] = useState('');

  const openAction = (id: ActionId) => {
    setTarget('');
    setInstallationId('');
    setSecretHex('');
    setSweepThreshold('15m');
    setOpen(id);
  };

  const builderData = builderQuery.data;
  const rekeyDisabled = rekeyQuery.error instanceof ApiError && rekeyQuery.error.code === 'rekey_disabled';
  const rekeyData = rekeyQuery.data;
  const inFlight = intents.filter((intent) => !isTerminalIntent(intent.status)).length;

  const parsedInstallation = Number(installationId.trim());
  const installationValid = Number.isSafeInteger(parsedInstallation) && parsedInstallation > 0;
  const secretValid = /^[0-9a-fA-F]{32,128}$/.test(secretHex.trim());

  const action = ACTIONS.find((a) => a.id === open);

  return (
    <div>
      <PageHeader
        title="Recovery & Fleet Controls"
        subtitle="Emergency primitives for live microVMs, apps, builds and integrations. Every action is audited."
        actions={
          <button
            onClick={() => {
              builderQuery.reload();
              rekeyQuery.reload();
            }}
            className="btn btn-secondary btn-sm"
          >
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Queued builds"
          value={builderQuery.error ? '—' : (builderData?.queued_builds ?? '…')}
          sub={builderQuery.error ? `Unavailable: ${builderQuery.error.message}` : 'Waiting for a builder'}
        />
        <StatTile
          label="Reporting builders"
          value={builderQuery.error ? '—' : (builderData?.items.length ?? '…')}
          sub={builderQuery.error ? 'Builder telemetry unavailable' : 'Heartbeat within the last hour'}
        />
        <StatTile
          label="Secrets rekey"
          value={
            rekeyDisabled ? 'Off' : rekeyQuery.error ? '—' : rekeyData ? `${rekeyData.rekeyed} / ${rekeyData.total}` : '…'
          }
          sub={
            rekeyDisabled
              ? 'Rekey runner is not enabled'
              : rekeyQuery.error
                ? `Unavailable: ${rekeyQuery.error.message}`
                : rekeyData
                  ? `${rekeyData.skipped} skipped · ${rekeyData.failed} failed`
                  : 'Loading'
          }
        />
        <StatTile label="Tracked actions" value={intents.length} sub={`${inFlight} still converging`} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ACTIONS.map((a) => (
          <div key={a.id} className="card flex flex-col justify-between p-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon
                  name={a.icon}
                  size={16}
                  className={
                    a.tone === 'danger'
                      ? 'text-[var(--color-danger)]'
                      : a.tone === 'warning'
                        ? 'text-[var(--color-warning)]'
                        : 'text-[var(--color-ink-soft)]'
                  }
                />
                {a.title}
              </div>
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{a.summary}</p>
            </div>
            <div className="mt-4">
              <button className="btn btn-secondary btn-sm" onClick={() => openAction(a.id)}>
                {a.title.split(' ')[0]}…
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <SectionCard
          title="Operator actions in flight"
          action={
            intents.some((intent) => isTerminalIntent(intent.status)) ? (
              <button className="btn btn-ghost btn-xs" onClick={clearFinished}>
                Clear finished
              </button>
            ) : undefined
          }
        >
          {intents.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
              Actions you start from any operations page are tracked here until they finish.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Requested</th>
                    <th>Result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {intents.map((intent) => (
                    <tr key={intent.intentId}>
                      <td className="font-mono">{intent.kind}</td>
                      <td className="font-mono">
                        <Mono>{intent.target}</Mono>
                      </td>
                      <td>
                        <IntentStatusBadge status={intent.status} />
                      </td>
                      <td title={intent.intentId}>{relativeTime(intent.requestedAt)}</td>
                      <td
                        className={
                          intent.status === 'failed' || intent.pollError ? 'text-[var(--color-danger)]' : undefined
                        }
                      >
                        {intentOutcome(intent)}
                      </td>
                      <td className="text-right">
                        <button className="btn btn-ghost btn-xs" onClick={() => dismiss(intent.intentId)}>
                          Dismiss
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard title="Builder hosts">
          {builderQuery.error && !builderData ? (
            <div role="alert" className="p-6 text-center text-xs text-[var(--color-danger)]">
              Could not load builder telemetry: {builderQuery.error.message}
            </div>
          ) : builderQuery.loading && !builderData ? (
            <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">Loading builder telemetry…</div>
          ) : !builderData?.items.length ? (
            <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
              No builder host has reported in the last hour.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Builder node</th>
                    <th>Last heartbeat</th>
                    <th>CPU (60s)</th>
                    <th>Disk used</th>
                  </tr>
                </thead>
                <tbody>
                  {builderData.items.map((b) => (
                    <tr key={b.node_id}>
                      <td className="cell-primary font-mono">{b.node_id}</td>
                      <td>{relativeTime(b.received_at)}</td>
                      <td className="font-mono">{b.cpu_pct_60s == null ? '—' : `${b.cpu_pct_60s.toFixed(1)}%`}</td>
                      <td className="font-mono">{formatBytes(b.disk_used_bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {action && (
        <OperatorActionDialog
          open
          title={action.title}
          tone={action.tone}
          reason={action.id === 'webhook' ? 'none' : 'code'}
          reasonSuggestions={action.id === 'sweep' ? REASON_SUGGESTIONS.build : REASON_SUGGESTIONS.instance}
          submitLabel={
            action.id === 'park'
              ? 'Force park'
              : action.id === 'restart'
                ? 'Force restart'
                : action.id === 'cold-boot'
                  ? 'Force cold boot'
                  : action.id === 'sweep'
                    ? 'Sweep builds'
                    : 'Rotate secret'
          }
          confirmText={action.id === 'restart' || action.id === 'cold-boot' ? target.trim() || undefined : undefined}
          canSubmit={
            action.id === 'webhook'
              ? installationValid && secretValid
              : action.id === 'sweep'
                ? true
                : target.trim().length > 0
          }
          fingerprint={[action.id, target.trim(), sweepThreshold, installationId.trim(), secretHex.trim()].join('|')}
          impact={<span>{action.summary}</span>}
          onClose={() => setOpen(null)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const opts = { idempotencyKey };
            const id = target.trim();
            switch (action.id) {
              case 'park': {
                const res = await forceParkInstance(id, reason, opts);
                track({ intentId: res.intent_id, kind: 'force_park', target: id });
                return `Force park queued for ${id}.`;
              }
              case 'restart': {
                const res = await forceRestartInstance(id, reason, opts);
                track({ intentId: res.intent_id, kind: 'force_restart', target: id });
                return `Force restart queued for ${id}.`;
              }
              case 'cold-boot': {
                const res = await forceColdBootApp(id, reason, opts);
                track({ intentId: res.intent_id, kind: 'force_cold_boot', target: id });
                return `Cold boot queued for ${id}.`;
              }
              case 'sweep': {
                const res = await sweepStuckBuilds(sweepThreshold, reason, opts);
                builderQuery.reload();
                return `Swept ${res.swept_count} build(s) older than ${res.older_than_seconds}s.`;
              }
              case 'webhook': {
                const res = await setGithubWebhookSecret(parsedInstallation, secretHex.trim(), opts);
                setSecretHex('');
                return `Webhook secret rotated for installation ${res.installation_id}.`;
              }
            }
          }}
        >
          {(action.id === 'park' || action.id === 'restart') && (
            <label className="block">
              <span className="label">Instance ID</span>
              <input
                className="field field-sm font-mono"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="550e8400-e29b-41d4-a716-446655440000"
                autoComplete="off"
              />
            </label>
          )}
          {action.id === 'cold-boot' && (
            <label className="block">
              <span className="label">App slug</span>
              <input
                className="field field-sm font-mono"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="payment-processor"
                autoComplete="off"
              />
            </label>
          )}
          {action.id === 'sweep' && (
            <label className="block">
              <span className="label">Stuck for longer than</span>
              <select
                className="field field-sm"
                value={sweepThreshold}
                onChange={(event) => setSweepThreshold(event.target.value)}
              >
                {SWEEP_THRESHOLDS.map((threshold) => (
                  <option key={threshold} value={threshold}>
                    {threshold}
                  </option>
                ))}
              </select>
            </label>
          )}
          {action.id === 'webhook' && (
            <div className="grid gap-3">
              <label className="block">
                <span className="label">Installation ID</span>
                <input
                  className="field field-sm font-mono"
                  inputMode="numeric"
                  value={installationId}
                  onChange={(event) => setInstallationId(event.target.value.replace(/\D/g, ''))}
                  placeholder="12345678"
                />
              </label>
              <label className="block">
                <span className="label">New secret (32–128 hex characters)</span>
                <input
                  type="password"
                  className="field field-sm font-mono"
                  value={secretHex}
                  onChange={(event) => setSecretHex(event.target.value)}
                  autoComplete="new-password"
                />
                {secretHex && !secretValid && (
                  <span className="mt-1 block text-xs text-[var(--color-danger)]">
                    Must be 32–128 hexadecimal characters.
                  </span>
                )}
              </label>
            </div>
          )}
        </OperatorActionDialog>
      )}
    </div>
  );
}
