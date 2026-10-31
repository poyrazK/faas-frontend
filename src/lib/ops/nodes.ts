/* ==========================================================================
   Compute-node enrollment: /v1/compute-nodes (apid compute_nodes.go).
   Enrollment is an upsert keyed on the node name; vmmd later fills in the
   overlay IP and heartbeats itself. Lifecycle changes (drain, activate,
   retire) stay on /v1/admin/ops/nodes and are tracked as operator intents.
   ========================================================================== */

import { newIdempotencyKey, request, writeHeaders, type OperatorWrite } from '@/lib/api';

/** state.NodeLifecycle. */
export type NodeLifecycle =
  | 'active'
  | 'draining'
  | 'force_draining'
  | 'maintenance'
  | 'unavailable'
  | 'recovering'
  | 'retired';

/**
 * Body of POST /v1/compute-nodes.
 * @go api.ComputeNodeEnrollmentRequest
 */
export interface ComputeNodeEnrollment {
  name: string;
  /** vmmd's control endpoint: unix:///… or tcp://host:port. */
  target_url: string;
  /** tcp://host:port of this node's schedd; empty keeps the current value. */
  schedd_target_url?: string;
  /** tcp://host:port the control-plane Prometheus scrapes; empty keeps the current value. */
  gateway_target_url?: string;
  vpcpus: number;
  mem_mb: number;
  max_concurrency: number;
  admission_ceiling_mb: number;
  /** Enroll as "unavailable" so placement skips it until it is activated. */
  defer_activation?: boolean;
}

/**
 * One enrolled node as operators see it (host certificate stays server-side).
 * @go api.ComputeNodeOperatorResponse
 */
export interface ComputeNode {
  id: string;
  name: string;
  target_url: string;
  gateway_target_url?: string;
  vpcpus: number;
  mem_mb: number;
  max_concurrency: number;
  admission_ceiling_mb: number;
  active: boolean;
  lifecycle: NodeLifecycle | string;
  role?: string | null;
  region?: string | null;
  zone?: string | null;
  release_id?: string | null;
  manifest_hash?: string | null;
  cert_fingerprint?: string | null;
  generation?: number | null;
  last_heartbeat_at?: string;
  created_at: string;
  /** Only on the single-node read. */
  live_instance_count?: number | null;
  trace_id?: string;
}

/** Retired and drained rows are listed only with include_inactive=1. */
export const listComputeNodes = (includeInactive = true) =>
  request<ComputeNode[]>(`/v1/compute-nodes${includeInactive ? '?include_inactive=1' : ''}`, { cache: 'no-store' });

export const getComputeNode = (name: string) =>
  request<ComputeNode>(`/v1/compute-nodes/${encodeURIComponent(name)}`, { cache: 'no-store' });

/**
 * Upserts a node by name. Re-enrolling an existing name updates its
 * addresses and capacity (region, zone, role, release and certificate are
 * kept); a retired name answers 409 node_retired. The reason is an audit
 * code ([a-z0-9_]{1,64}).
 * @goBody api.ComputeNodeEnrollmentRequest
 */
export const enrollComputeNode = (body: ComputeNodeEnrollment, reason: string, opts?: OperatorWrite) =>
  request<ComputeNode>(`/v1/compute-nodes?reason=${encodeURIComponent(reason)}`, {
    method: 'POST',
    // /v1/compute-nodes is outside /v1/admin, so the transport does not add a key itself.
    headers: { 'Idempotency-Key': opts?.idempotencyKey ?? newIdempotencyKey() },
    body: JSON.stringify(body),
  });

/**
 * Removes the record of a retired node that never ran anything (a mistaken
 * enrollment). apid refuses nodes with workload history (409 node_has_history)
 * and anything not yet retired (409 node_not_deletable).
 */
export const deleteRetiredComputeNode = (name: string, reason: string, opts?: OperatorWrite) =>
  request<void>(
    `/v1/compute-nodes/${encodeURIComponent(name)}?hard=1&confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'DELETE', headers: writeHeaders(opts) },
    'none',
  );

/* ───────────────────────────── Validation ─────────────────────────────── */

/** The form as typed: numbers stay strings until validated. */
export interface EnrollmentDraft {
  name: string;
  target_url: string;
  schedd_target_url: string;
  gateway_target_url: string;
  vpcpus: string;
  mem_mb: string;
  max_concurrency: string;
  admission_ceiling_mb: string;
  defer_activation: boolean;
}

export const EMPTY_ENROLLMENT: EnrollmentDraft = {
  name: '',
  target_url: '',
  schedd_target_url: '',
  gateway_target_url: '',
  vpcpus: '',
  mem_mb: '',
  max_concurrency: '',
  admission_ceiling_mb: '',
  defer_activation: true,
};

/**
 * apid's upsert writes lifecycle on every enrollment: "unavailable" with
 * defer_activation, otherwise "active". Re-enrolling therefore changes the
 * lifecycle of a node that is draining or out of placement. This is what an
 * edit would do, and whether the console allows it.
 */
export function enrollmentLifecycleEffect(
  node: Pick<ComputeNode, 'lifecycle'>,
  deferActivation: boolean,
): { after: NodeLifecycle; changes: boolean; blocked: string | null } {
  const after: NodeLifecycle = deferActivation ? 'unavailable' : 'active';
  if (node.lifecycle === 'draining' || node.lifecycle === 'force_draining') {
    return { after, changes: true, blocked: 'The node is draining. Re-enrolling would overwrite that lifecycle; wait until the drain finishes.' };
  }
  if (node.lifecycle === 'retired') {
    return { after, changes: true, blocked: 'Retired nodes cannot be re-enrolled; enroll a new node name.' };
  }
  return { after, changes: node.lifecycle !== after, blocked: null };
}

/**
 * Prefills the form from an enrolled node. schedd's URL is not readable, so it
 * stays empty (= keep). A node outside placement stays outside by default.
 */
export function draftFromNode(node: ComputeNode): EnrollmentDraft {
  return {
    name: node.name,
    target_url: node.target_url,
    schedd_target_url: '',
    gateway_target_url: node.gateway_target_url ?? '',
    vpcpus: String(node.vpcpus),
    mem_mb: String(node.mem_mb),
    max_concurrency: String(node.max_concurrency),
    admission_ceiling_mb: String(node.admission_ceiling_mb),
    defer_activation: node.lifecycle !== 'active',
  };
}

/**
 * apid's parseGatewayTargetURL: tcp://host:port, port 1–65535, no path,
 * query, credentials, loopback or wildcard host. Null when valid.
 */
export function tcpTargetError(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'Use tcp://host:port.';
  }
  if (url.protocol !== 'tcp:' || url.username || url.password || (url.pathname && url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    return 'Use tcp://host:port.';
  }
  if (raw.trim().replace(/^tcp:\/\/[^/]*/, '') !== '') return 'Use tcp://host:port with nothing after the port.';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const port = Number(url.port);
  if (!host || !url.port || !Number.isInteger(port) || port < 1 || port > 65535) return 'Use tcp://host:port with a port between 1 and 65535.';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'Loopback hostnames are not reachable from the control plane.';
  if (/^127\./.test(host) || host === '::1' || host === '0.0.0.0' || host === '::') {
    return 'Loopback and wildcard addresses are not reachable from the control plane.';
  }
  return null;
}

const positiveInt = (raw: string) => {
  const n = Number(raw.trim());
  return raw.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null;
};

export type EnrollmentErrors = Partial<Record<keyof EnrollmentDraft, string>>;

/**
 * Validates the form with apid's own rules (decodeComputeNodeEnrollment) so a
 * submit never round-trips to a 400. Returns the request body when valid.
 */
export function validateEnrollment(draft: EnrollmentDraft): { body: ComputeNodeEnrollment; errors: EnrollmentErrors } | { body: null; errors: EnrollmentErrors } {
  const errors: EnrollmentErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'A node name is required.';
  else if (/\s/.test(name)) errors.name = 'Node names cannot contain spaces.';

  const target = draft.target_url.trim();
  if (!target) errors.target_url = 'Required: unix:///path or tcp://host:port of vmmd.';
  else if (!/^(unix:\/\/\/\S+|tcp:\/\/\S+)$/.test(target)) errors.target_url = 'Use unix:///path or tcp://host:port.';

  for (const key of ['schedd_target_url', 'gateway_target_url'] as const) {
    const value = draft[key].trim();
    if (value) {
      const problem = tcpTargetError(value);
      if (problem) errors[key] = problem;
    }
  }

  const vpcpus = positiveInt(draft.vpcpus);
  const memMb = positiveInt(draft.mem_mb);
  const maxConcurrency = positiveInt(draft.max_concurrency);
  const ceiling = positiveInt(draft.admission_ceiling_mb);
  if (vpcpus === null) errors.vpcpus = 'A whole number above 0.';
  if (memMb === null) errors.mem_mb = 'A whole number of MB above 0.';
  if (maxConcurrency === null) errors.max_concurrency = 'A whole number above 0.';
  if (ceiling === null) errors.admission_ceiling_mb = 'A whole number of MB above 0.';
  else if (memMb !== null && ceiling > memMb) errors.admission_ceiling_mb = 'Cannot exceed the node’s memory.';

  if (Object.keys(errors).length > 0) return { body: null, errors };
  return {
    errors,
    body: {
      name,
      target_url: target,
      ...(draft.schedd_target_url.trim() ? { schedd_target_url: draft.schedd_target_url.trim() } : {}),
      ...(draft.gateway_target_url.trim() ? { gateway_target_url: draft.gateway_target_url.trim() } : {}),
      vpcpus: vpcpus!,
      mem_mb: memMb!,
      max_concurrency: maxConcurrency!,
      admission_ceiling_mb: ceiling!,
      ...(draft.defer_activation ? { defer_activation: true } : {}),
    },
  };
}

/** Human-readable changes between an enrolled node and a re-enrollment, for the confirm dialog. */
export function enrollmentChanges(node: ComputeNode, body: ComputeNodeEnrollment): string[] {
  const changes: string[] = [];
  const cmp = (label: string, before: string | number | undefined, after: string | number | undefined) => {
    if (after !== undefined && String(before ?? '') !== String(after)) changes.push(`${label}: ${before ?? '—'} → ${after}`);
  };
  cmp('target', node.target_url, body.target_url);
  cmp('gateway target', node.gateway_target_url, body.gateway_target_url);
  cmp('vCPUs', node.vpcpus, body.vpcpus);
  cmp('memory MB', node.mem_mb, body.mem_mb);
  cmp('max concurrency', node.max_concurrency, body.max_concurrency);
  cmp('admission ceiling MB', node.admission_ceiling_mb, body.admission_ceiling_mb);
  if (body.schedd_target_url) changes.push(`schedd target → ${body.schedd_target_url}`);
  const lifecycle = enrollmentLifecycleEffect(node, !!body.defer_activation);
  if (lifecycle.changes) changes.push(`lifecycle: ${node.lifecycle} → ${lifecycle.after}`);
  return changes;
}

export const LIFECYCLE_TONE: Record<string, string> = {
  active: 'badge-success',
  draining: 'badge-warning',
  force_draining: 'badge-danger',
  maintenance: 'badge-warning',
  unavailable: 'badge-neutral',
  recovering: 'badge-info',
  retired: 'badge-neutral',
};
