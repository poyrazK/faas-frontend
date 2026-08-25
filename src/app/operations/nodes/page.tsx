'use client';

import React, { useState } from 'react';
import {
  listObsNodes,
  getObsNodeHeartbeats,
  getObsWakeLatencies,
  getObsBuilderHeartbeats,
  type ObsNodeRow,
  type ObsHeartbeatListResponse,
  type ObsWakeLatencyRow,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';

export default function ComputeNodesPage() {
  const { data, loading, error, reload } = useAsync(listObsNodes);
  const wakeQuery = useAsync(() => getObsWakeLatencies(24), [], 30000);
  const builderQuery = useAsync(getObsBuilderHeartbeats, [], 30000);

  // Heartbeat drawer state
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);
  const [hbData, setHbData] = useState<ObsHeartbeatListResponse | null>(null);
  const [hbLoading, setHbLoading] = useState(false);

  const openHeartbeatDrawer = async (nodeName: string) => {
    setSelectedNodeName(nodeName);
    setHbLoading(true);
    setHbData(null);
    try {
      const res = await getObsNodeHeartbeats(nodeName, 30);
      setHbData(res);
    } catch {
      /* error */
    } finally {
      setHbLoading(false);
    }
  };

  const handleRefreshAll = () => {
    reload();
    wakeQuery.reload();
    builderQuery.reload();
  };

  return (
    <div>
      <PageHeader
        title="Compute Host Nodes"
        subtitle="Bare-metal control plane host inventory, vCPU/RAM allocations, wake latency percentiles, and heartbeat telemetry"
        actions={
          <button onClick={handleRefreshAll} className="btn btn-secondary btn-sm">
            <Icon name="refresh" size={14} />
            Refresh All
          </button>
        }
      />

      {/* Compute Host Inventory */}
      <SectionCard title="Host Compute Nodes">
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            Loading Host Nodes…
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-[var(--color-danger)]">
            {error.message || 'Operator access required to list compute nodes.'}
          </div>
        ) : !data?.items || data.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
            No compute host nodes registered in control plane.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">Host Node Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">vCPUs</th>
                  <th className="px-4 py-3">RAM Capacity</th>
                  <th className="px-4 py-3">Admission Ceiling</th>
                  <th className="px-4 py-3">Max Concurrency</th>
                  <th className="px-4 py-3">Overlay IP</th>
                  <th className="px-4 py-3">Last Heartbeat</th>
                  <th className="px-4 py-3 text-right">Telemetry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {data.items.map((node: ObsNodeRow) => (
                  <tr key={node.id} className="hover:bg-[var(--color-surface-subtle)]">
                    <td className="px-4 py-3 font-semibold">
                      <div className="flex items-center gap-2">
                        <Icon name="storage" size={14} className="text-[var(--color-brand-bright)]" />
                        <span>{node.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${node.active ? 'badge-success' : 'badge-neutral'}`}>
                        {node.active ? 'Active Host' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono">{node.vpcpus} vCPUs</td>
                    <td className="px-4 py-3 font-mono">{(node.mem_mb / 1024).toFixed(1)} GB</td>
                    <td className="px-4 py-3 font-mono text-[var(--color-brand-bright)]">
                      {(node.admission_ceiling_mb / 1024).toFixed(1)} GB (85%)
                    </td>
                    <td className="px-4 py-3 font-mono">{node.max_concurrency} VMs</td>
                    <td className="px-4 py-3 font-mono text-[var(--color-ink-muted)]">
                      {node.overlay_ip || '—'}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ink-muted)]">
                      {node.last_heartbeat_at ? relativeTime(node.last_heartbeat_at) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openHeartbeatDrawer(node.name)}
                        className="btn btn-secondary btn-xs"
                      >
                        Heartbeats
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Wake Latency Quantiles */}
      <div className="mt-6">
        <SectionCard
          title={
            <div className="flex items-center justify-between">
              <span>Wake Latency Quantiles (24h Rolling)</span>
              <span className="text-xs font-normal text-[var(--color-ink-muted)]">
                Target: &lt; 350 ms p50
              </span>
            </div>
          }
        >
          {wakeQuery.loading && !wakeQuery.data ? (
            <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
              Measuring per-node wake latencies…
            </div>
          ) : !wakeQuery.data?.items || wakeQuery.data.items.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
              No wake latency samples recorded in the last 24h window.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="px-4 py-3">Host Node</th>
                    <th className="px-4 py-3">p50 Latency</th>
                    <th className="px-4 py-3">p95 Latency</th>
                    <th className="px-4 py-3">p99 Latency</th>
                    <th className="px-4 py-3">Total Samples</th>
                    <th className="px-4 py-3">SLO Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {wakeQuery.data.items.map((w: ObsWakeLatencyRow) => (
                    <tr key={w.node} className="hover:bg-[var(--color-surface-subtle)]">
                      <td className="px-4 py-3 font-semibold">{w.node}</td>
                      <td className="px-4 py-3 font-mono font-bold text-[var(--color-brand-bright)]">
                        {w.p50_ms.toFixed(0)} ms
                      </td>
                      <td className="px-4 py-3 font-mono">{w.p95_ms.toFixed(0)} ms</td>
                      <td className="px-4 py-3 font-mono">{w.p99_ms.toFixed(0)} ms</td>
                      <td className="px-4 py-3 font-mono">{w.sample_count}</td>
                      <td className="px-4 py-3">
                        <span className={`badge ${w.p50_ms <= 350 ? 'badge-success' : 'badge-warning'}`}>
                          {w.p50_ms <= 350 ? 'Within SLO (<350ms)' : 'Elevated Latency'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Node Heartbeat Telemetry Modal */}
      {selectedNodeName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card max-h-[85vh] w-full max-w-3xl overflow-y-auto p-6">
            <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-3">
              <div>
                <h3 className="text-base font-bold">Node Heartbeat Timeline</h3>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  Host: <strong>{selectedNodeName}</strong> (Last 30 minutes)
                </span>
              </div>
              <button onClick={() => setSelectedNodeName(null)} className="btn-icon">
                <Icon name="x" size={18} />
              </button>
            </div>

            {hbLoading ? (
              <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
                Fetching heartbeat timeline…
              </div>
            ) : hbData && hbData.heartbeats.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] font-medium text-[var(--color-ink-muted)]">
                    <tr>
                      <th className="px-3 py-2">Received At</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Interval Gap</th>
                      <th className="px-3 py-2">Heartbeat Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {hbData.heartbeats.map((hb, i) => (
                      <tr key={i} className="hover:bg-[var(--color-surface-subtle)]">
                        <td className="px-3 py-2 font-mono">
                          {new Date(hb.received_at).toLocaleTimeString()}
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--color-ink-muted)]">
                          {hb.source}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {hb.gap_to_previous_ms > 0 ? `${(hb.gap_to_previous_ms / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {hb.missed ? (
                            <span className="badge badge-danger">Missed Heartbeat</span>
                          ) : hb.stale ? (
                            <span className="badge badge-warning">Stale Heartbeat</span>
                          ) : (
                            <span className="badge badge-success">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
                No heartbeats recorded in the selected 30m window.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
