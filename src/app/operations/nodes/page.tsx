'use client';

import React, { useState } from 'react';
import {
  listObsNodes,
  getObsNodeHeartbeats,
  getObsNodeDetail,
  drainObsNode,
  forceDrainObsNode,
  activateObsNode,
  getObsWakeLatencies,
  getObsBuilderHeartbeats,
  type ObsNodeRow,
  type ObsNodeDetailResponse,
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

  // Node workload and lifecycle drawer state
  const [detailNodeName, setDetailNodeName] = useState<string | null>(null);
  const [nodeDetail, setNodeDetail] = useState<ObsNodeDetailResponse | null>(null);
  const [nodeDetailLoading, setNodeDetailLoading] = useState(false);
  const [nodeAction, setNodeAction] = useState<string | null>(null);
  const [nodeFeedback, setNodeFeedback] = useState<string | null>(null);

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

  const openNodeDetail = async (nodeName: string) => {
    setDetailNodeName(nodeName);
    setNodeDetailLoading(true);
    setNodeDetail(null);
    setNodeFeedback(null);
    try {
      setNodeDetail(await getObsNodeDetail(nodeName));
    } catch (err) {
      setNodeFeedback(`Could not load node detail: ${(err as Error).message}`);
    } finally {
      setNodeDetailLoading(false);
    }
  };

  const handleNodeAction = async (action: 'drain' | 'force-drain' | 'activate') => {
    if (!detailNodeName) return;
    if (action === 'force-drain' && !window.confirm('Force-drain this node? Live instances may be disrupted.')) return;
    setNodeAction(action);
    setNodeFeedback(null);
    try {
      const result = action === 'drain'
        ? await drainObsNode(detailNodeName)
        : action === 'force-drain'
        ? await forceDrainObsNode(detailNodeName)
        : await activateObsNode(detailNodeName);
      await openNodeDetail(detailNodeName);
      setNodeFeedback(`${result.node} is ${result.active ? 'active' : 'draining'}. ${result.live_instances} live instance(s) remain.`);
      reload();
    } catch (err) {
      setNodeFeedback(`Node action failed: ${(err as Error).message}`);
    } finally {
      setNodeAction(null);
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
                  <th className="px-4 py-3">Live / RAM Used</th>
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
                    <td className="px-4 py-3 font-mono">
                      <div>{node.instances_live} live · {node.instances_running} running</div>
                      <div className={node.admission_margin_mb < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]'}>
                        {(node.ram_used_mb / 1024).toFixed(1)} / {(node.admission_ceiling_mb / 1024).toFixed(1)} GB
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--color-ink-muted)]">
                      {node.overlay_ip || '—'}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ink-muted)]">
                      {node.last_heartbeat_at ? relativeTime(node.last_heartbeat_at) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => openNodeDetail(node.name)} className="btn btn-secondary btn-xs">
                          Inspect
                        </button>
                        <button onClick={() => openHeartbeatDrawer(node.name)} className="btn btn-secondary btn-xs">
                          Heartbeats
                        </button>
                      </div>
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

      {/* Node workload and lifecycle drawer */}
      {detailNodeName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card max-h-[88vh] w-full max-w-4xl overflow-y-auto p-6">
            <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-3">
              <div>
                <h3 className="text-base font-bold">Node Workload Inspect</h3>
                <span className="text-xs text-[var(--color-ink-muted)]">Host: <strong>{detailNodeName}</strong></span>
              </div>
              <button onClick={() => setDetailNodeName(null)} className="btn-icon"><Icon name="x" size={18} /></button>
            </div>

            {nodeDetailLoading ? (
              <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Fetching node workloads…</div>
            ) : nodeDetail ? (
              <div className="mt-4 space-y-5 text-xs">
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-surface-subtle)] p-4 sm:grid-cols-5">
                  <div><span className="text-[var(--color-ink-muted)]">Status</span><div className="mt-1 font-semibold">{nodeDetail.node.active ? 'Active' : 'Draining'}</div></div>
                  <div><span className="text-[var(--color-ink-muted)]">Live instances</span><div className="mt-1 font-semibold">{nodeDetail.node.instances_live}</div></div>
                  <div><span className="text-[var(--color-ink-muted)]">RAM used</span><div className="mt-1 font-semibold">{(nodeDetail.node.ram_used_mb / 1024).toFixed(1)} GB</div></div>
                  <div><span className="text-[var(--color-ink-muted)]">CPU (60s)</span><div className="mt-1 font-semibold">{nodeDetail.node.cpu_pct_60s == null ? '—' : `${nodeDetail.node.cpu_pct_60s.toFixed(1)}%`}</div></div>
                  <div><span className="text-[var(--color-ink-muted)]">Drain status</span><div className={`mt-1 font-semibold ${nodeDetail.drain.drain_safe ? 'text-[var(--color-brand-bright)]' : 'text-[var(--color-warning-bold)]'}`}>{nodeDetail.drain.drain_safe ? 'Safe' : `${nodeDetail.drain.live_instances} live remain`}</div></div>
                </div>

                {nodeFeedback && <div className="rounded bg-[var(--color-surface-subtle)] p-3 text-[var(--color-ink-muted)]">{nodeFeedback}</div>}

                <div className="flex flex-wrap gap-2">
                  {nodeDetail.node.active ? (
                    <>
                      <button onClick={() => handleNodeAction('drain')} disabled={nodeAction !== null} className="btn btn-secondary btn-sm">
                        {nodeAction === 'drain' ? 'Draining…' : 'Drain Node'}
                      </button>
                      <button onClick={() => handleNodeAction('force-drain')} disabled={nodeAction !== null} className="btn btn-danger btn-sm">
                        {nodeAction === 'force-drain' ? 'Force-draining…' : 'Force Drain'}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleNodeAction('activate')} disabled={nodeAction !== null} className="btn btn-secondary btn-sm">
                      {nodeAction === 'activate' ? 'Activating…' : 'Activate Node'}
                    </button>
                  )}
                </div>

                <section>
                  <h4 className="mb-2 font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Applications ({nodeDetail.apps.length})</h4>
                  {nodeDetail.apps.length === 0 ? <div className="text-[var(--color-ink-muted)]">No applications are placed on this node.</div> : (
                    <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
                      <table className="w-full text-left"><thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)]"><tr><th className="px-3 py-2">App</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Instances</th><th className="px-3 py-2">RAM</th><th className="px-3 py-2">Last request</th></tr></thead>
                        <tbody className="divide-y divide-[var(--color-line)]">{nodeDetail.apps.map((app) => <tr key={app.id}><td className="px-3 py-2 font-semibold">{app.slug}</td><td className="px-3 py-2 font-mono">{app.account_id.slice(0, 13)}…</td><td className="px-3 py-2">{app.instances_live} live · {app.instances_running} running · {app.instances_cold_booting} cold</td><td className="px-3 py-2 font-mono">{app.ram_used_mb} MB</td><td className="px-3 py-2 text-[var(--color-ink-muted)]">{app.last_request_at ? relativeTime(app.last_request_at) : '—'}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section>
                  <h4 className="mb-2 font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Instances ({nodeDetail.instances.length})</h4>
                  {nodeDetail.instances.length === 0 ? <div className="text-[var(--color-ink-muted)]">No instance rows are currently assigned.</div> : (
                    <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]"><table className="w-full text-left"><thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)]"><tr><th className="px-3 py-2">App</th><th className="px-3 py-2">State</th><th className="px-3 py-2">RAM</th><th className="px-3 py-2">Last request</th></tr></thead><tbody className="divide-y divide-[var(--color-line)]">{nodeDetail.instances.map((instance) => <tr key={instance.id}><td className="px-3 py-2">{instance.app_slug || instance.app_id.slice(0, 13) + '…'}</td><td className="px-3 py-2"><span className="badge badge-neutral">{instance.state}</span></td><td className="px-3 py-2 font-mono">{instance.ram_mb} MB</td><td className="px-3 py-2 text-[var(--color-ink-muted)]">{instance.last_request_at ? relativeTime(instance.last_request_at) : '—'}</td></tr>)}</tbody></table></div>
                  )}
                </section>
              </div>
            ) : <div className="p-8 text-center text-sm text-[var(--color-danger)]">Could not fetch node detail.</div>}
          </div>
        </div>
      )}

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
