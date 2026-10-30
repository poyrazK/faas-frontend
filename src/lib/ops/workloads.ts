/* ==========================================================================
   Customer workload operations: deployments, job runs and data repairs.

   Contract source of truth (faas origin/main):
   - routes   pkg/apid/apidserver/server.go (/v1/admin/ops/deployments*,
              /v1/admin/ops/jobs/runs*, /v1/admin/ops/data-repairs)
   - handlers pkg/apid/apidserver/handlers_admin_deployments.go,
              handlers_admin_jobs.go, handlers_admin_data_repair_health.go
              (→ pkg/apid/repairhealth)
   - structs  pkg/api/dto.go (OperatorDeployment*, OperatorJobRun*,
              JobTaskResponse), pkg/api/data_repair_health.go

   Writes need ?confirm=true and a reason matching [a-z0-9_]{1,64}; none of
   them returns an operator intent (cancel answers 200, retry 202 with the
   newly enqueued deployment).
   ========================================================================== */

import { request, writeHeaders, type OperatorWrite } from '@/lib/api';

/* ────────────────────────────── Shared helpers ─────────────────────────── */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every id filter on these routes is parsed with uuid.Parse; anything else is a 400. */
export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_PATTERN.test(value.trim());
}

/** Go parses created_before with time.RFC3339; send whole seconds in UTC. */
export function toRfc3339(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 1500 → "1.5s", 75000 → "1m 15s". */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return formatAgeSeconds(ms / 1000);
}

/** Seconds → "42s", "5m 3s", "2h 10m", "3d 4h". */
export function formatAgeSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1).replace(/\.0$/, '') : Math.round(seconds)}s`;
  const s = Math.round(seconds);
  const min = Math.floor(s / 60);
  if (min < 60) return `${min}m ${s % 60}s`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}

/** Links that come back from the API are rendered only when they are http(s). */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Suggested reason codes for the actions on these pages. */
export const WORKLOAD_REASON_SUGGESTIONS = {
  deployment: ['stuck_deployment', 'builder_crash', 'customer_request', 'incident_mitigation'],
  job: ['runaway_job', 'stuck_job_run', 'customer_request', 'incident_mitigation'],
} as const;

type BadgeTone = 'badge-success' | 'badge-warning' | 'badge-danger' | 'badge-neutral' | 'badge-info';

/* ─────────────────────────────── Deployments ───────────────────────────── */

/** state.DeploymentStatus values accepted by the ?status= filter. */
export const DEPLOYMENT_STATUSES = [
  'pending',
  'building',
  'imaging',
  'snapshotting',
  'live',
  'failed',
  'superseded',
  'cancelled',
] as const;
export type OperatorDeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/** Statuses state.DeploymentStatus.IsCancelEligible admits. */
export const CANCELLABLE_DEPLOYMENT_STATUSES: readonly string[] = ['pending', 'building', 'imaging', 'snapshotting'];

/** state.AllStageNames: the closed from_stage vocabulary for a retry. */
export const DEPLOYMENT_STAGES = [
  'source_download',
  'dependency_restore',
  'image_build',
  'security_scan',
  'snapshot_prepare',
  'readiness',
] as const;
export type DeploymentStageName = (typeof DEPLOYMENT_STAGES)[number];

export const isDeploymentCancellable = (status: string) => CANCELLABLE_DEPLOYMENT_STATUSES.includes(status);
/** The handler (and enqueueRetry) accept only failed deployments. */
export const isDeploymentRetryable = (status: string) => status === 'failed';

export function deploymentStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'live':
      return 'badge-success';
    case 'failed':
      return 'badge-danger';
    case 'pending':
    case 'building':
    case 'imaging':
    case 'snapshotting':
      return 'badge-warning';
    case 'superseded':
    case 'cancelled':
      return 'badge-neutral';
    default:
      return 'badge-info';
  }
}

/** api.OperatorDeployment — the safe projection (no source paths, images, env). */
export interface OperatorDeployment {
  id: string;
  app_id: string;
  app_slug: string;
  app_status: string;
  account_id: string;
  build_id?: string;
  kind: string;
  status: string;
  source_bytes: number;
  priority: number;
  error?: string;
  error_code?: string;
  error_hint?: string;
  error_why?: string;
  error_fix?: string;
  rollout_state?: string;
  created_at: string;
  cancelled_at?: string;
  cancel_reason?: string;
}

export interface OperatorDeploymentStageItem {
  name: string;
  started_at?: string;
  ended_at?: string;
  duration_ms: number;
  status: string;
  reason?: string;
}

export interface OperatorDeploymentStage {
  current?: string;
  current_started_at?: string;
  retry_requested_stage?: string;
  retry_restart_reason?: string;
  /** Last 32 entries, oldest first. */
  history?: OperatorDeploymentStageItem[];
}

export interface OperatorDeploymentBuild {
  id: string;
  status: string;
  failure_class?: string;
  cache_status?: string;
  enqueued_at: string;
  started_at?: string;
  finished_at?: string;
}

export interface OperatorDeploymentListResponse {
  deployments: OperatorDeployment[];
  account_id?: string;
  app_id?: string;
  /** Omitted when status=all. */
  statuses?: string[];
  limit: number;
  offset: number;
  /** -1 when this page was shorter than `limit`. */
  next_offset: number;
}

export interface OperatorDeploymentDetailResponse {
  deployment: OperatorDeployment;
  build?: OperatorDeploymentBuild;
  stage?: OperatorDeploymentStage;
}

export interface OperatorDeploymentMutationResponse {
  /** For retry this is the newly enqueued deployment, not the failed one. */
  deployment: OperatorDeployment;
  action: 'cancel' | 'retry';
  reason: string;
}

export interface OperatorDeploymentFilters {
  accountId?: string;
  appId?: string;
  /**
   * Omit for the backend's incident default (pending, building, imaging,
   * snapshotting, failed); 'all' for every status; otherwise a subset.
   */
  statuses?: 'all' | readonly OperatorDeploymentStatus[];
  /** Include deployments whose app is deleted. */
  includeDeleted?: boolean;
  createdBefore?: Date;
  /** 1..200 (default 50). */
  limit?: number;
  offset?: number;
}

export const OPERATOR_DEPLOYMENT_MAX_LIMIT = 200;

export function operatorDeploymentsQuery(filters: OperatorDeploymentFilters = {}): string {
  const q = new URLSearchParams();
  if (filters.accountId) q.set('account_id', filters.accountId.trim());
  if (filters.appId) q.set('app_id', filters.appId.trim());
  if (filters.statuses === 'all') q.set('status', 'all');
  else if (filters.statuses && filters.statuses.length > 0) q.set('status', filters.statuses.join(','));
  if (filters.includeDeleted) q.set('include_deleted', 'true');
  if (filters.createdBefore) q.set('created_before', toRfc3339(filters.createdBefore));
  if (filters.limit != null) q.set('limit', String(filters.limit));
  if (filters.offset) q.set('offset', String(filters.offset));
  const query = q.toString();
  return query ? `?${query}` : '';
}

export const listOperatorDeployments = (filters: OperatorDeploymentFilters = {}) =>
  request<OperatorDeploymentListResponse>(`/v1/admin/ops/deployments${operatorDeploymentsQuery(filters)}`, {
    cache: 'no-store',
  });

export const getOperatorDeployment = (id: string) =>
  request<OperatorDeploymentDetailResponse>(`/v1/admin/ops/deployments/${encodeURIComponent(id)}`, {
    cache: 'no-store',
  });

/** 200 on success; 409 when the deployment is no longer pending/building/imaging/snapshotting. */
export const cancelOperatorDeployment = (id: string, reason: string, opts?: OperatorWrite) =>
  request<OperatorDeploymentMutationResponse>(
    `/v1/admin/ops/deployments/${encodeURIComponent(id)}/cancel?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

/**
 * 202 with the new deployment. Only failed deployments of active apps; the
 * target account's deploy admission (plan, holds, release pause) still applies.
 */
export const retryOperatorDeployment = (
  id: string,
  fromStage: DeploymentStageName,
  reason: string,
  opts?: OperatorWrite,
) =>
  request<OperatorDeploymentMutationResponse>(
    `/v1/admin/ops/deployments/${encodeURIComponent(id)}/retry?confirm=true&from_stage=${encodeURIComponent(fromStage)}&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

/**
 * The stage a retry should restart from: the most recent failed stage in the
 * history (the failure path clears `current`), then `current`, then the full
 * pipeline — the same sources `gregale deploys retry` reads without
 * --from-stage. The operator can still pick any stage in the dialog.
 */
export function defaultRetryStage(stage?: OperatorDeploymentStage | null): DeploymentStageName {
  const known = (name?: string): name is DeploymentStageName =>
    !!name && (DEPLOYMENT_STAGES as readonly string[]).includes(name);
  const history = stage?.history ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status === 'failed' && known(history[i].name)) return history[i].name as DeploymentStageName;
  }
  if (known(stage?.current)) return stage.current as DeploymentStageName;
  return 'source_download';
}

/* ──────────────────────────────── Job runs ─────────────────────────────── */

/** The list route returns only queued and running runs (JobRunListActive). */
export const isJobRunCancellable = (status: string) => status === 'queued' || status === 'running';

export function jobStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'succeeded':
      return 'badge-success';
    case 'failed':
      return 'badge-danger';
    case 'running':
      return 'badge-info';
    case 'queued':
      return 'badge-warning';
    default:
      return 'badge-neutral';
  }
}

/** api.OperatorJobRun — no env overrides, commands or lease tokens. */
export interface OperatorJobRun {
  job_id: string;
  job_name: string;
  run_id: string;
  account_id: string;
  aggregate_status: string;
  tasks: number;
  tasks_running: number;
  tasks_succeeded: number;
  tasks_failed: number;
  tasks_cancelled: number;
  ram_mb: number;
  created_at: string;
  started_at?: string;
}

export interface OperatorJobRunListResponse {
  account_id?: string;
  runs: OperatorJobRun[];
  limit: number;
  offset: number;
  /** -1 when this page was shorter than `limit`. */
  next_offset: number;
}

/** api.JobTaskResponse (lease token omitted server-side). */
export interface OperatorJobTask {
  /** workpolicy.Decision; opaque to the console. */
  work_decision?: Record<string, unknown> | null;
  outcome_code?: string;
  run_id: string;
  task_index: number;
  input_id?: string;
  input_ref?: string;
  source_task_index?: number | null;
  output_manifest?: unknown;
  status: string;
  attempt: number;
  instance_id?: string;
  error_class?: string;
  error_message?: string;
  /** Omitted when 0. */
  exit_code?: number;
  started_at?: string;
  finished_at?: string;
  created_at: string;
}

export interface OperatorJobRunDetailResponse {
  run: OperatorJobRun;
  tasks: OperatorJobTask[];
  task_limit: number;
  task_offset: number;
  next_task_offset: number;
}

export interface OperatorJobRunCancelResponse {
  run: OperatorJobRun;
  cancelled_at: string;
  reason: string;
}

export interface OperatorJobRunFilters {
  accountId?: string;
  /** 1..500 (default 50). */
  limit?: number;
  offset?: number;
}

export const listOperatorJobRuns = (filters: OperatorJobRunFilters = {}) => {
  const q = new URLSearchParams();
  if (filters.accountId) q.set('account_id', filters.accountId.trim());
  if (filters.limit != null) q.set('limit', String(filters.limit));
  if (filters.offset) q.set('offset', String(filters.offset));
  const query = q.toString();
  return request<OperatorJobRunListResponse>(`/v1/admin/ops/jobs/runs${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
};

export const getOperatorJobRun = (runId: string, page: { taskLimit?: number; taskOffset?: number } = {}) => {
  const q = new URLSearchParams();
  if (page.taskLimit != null) q.set('task_limit', String(page.taskLimit));
  if (page.taskOffset) q.set('task_offset', String(page.taskOffset));
  const query = q.toString();
  return request<OperatorJobRunDetailResponse>(
    `/v1/admin/ops/jobs/runs/${encodeURIComponent(runId)}${query ? `?${query}` : ''}`,
    { cache: 'no-store' },
  );
};

/** 200 (also when already cancelled); 409 once the run is terminal. */
export const cancelOperatorJobRun = (runId: string, reason: string, opts?: OperatorWrite) =>
  request<OperatorJobRunCancelResponse>(
    `/v1/admin/ops/jobs/runs/${encodeURIComponent(runId)}/cancel?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

/* ────────────────────────────── Data repairs ───────────────────────────── */

/** api.DataRepairPhaseHealth — one row per phase, always all phases. */
export interface DataRepairPhaseHealth {
  phase: string;
  count: number;
  oldest_phase_started_at?: string | null;
  oldest_age_seconds: number;
  /** 0 means the phase has no age threshold. */
  warn_after_seconds: number;
}

/** api.DataRepairHealthItem — metadata only; no SQL, values or snapshots. */
export interface DataRepairHealthItem {
  cursor_key: string;
  operation_id: string;
  task_id?: string;
  account_id: string;
  app_id: string;
  node_id?: string;
  phase: string;
  phase_started_at: string;
  age_seconds: number;
  node_status: string;
  capacity_held: boolean;
  held_memory_mb: number;
  held_vcpus: number;
  cancel_requested: boolean;
  failure_code?: string;
  needs_attention: boolean;
  recovery_guidance: string;
  runbook_url: string;
}

export interface DataRepairHealth {
  observed_at: string;
  phases: DataRepairPhaseHealth[];
  held_slots: number;
  held_memory_mb: number;
  held_vcpus: number;
  held_cpu_millicores: number;
  unavailable_tasks: number;
  items: DataRepairHealthItem[];
  next_cursor?: string;
  limit: number;
}

/** api.DataRepairHealthPollSeconds. */
export const DATA_REPAIR_POLL_MS = 30_000;

export const phaseIsOverdue = (phase: DataRepairPhaseHealth) =>
  phase.count > 0 && phase.warn_after_seconds > 0 && phase.oldest_age_seconds > phase.warn_after_seconds;

/** limit 1..500 (default 64); cursor is the opaque next_cursor. */
export const getDataRepairHealth = (page: { cursor?: string; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (page.limit != null) q.set('limit', String(page.limit));
  if (page.cursor) q.set('cursor', page.cursor);
  const query = q.toString();
  return request<DataRepairHealth>(`/v1/admin/ops/data-repairs${query ? `?${query}` : ''}`, { cache: 'no-store' });
};
