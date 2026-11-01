'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import {
  listObsNodes,
  getObsNodeHeartbeats,
  getObsNodeDetail,
  mutateObsNode,
  getObsWakeLatencies,
  type ObsNodeAction,
  type ObsNodeRow,
  type ObsNodeDetailResponse,
  type ObsHeartbeatListResponse,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import {
  deleteRetiredComputeNode,
  enrollmentLifecycleEffect,
  getComputeNode,
  listComputeNodes,
  LIFECYCLE_TONE,
  type ComputeNode,
} from '@/lib/ops/nodes';
import { EnrollNodeDialog } from './EnrollNodeDialog';
import { ReleaseConvergence } from './ReleaseConvergence';
import { formatMegabytes, isRealTimestamp, REASON_SUGGESTIONS, WAKE_SLO_P50_MS } from '@/lib/operator';
import { SnapshotFreshness } from '@/components/ui/SnapshotFreshness';
import { PageHeader } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icons';
import { relativeTime } from '@/lib/format';
import { OperatorActionDialog } from '@/components/operator/OperatorActionDialog';
import { useOperatorIntents } from '@/components/operator/OperatorIntents';
import { CopyLinkButton, EntityId } from '@/components/operator/EntityId';
import { InstanceActions } from '@/components/operator/InstanceActions';
import { RowMenu, copyText, rowOpener } from '@/components/ui/RowMenu';
import { useUrlParams } from '@/lib/useUrlState';
import { pickParam } from '@/lib/urlState';
import { PageTabs } from '@/components/ui/PageTabs';
import { nodeHref } from '@/lib/routes';

const NODE_ACTIONS: Record<ObsNodeAction, { label: string; tone: 'danger' | 'warning' | 'default'; impact: string }> = {
  drain: {
    label: 'Drain node',
    tone: 'warning',
    impact: 'Stops new placements on this node. Live instances finish normally and park; nothing is interrupted.',
  },
  'force-drain': {
    label: 'Force drain',
    tone: 'danger',
    impact: 'Stops new placements and evicts live instances now. Customers on this node see a cold start on their next request.',
  },
  activate: {
    label: 'Activate node',
    tone: 'default',
    impact: 'Returns the node to placement so the scheduler can start instances on it again.',
  },
  retire: {
    label: 'Retire node',
    tone: 'danger',
    impact: 'Permanently removes the node from the fleet. Drain it first; a retired node cannot be activated again.',
  },
};

const NODE_VIEWS = [
  { key: 'hosts', label: 'Hosts', icon: 'storage' },
  { key: 'release', label: 'Release', icon: 'deployments' },
  { key: 'wake', label: 'Wake latency', icon: 'clock' },
] as const;
type NodeView = (typeof NODE_VIEWS)[number]['key'];
const NODE_VIEW_KEYS = NODE_VIEWS.map((tab) => tab.key);

export default function ComputeNodesPage() {
  return (
    <Suspense>
      <ComputeNodes />
    </Suspense>
  );
}

function ComputeNodes() {
  // The open node (?node=) and heartbeat view (?heartbeats=) live in the URL,
  // so incidents and channels can link straight to a host.
  const [params, setParams] = useUrlParams();
  const nodeParam = params.get('node')?.trim() || null;
  const heartbeatParam = params.get('heartbeats')?.trim() || null;
  // A release link (?release=) opens the release check without naming the view.
  const view = pickParam<NodeView>(params.get('view'), NODE_VIEW_KEYS, params.get('release') ? 'release' : 'hosts');
  const [cursor, setCursor] = useState('');
  const nodeQuery = useAsync(() => listObsNodes(cursor), [cursor], 30000);
  const { data, loading, error, reload } = nodeQuery;
  const wakeQuery = useAsync(() => getObsWakeLatencies(), [], 30000);
  // Enrollment rows carry the real lifecycle (draining, maintenance, retired…)
  // that the obs list collapses into active/inactive.
  const enrolledQuery = useAsync(() => listComputeNodes(true), [], 30000);
  const enrolledByName = new Map((enrolledQuery.data ?? []).map((node) => [node.name, node]));
  const { track } = useOperatorIntents();
  const [enrollTarget, setEnrollTarget] = useState<ComputeNode | 'new' | null>(null);
  const [deletingRecord, setDeletingRecord] = useState(false);

  // Each drawer remembers which node its in-flight request was for, so a slow
  // response for node A can never render (or be acted on) under node B.
  const requestSeq = useRef(0);
  const [heartbeatNode, setHeartbeatNode] = useState<string | null>(null);
  const [heartbeats, setHeartbeats] = useState<{ node: string; data?: ObsHeartbeatListResponse; error?: string } | null>(null);
  const [detailNode, setDetailNode] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ node: string; data?: ObsNodeDetailResponse; error?: string } | null>(null);
  const [enrollment, setEnrollment] = useState<{ node: string; data?: ComputeNode; error?: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<ObsNodeAction | null>(null);

  const loadHeartbeats = async (nodeName: string) => {
    const seq = ++requestSeq.current;
    setHeartbeatNode(nodeName);
    setHeartbeats(null);
    try {
      const res = await getObsNodeHeartbeats(nodeName, 30);
      if (seq === requestSeq.current) setHeartbeats({ node: nodeName, data: res });
    } catch (err) {
      if (seq === requestSeq.current) setHeartbeats({ node: nodeName, error: (err as Error).message });
    }
  };

  const loadDetail = async (nodeName: string) => {
    const seq = ++requestSeq.current;
    setDetailNode(nodeName);
    setDetail(null);
    setEnrollment(null);
    const [workloads, enrolled] = await Promise.allSettled([getObsNodeDetail(nodeName), getComputeNode(nodeName)]);
    if (seq !== requestSeq.current) return;
    setDetail(
      workloads.status === 'fulfilled'
        ? { node: nodeName, data: workloads.value }
        : { node: nodeName, error: (workloads.reason as Error).message },
    );
    setEnrollment(
      enrolled.status === 'fulfilled'
        ? { node: nodeName, data: enrolled.value }
        : { node: nodeName, error: (enrolled.reason as Error).message },
    );
  };

  const openDetail = (nodeName: string) => setParams({ node: nodeName, heartbeats: null });
  const closeDetail = () => setParams({ node: null });
  const openHeartbeats = (nodeName: string) => setParams({ heartbeats: nodeName, node: null });
  const closeHeartbeats = () => setParams({ heartbeats: null });

  useEffect(() => {
    queueMicrotask(() => (nodeParam ? void loadDetail(nodeParam) : setDetailNode(null)));
  }, [nodeParam]);
  useEffect(() => {
    queueMicrotask(() => (heartbeatParam ? void loadHeartbeats(heartbeatParam) : setHeartbeatNode(null)));
  }, [heartbeatParam]);

  const refreshAll = () => {
    reload();
    wakeQuery.reload();
    enrolledQuery.reload();
  };

  const nodeDetail = detail && detail.node === detailNode ? detail.data : undefined;
  const nodeEnrollment = enrollment && enrollment.node === detailNode ? enrollment : null;
  const editBlock = nodeEnrollment?.data ? enrollmentLifecycleEffect(nodeEnrollment.data, true).blocked : null;
  const retired = nodeEnrollment?.data?.lifecycle === 'retired';
  const nodeDetailError = detail && detail.node === detailNode ? detail.error : undefined;
  const hb = heartbeats && heartbeats.node === heartbeatNode ? heartbeats : null;
  const action = pendingAction ? NODE_ACTIONS[pendingAction] : null;

  return (
    <div>
      <PageHeader
        title="Compute nodes"
        subtitle="Hosts, placement capacity and lifecycle: enroll, drain, activate and retire."
        actions={
          <div className="flex gap-2">
            <button onClick={() => setEnrollTarget('new')} className="btn btn-primary btn-sm">
              <Icon name="plus" size={14} />
              Enroll node…
            </button>
            <button onClick={refreshAll} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
        }
      />

      <SnapshotFreshness snapshots={[nodeQuery, wakeQuery]} />
      <PageTabs
        label="Compute node views"
        tabs={NODE_VIEWS}
        value={view}
        onChange={(next) => setParams({ view: next === 'hosts' ? null : next })}
      />

      {view === 'hosts' && (
        <>
          <SectionCard title="Hosts">
            {error && !data ? (
              <div role="alert" className="p-8 text-center text-sm text-[var(--color-danger)]">
                Could not load compute nodes: {error.message}
              </div>
            ) : loading && !data ? (
              <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Loading compute nodes…</div>
            ) : !data?.items.length ? (
              <div className="p-8 text-center text-sm text-[var(--color-ink-muted)]">No compute nodes are enrolled.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="dtable text-xs">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Lifecycle</th>
                      <th>Size</th>
                      <th>Load</th>
                      <th>Last heartbeat</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((node: ObsNodeRow) => (
                      <tr key={node.id} {...rowOpener(() => openDetail(node.name), `Open node ${node.name}`)}>
                        <td className="nowrap">
                          <span className="cell-primary">{node.name}</span>
                          <div className="font-mono text-[11px] text-[var(--color-ink-muted)]">{node.overlay_ip || 'no overlay IP'}</div>
                        </td>
                        <td className="nowrap">
                          <LifecycleBadge enrolled={enrolledByName.get(node.name)} active={node.active} />
                        </td>
                        <td className="nowrap font-mono">
                          {node.vpcpus} vCPU · {formatMegabytes(node.mem_mb)}
                        </td>
                        <td className="nowrap font-mono">
                          <div>
                            {node.instances_live} live · {node.instances_running} running
                          </div>
                          <div
                            className={node.admission_margin_mb < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]'}
                            title="RAM used of the admission ceiling"
                          >
                            {formatMegabytes(node.ram_used_mb)} of {formatMegabytes(node.admission_ceiling_mb)}
                          </div>
                        </td>
                        <td className="nowrap">{isRealTimestamp(node.last_heartbeat_at) ? relativeTime(node.last_heartbeat_at) : 'Never'}</td>
                        <td className="cell-menu">
                          <RowMenu
                            label={`Actions for ${node.name}`}
                            items={[
                              { label: 'Open node', onSelect: () => openDetail(node.name) },
                              { label: 'Heartbeats (30 min)', onSelect: () => openHeartbeats(node.name) },
                              { label: 'Copy link', onSelect: () => copyText(new URL(nodeHref(node.name), window.location.origin).toString()) },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {error && data && (
              <div role="alert" className="table-foot text-[var(--color-danger)]">
                Refresh failed: {error.message}. Showing the last successful snapshot.
              </div>
            )}
          </SectionCard>

          {(cursor || data?.next_cursor) && (
            <div className="mt-3 flex gap-2">
              {cursor && (
                <button className="btn btn-secondary btn-xs" onClick={() => setCursor('')}>
                  First page
                </button>
              )}
              {data?.next_cursor && (
                <button className="btn btn-secondary btn-xs" disabled={loading} onClick={() => setCursor(data.next_cursor)}>
                  Next page
                </button>
              )}
            </div>
          )}
        </>
      )}

      {view === 'release' && <ReleaseConvergence />}

      {view === 'wake' && (
        <SectionCard
          title={
            <div className="flex items-center justify-between gap-3">
              <span>Wake latency (5-minute window)</span>
              <span className="text-xs font-normal text-[var(--color-ink-muted)]">SLO: p50 under {WAKE_SLO_P50_MS} ms</span>
            </div>
          }
        >
          {wakeQuery.error && !wakeQuery.data ? (
            <div role="alert" className="p-8 text-center text-xs text-[var(--color-danger)]">
              Could not load wake latency: {wakeQuery.error.message}
            </div>
          ) : wakeQuery.loading && !wakeQuery.data ? (
            <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">Loading wake latency…</div>
          ) : wakeQuery.data?.prometheus_available === false ? (
            <div className="p-8 text-center text-xs text-[var(--color-warning-bold)]">
              Wake latency telemetry is unavailable (Prometheus could not be queried).
            </div>
          ) : !wakeQuery.data?.quantiles.length ? (
            <div className="p-8 text-center text-xs text-[var(--color-ink-muted)]">
              No wakes were sampled in the last five minutes.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="dtable text-xs">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>p50</th>
                    <th>p95</th>
                    <th>p99</th>
                    <th>Samples</th>
                    <th>SLO</th>
                  </tr>
                </thead>
                <tbody>
                  {wakeQuery.data.quantiles.map((w) => (
                    <tr key={w.node_id || w.node_name}>
                      <td className="cell-primary">{w.node_name}</td>
                      <td className="font-mono font-semibold">{w.p50_ms.toFixed(0)} ms</td>
                      <td className="font-mono">{w.p95_ms.toFixed(0)} ms</td>
                      <td className="font-mono">{w.p99_ms.toFixed(0)} ms</td>
                      <td className="font-mono">{w.sample_count}</td>
                      <td>
                        <span className={`badge ${w.p50_ms <= WAKE_SLO_P50_MS ? 'badge-success' : 'badge-warning'}`}>
                          {w.p50_ms <= WAKE_SLO_P50_MS ? 'Within SLO' : 'Above SLO'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      <Modal open={detailNode !== null} onClose={closeDetail} title={`Node ${detailNode ?? ''}`} width={960}>
        {nodeDetailError ? (
          <div role="alert" className="text-sm text-[var(--color-danger)]">
            Could not load node detail: {nodeDetailError}
          </div>
        ) : !nodeDetail ? (
          <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">Loading node workloads…</div>
        ) : (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-surface-subtle)] p-4 sm:grid-cols-5">
              <Fact label="Lifecycle" value={<LifecycleBadge enrolled={nodeEnrollment?.data} active={nodeDetail.node.active} />} />
              <Fact label="Live instances" value={nodeDetail.node.instances_live} />
              <Fact label="RAM used" value={formatMegabytes(nodeDetail.node.ram_used_mb)} />
              <Fact
                label="CPU (60s)"
                value={nodeDetail.node.cpu_pct_60s == null ? '—' : `${nodeDetail.node.cpu_pct_60s.toFixed(1)}%`}
              />
              <Fact
                label="Drain"
                value={nodeDetail.drain.drain_safe ? 'Safe to drain' : `${nodeDetail.drain.live_instances} live remain`}
                tone={nodeDetail.drain.drain_safe ? 'ok' : 'warn'}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {retired ? (
                <button onClick={() => setDeletingRecord(true)} className="btn btn-danger btn-sm">
                  Delete record…
                </button>
              ) : nodeDetail.node.active ? (
                <>
                  <button onClick={() => setPendingAction('drain')} className="btn btn-secondary btn-sm">
                    Drain…
                  </button>
                  <button onClick={() => setPendingAction('force-drain')} className="btn btn-danger btn-sm">
                    Force drain…
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setPendingAction('activate')} className="btn btn-primary btn-sm">
                    Activate…
                  </button>
                  <button onClick={() => setPendingAction('retire')} className="btn btn-danger btn-sm">
                    Retire…
                  </button>
                </>
              )}
              {nodeEnrollment?.data && !retired && (
                <button
                  onClick={() => setEnrollTarget(nodeEnrollment.data!)}
                  className="btn btn-secondary btn-sm"
                  disabled={!!editBlock}
                  title={editBlock ?? undefined}
                >
                  Edit enrollment…
                </button>
              )}
              {detailNode && <CopyLinkButton href={nodeHref(detailNode)} />}
            </div>

            <EnrollmentSection enrollment={nodeEnrollment} />

            <section>
              <h4 className="mb-2 font-semibold text-[var(--color-ink-soft)]">Apps ({nodeDetail.apps.length})</h4>
              {nodeDetail.apps.length === 0 ? (
                <div className="text-[var(--color-ink-muted)]">No apps are placed on this node.</div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
                  <table className="dtable text-xs">
                    <thead>
                      <tr>
                        <th>App</th>
                        <th>Account</th>
                        <th>Instances</th>
                        <th>RAM</th>
                        <th>Last request</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nodeDetail.apps.map((app) => (
                        <tr key={app.id}>
                          <td className="cell-primary">{app.slug}</td>
                          <td>
                            <EntityId id={app.account_id} kind="account" />
                          </td>
                          <td>
                            {app.instances_live} live · {app.instances_running} running · {app.instances_cold_booting} cold
                          </td>
                          <td className="font-mono">{formatMegabytes(app.ram_used_mb)}</td>
                          <td>{app.last_request_at ? relativeTime(app.last_request_at) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-2 font-semibold text-[var(--color-ink-soft)]">
                Instances ({nodeDetail.instances.length})
              </h4>
              {nodeDetail.instances.length === 0 ? (
                <div className="text-[var(--color-ink-muted)]">No instances are assigned to this node.</div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
                  <table className="dtable text-xs">
                    <thead>
                      <tr>
                        <th>Instance</th>
                        <th>App</th>
                        <th>State</th>
                        <th>RAM</th>
                        <th>Last request</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {nodeDetail.instances.map((instance) => (
                        <tr key={instance.id}>
                          <td>
                            <EntityId id={instance.id} kind="instance" />
                          </td>
                          <td>{instance.app_slug || <EntityId id={instance.app_id} kind="app" />}</td>
                          <td>
                            <span className="badge badge-neutral">{instance.state}</span>
                          </td>
                          <td className="font-mono">{formatMegabytes(instance.ram_mb)}</td>
                          <td>{instance.last_request_at ? relativeTime(instance.last_request_at) : '—'}</td>
                          <td>
                            <InstanceActions
                              instance={{ ...instance, node_name: instance.node_name || detailNode || undefined }}
                              onDone={() => detailNode && void loadDetail(detailNode)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>

      <Modal
        open={heartbeatNode !== null}
        onClose={closeHeartbeats}
        title={`Heartbeats · ${heartbeatNode ?? ''} · last 30 minutes`}
        width={760}
      >
        {hb?.error ? (
          <div role="alert" className="text-sm text-[var(--color-danger)]">
            Could not load heartbeats: {hb.error}
          </div>
        ) : !hb?.data ? (
          <div className="p-6 text-center text-sm text-[var(--color-ink-muted)]">Loading heartbeats…</div>
        ) : hb.data.heartbeats.length === 0 ? (
          <div className="p-6 text-center text-sm text-[var(--color-warning-bold)]">
            No heartbeats in the last 30 minutes. The node may be down or partitioned.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable text-xs">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Source</th>
                  <th>Gap</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {hb.data.heartbeats.map((beat) => (
                  <tr key={`${beat.received_at}-${beat.source}`}>
                    <td className="font-mono">{new Date(beat.received_at).toLocaleTimeString()}</td>
                    <td className="font-mono">{beat.source}</td>
                    <td className="font-mono">
                      {beat.gap_to_previous_ms > 0 ? `${(beat.gap_to_previous_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td>
                      {beat.missed ? (
                        <span className="badge badge-danger">Missed</span>
                      ) : beat.stale ? (
                        <span className="badge badge-warning">Stale</span>
                      ) : (
                        <span className="badge badge-success">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {action && pendingAction && detailNode && (
        <OperatorActionDialog
          open
          title={`${action.label}: ${detailNode}`}
          tone={action.tone}
          reason="code"
          reasonSuggestions={REASON_SUGGESTIONS.node}
          confirmText={pendingAction === 'force-drain' || pendingAction === 'retire' ? detailNode : undefined}
          submitLabel={action.label}
          fingerprint={`${pendingAction}|${detailNode}`}
          impact={
            <div className="space-y-1">
              <p>{action.impact}</p>
              {nodeDetail && pendingAction !== 'activate' && (
                <p className="text-xs text-[var(--color-ink-soft)]">
                  Currently {nodeDetail.drain.live_instances} live instance(s) across {nodeDetail.apps.length} app(s).
                </p>
              )}
            </div>
          }
          onClose={() => setPendingAction(null)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const res = await mutateObsNode(detailNode, pendingAction, reason, { idempotencyKey });
            track({ intentId: res.intent_id, kind: `node_${pendingAction.replace('-', '_')}`, target: detailNode });
            refreshAll();
            void loadDetail(detailNode);
            const p = res.preflight;
            return `${action.label} queued (${res.previous_lifecycle} → ${res.requested_lifecycle}); ${p.affected_apps} app(s), ${p.affected_tenants} tenant(s) affected.`;
          }}
        />
      )}
      {enrollTarget && (
        <EnrollNodeDialog
          editing={enrollTarget === 'new' ? null : enrollTarget}
          enrolled={enrolledQuery.data ?? []}
          onClose={() => setEnrollTarget(null)}
          onDone={(node) => {
            refreshAll();
            if (detailNode === node.name) void loadDetail(node.name);
          }}
        />
      )}

      {deletingRecord && detailNode && (
        <OperatorActionDialog
          open
          title={`Delete record: ${detailNode}`}
          tone="danger"
          reason="code"
          reasonSuggestions={['mistaken_enrollment', 'duplicate_enrollment']}
          confirmText={detailNode}
          submitLabel="Delete record"
          fingerprint={`hard-delete|${detailNode}`}
          impact="Permanently removes this retired node from the fleet registry. apid only allows it for a node that never ran a workload (a mistaken enrollment); otherwise the retired record is kept for history."
          onClose={() => setDeletingRecord(false)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            await deleteRetiredComputeNode(detailNode, reason, { idempotencyKey });
            closeDetail();
            refreshAll();
            return `Node record ${detailNode} deleted.`;
          }}
        />
      )}
    </div>
  );
}

function LifecycleBadge({ enrolled, active }: { enrolled?: ComputeNode; active: boolean }) {
  if (!enrolled) {
    return <span className={`badge ${active ? 'badge-success' : 'badge-warning'}`}>{active ? 'Active' : 'Out of placement'}</span>;
  }
  return (
    <span className={`badge ${LIFECYCLE_TONE[enrolled.lifecycle] ?? 'badge-neutral'}`}>{enrolled.lifecycle.replace('_', ' ')}</span>
  );
}

function EnrollmentSection({ enrollment }: { enrollment: { data?: ComputeNode; error?: string } | null }) {
  if (!enrollment) return <div className="text-[var(--color-ink-muted)]">Loading enrollment…</div>;
  if (enrollment.error) {
    return (
      <div role="alert" className="text-[var(--color-danger)]">
        Could not load the enrollment record: {enrollment.error}
      </div>
    );
  }
  const node = enrollment.data!;
  const digest = (value?: string | null) => (value ? <EntityId id={value} chars={12} /> : '—');
  return (
    <section>
      <h4 className="mb-2 font-semibold text-[var(--color-ink-soft)]">Enrollment</h4>
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-line)] p-4 sm:grid-cols-4">
        <Fact label="vmmd target" value={<span className="font-mono">{node.target_url}</span>} />
        <Fact label="Scrape target" value={<span className="font-mono">{node.gateway_target_url || '—'}</span>} />
        <Fact label="Role · region · zone" value={[node.role, node.region, node.zone].map((v) => v || '—').join(' · ')} />
        <Fact label="Generation" value={node.generation ?? '—'} />
        <Fact label="Release" value={digest(node.release_id)} />
        <Fact label="Manifest" value={digest(node.manifest_hash)} />
        <Fact label="Host certificate" value={digest(node.cert_fingerprint)} />
        <Fact label="Enrolled" value={new Date(node.created_at).toLocaleDateString()} />
      </div>
    </section>
  );
}

function Fact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <div>
      <span className="text-[var(--color-ink-muted)]">{label}</span>
      <div
        className={`mt-1 font-semibold ${
          tone === 'ok' ? 'text-[var(--color-brand-bright)]' : tone === 'warn' ? 'text-[var(--color-warning-bold)]' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}
