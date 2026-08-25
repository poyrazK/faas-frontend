'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  forceParkInstance,
  forceColdBootApp,
  sweepStuckBuilds,
  getOperatorIntent,
  getObsBuilderHeartbeats,
  getRekeyProgress,
  type ObsBuilderHeartbeatListResponse,
  type RekeyProgressResponse,
  type SweepStuckBuildsResponse,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono } from '@/components/ui/bits';
import { StatTile, SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

interface ActiveIntentItem {
  intentId: string;
  kind: string;
  targetId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  requestedAt: string;
  error?: string | null;
  snapIdsMarkedStale?: string[];
}

export default function OperatorControlsPage() {
  // Telemetry queries
  const builderQuery = useAsync(getObsBuilderHeartbeats, [], 15000);
  const rekeyQuery = useAsync(getRekeyProgress, [], 30000);

  // Intent tracker state
  const [activeIntents, setActiveIntents] = useState<ActiveIntentItem[]>([]);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Form states: Force Park
  const [parkInstanceId, setParkInstanceId] = useState('');
  const [parkReason, setParkReason] = useState('operator_force_park');
  const [parkLoading, setParkLoading] = useState(false);
  const [parkFeedback, setParkFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Form states: Force Cold Boot
  const [bootSlug, setBootSlug] = useState('');
  const [bootReason, setBootReason] = useState('operator_force_cold_boot');
  const [bootLoading, setBootLoading] = useState(false);
  const [bootFeedback, setBootFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Form states: Sweep Stuck Builds
  const [sweepDuration, setSweepDuration] = useState('15m');
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepResult, setSweepResult] = useState<SweepStuckBuildsResponse | null>(null);
  const [sweepError, setSweepError] = useState<string | null>(null);

  // Poll pending intents
  useEffect(() => {
    const pending = activeIntents.filter(
      (i) => i.status === 'pending' || i.status === 'running',
    );
    if (pending.length === 0) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }

    pollingRef.current = setInterval(async () => {
      for (const item of pending) {
        try {
          const res = await getOperatorIntent(item.intentId);
          setActiveIntents((prev) =>
            prev.map((i) =>
              i.intentId === item.intentId
                ? {
                    ...i,
                    status: res.status,
                    error: res.error,
                    snapIdsMarkedStale: res.snap_ids_marked_stale,
                  }
                : i,
            ),
          );
        } catch {
          /* ignore poll errors */
        }
      }
    }, 1500);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeIntents]);

  const handleForcePark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parkInstanceId.trim()) return;
    setParkLoading(true);
    setParkFeedback(null);
    try {
      const res = await forceParkInstance(parkInstanceId.trim(), parkReason.trim());
      setParkFeedback({
        ok: true,
        msg: `Intent enqueued (ID: ${res.intent_id}). Scheduling microVM park.`,
      });
      setActiveIntents((prev) => [
        {
          intentId: res.intent_id,
          kind: 'force_park',
          targetId: parkInstanceId.trim(),
          status: 'pending',
          requestedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setParkInstanceId('');
    } catch (err) {
      setParkFeedback({ ok: false, msg: (err as Error).message });
    } finally {
      setParkLoading(false);
    }
  };

  const handleForceColdBoot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bootSlug.trim()) return;
    setBootLoading(true);
    setBootFeedback(null);
    try {
      const res = await forceColdBootApp(bootSlug.trim(), bootReason.trim());
      setBootFeedback({
        ok: true,
        msg: `Intent enqueued (ID: ${res.intent_id}). Marking snapshots stale for app.`,
      });
      setActiveIntents((prev) => [
        {
          intentId: res.intent_id,
          kind: 'force_cold_boot',
          targetId: bootSlug.trim(),
          status: 'pending',
          requestedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setBootSlug('');
    } catch (err) {
      setBootFeedback({ ok: false, msg: (err as Error).message });
    } finally {
      setBootLoading(false);
    }
  };

  const handleSweepBuilds = async (e: React.FormEvent) => {
    e.preventDefault();
    setSweepLoading(true);
    setSweepResult(null);
    setSweepError(null);
    try {
      const res = await sweepStuckBuilds(sweepDuration);
      setSweepResult(res);
      builderQuery.reload();
    } catch (err) {
      setSweepError((err as Error).message);
    } finally {
      setSweepLoading(false);
    }
  };

  const builderData: ObsBuilderHeartbeatListResponse | null = builderQuery.data || null;
  const rekeyData: RekeyProgressResponse | null = rekeyQuery.data || null;

  return (
    <div>
      <PageHeader
        title="Recovery & Fleet Controls"
        subtitle="Operator emergency primitives, microVM park/cold-boot interventions, stuck build reclamation, and intent tracking"
        actions={
          <button
            onClick={() => {
              builderQuery.reload();
              rekeyQuery.reload();
            }}
            className="btn btn-secondary btn-sm"
          >
            <Icon name="refresh" size={14} />
            Refresh Telemetry
          </button>
        }
      />

      {/* Top Telemetry KPI Bar */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Queued Build Tasks"
          value={builderData?.queued_builds ?? 0}
          sub="In-flight builderd job backlog"
          color="var(--color-brand-bright)"
        />
        <StatTile
          label="Active Builder Nodes"
          value={builderData?.items ? builderData.items.length : 0}
          sub="Heartbeating builderd hosts (1h)"
        />
        <StatTile
          label="Secrets Rekey Engine"
          value={
            rekeyData?.enabled
              ? `${rekeyData.completed} / ${rekeyData.total}`
              : 'Disabled'
          }
          sub={
            rekeyData?.enabled
              ? `${rekeyData.in_progress} in progress · ${rekeyData.failed} failed`
              : 'FAAS_REKEY_ENABLED flag off'
          }
        />
        <StatTile
          label="Tracked Operator Actions"
          value={activeIntents.length}
          sub={`${activeIntents.filter((i) => i.status === 'pending' || i.status === 'running').length} in-flight intents`}
        />
      </div>

      {/* Operator Intervention Controls */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Force-Park MicroVM Instance */}
        <SectionCard
          title={
            <div className="flex items-center gap-2">
              <Icon name="bolt" size={16} className="text-[var(--color-warning)]" />
              <span>Force-Park Live MicroVM</span>
            </div>
          }
        >
          <div className="p-4 text-xs text-[var(--color-ink-muted)]">
            Asynchronously triggers scheduler eviction to park a stuck or runaway microVM instance.
            Requires exact instance UUID.
          </div>
          <form onSubmit={handleForcePark} className="border-t border-[var(--color-line)] p-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">Instance UUID</label>
              <input
                type="text"
                required
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                value={parkInstanceId}
                onChange={(e) => setParkInstanceId(e.target.value)}
                className="field field-sm w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Reason Token (a-z0-9_)</label>
              <input
                type="text"
                required
                pattern="^[a-z0-9_]{1,64}$"
                placeholder="operator_force_park"
                value={parkReason}
                onChange={(e) => setParkReason(e.target.value)}
                className="field field-sm w-full font-mono text-xs"
              />
            </div>
            {parkFeedback && (
              <div
                className={`rounded p-2 text-xs ${
                  parkFeedback.ok
                    ? 'bg-[var(--color-surface-subtle)] text-[var(--color-brand-bright)]'
                    : 'bg-[var(--color-danger-subtle)] text-[var(--color-danger)]'
                }`}
              >
                {parkFeedback.msg}
              </div>
            )}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={parkLoading || !parkInstanceId.trim()}
                className="btn btn-danger btn-sm"
              >
                {parkLoading ? 'Dispatching…' : 'Confirm Force Park'}
              </button>
            </div>
          </form>
        </SectionCard>

        {/* Force Cold Boot Next Wake */}
        <SectionCard
          title={
            <div className="flex items-center gap-2">
              <Icon name="spark" size={16} className="text-[var(--color-brand-bright)]" />
              <span>Force Cold Boot Next Wake</span>
            </div>
          }
        >
          <div className="p-4 text-xs text-[var(--color-ink-muted)]">
            Marks warm and init snapshots stale for an application deployment. Forces the next request
            wake to execute a clean cold boot.
          </div>
          <form onSubmit={handleForceColdBoot} className="border-t border-[var(--color-line)] p-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">Application Slug</label>
              <input
                type="text"
                required
                placeholder="e.g. payment-processor"
                value={bootSlug}
                onChange={(e) => setBootSlug(e.target.value)}
                className="field field-sm w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Reason Token (a-z0-9_)</label>
              <input
                type="text"
                required
                pattern="^[a-z0-9_]{1,64}$"
                placeholder="operator_force_cold_boot"
                value={bootReason}
                onChange={(e) => setBootReason(e.target.value)}
                className="field field-sm w-full font-mono text-xs"
              />
            </div>
            {bootFeedback && (
              <div
                className={`rounded p-2 text-xs ${
                  bootFeedback.ok
                    ? 'bg-[var(--color-surface-subtle)] text-[var(--color-brand-bright)]'
                    : 'bg-[var(--color-danger-subtle)] text-[var(--color-danger)]'
                }`}
              >
                {bootFeedback.msg}
              </div>
            )}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={bootLoading || !bootSlug.trim()}
                className="btn btn-warning btn-sm"
              >
                {bootLoading ? 'Invalidating Snapshots…' : 'Force Cold Boot App'}
              </button>
            </div>
          </form>
        </SectionCard>
      </div>

      {/* Sweep Stuck Builds */}
      <div className="mt-6">
        <SectionCard
          title={
            <div className="flex items-center gap-2">
              <Icon name="trash" size={16} className="text-[var(--color-danger)]" />
              <span>Sweep Stuck Builderd Tasks</span>
            </div>
          }
        >
          <div className="p-4 text-xs text-[var(--color-ink-muted)]">
            Reclaims and terminates build tasks stuck in &apos;running&apos; state exceeding the duration threshold.
            Closes build pipeline bottlenecks when builder microVMs crash or exceed timeout.
          </div>
          <form
            onSubmit={handleSweepBuilds}
            className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-line)] p-4"
          >
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold">Older Than Threshold:</label>
              <select
                value={sweepDuration}
                onChange={(e) => setSweepDuration(e.target.value)}
                className="field field-sm"
              >
                <option value="1m">1 minute (aggressive sweep)</option>
                <option value="5m">5 minutes</option>
                <option value="15m">15 minutes (default reaper grace)</option>
                <option value="30m">30 minutes</option>
                <option value="60m">60 minutes (1 hour ceiling)</option>
              </select>
            </div>

            <button type="submit" disabled={sweepLoading} className="btn btn-secondary btn-sm">
              {sweepLoading ? 'Sweeping Builds…' : `Sweep Builds (> ${sweepDuration})`}
            </button>
          </form>

          {sweepResult && (
            <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-4 text-xs">
              <div className="flex items-center gap-2 text-[var(--color-brand-bright)] font-semibold">
                <Icon name="check" size={14} />
                <span>Successfully swept {sweepResult.swept_count} stuck build(s).</span>
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
                Threshold cutoff: {new Date(sweepResult.threshold_iso).toLocaleTimeString()} · Older than {sweepResult.older_than_secs}s
              </div>
            </div>
          )}

          {sweepError && (
            <div className="border-t border-[var(--color-line)] bg-[var(--color-danger-subtle)] p-4 text-xs text-[var(--color-danger)]">
              {sweepError}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Active Operator Intent Execution Monitor */}
      <div className="mt-6">
        <SectionCard title="Active Operator Intent Execution Queue">
          {activeIntents.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
              No operator recovery intents triggered in this session.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="px-4 py-3">Intent ID</th>
                    <th className="px-4 py-3">Action Kind</th>
                    <th className="px-4 py-3">Target Object</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Triggered</th>
                    <th className="px-4 py-3">Result / Diagnostics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {activeIntents.map((item) => (
                    <tr key={item.intentId} className="hover:bg-[var(--color-surface-subtle)]">
                      <td className="px-4 py-3 font-mono font-semibold">
                        <Mono>{item.intentId.slice(0, 13)}…</Mono>
                      </td>
                      <td className="px-4 py-3 font-mono uppercase">{item.kind}</td>
                      <td className="px-4 py-3 font-mono">{item.targetId}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge ${
                            item.status === 'succeeded'
                              ? 'badge-success'
                              : item.status === 'failed'
                              ? 'badge-danger'
                              : item.status === 'running'
                              ? 'badge-warning'
                              : 'badge-neutral'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-ink-muted)]">
                        {relativeTime(item.requestedAt)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {item.error ? (
                          <span className="text-[var(--color-danger)] font-mono">{item.error}</span>
                        ) : item.snapIdsMarkedStale && item.snapIdsMarkedStale.length > 0 ? (
                          <span className="text-[var(--color-brand-bright)] font-mono">
                            {item.snapIdsMarkedStale.length} snapshot(s) marked stale
                          </span>
                        ) : item.status === 'succeeded' ? (
                          <span className="text-[var(--color-brand-bright)]">Execution completed</span>
                        ) : (
                          <span className="text-[var(--color-ink-muted)] italic">Awaiting worker dispatch…</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Builder Fleet Heartbeats Telemetry */}
      <div className="mt-6">
        <SectionCard title="Builderd Fleet Host Heartbeats (Obs)">
          {builderQuery.loading && !builderData ? (
            <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
              Loading builderd fleet telemetry…
            </div>
          ) : !builderData?.items || builderData.items.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
              No builder nodes currently reporting heartbeat ticks (Queue Depth: {builderData?.queued_builds ?? 0}).
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="px-4 py-3">Builder Host Node ID</th>
                    <th className="px-4 py-3">Last Heartbeat</th>
                    <th className="px-4 py-3">CPU (60s Avg)</th>
                    <th className="px-4 py-3">Disk Utilization</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {builderData.items.map((b) => (
                    <tr key={b.node_id} className="hover:bg-[var(--color-surface-subtle)]">
                      <td className="px-4 py-3 font-mono font-semibold">{b.node_id}</td>
                      <td className="px-4 py-3 text-[var(--color-ink-muted)]">
                        {relativeTime(b.received_at)}
                      </td>
                      <td className="px-4 py-3 font-mono">{b.cpu_pct_60s.toFixed(1)}%</td>
                      <td className="px-4 py-3 font-mono">
                        {(b.disk_used_bytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
