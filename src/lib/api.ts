/* ==========================================================================
   Gregale operations — typed REST client for the apid control plane.

   Contract source of truth: the Go route table and response structs in
   faas (pkg/apid/apidserver, pkg/api). Operator routes (/v1/admin/*) are
   deliberately absent from api/openapi.yaml, so these types are maintained
   by hand and checked against origin/main.

   Auth model: the HttpOnly `faas_sid` session cookie set by POST /login.
   Requests go out same-origin (next.config rewrites /v1/* to apid) with
   credentials:'include'. Operator writes additionally need a fresh TOTP
   step-up, handled by the transport below.
   ========================================================================== */

/* ────────────────────────────── Models ─────────────────────────────────── */

export type Plan = 'free' | 'hobby' | 'pro' | 'scale';
export type AccountStatus = 'active' | 'past_due' | 'suspended' | 'deleted_pending';

/** @go api.AccountLimits */
export interface AccountLimits {
  plan: Plan;
  ram_mb: number;
  max_concurrency: number;
  deployed_apps: number;
  included_gb_hours: number;
  app_layer_max_mb: number;
}

/** @go api.AccountResponse */
export interface Account {
  id: string;
  email: string;
  plan: Plan;
  status: AccountStatus;
  limits: AccountLimits;
  usage_gb_hours: number;
  app_count: number;
  github_install_id: string | null;
}

export type AppType = 'app' | 'function';
export type Runtime = 'node22' | 'python312';

export interface AppManifest {
  entrypoint: string[];
  env?: Record<string, string>;
  working_dir?: string | null;
  port?: number | null;
  healthz?: string | null;
  user?: string | null;
}

export interface App {
  id: string;
  slug: string;
  type: AppType;
  runtime?: Runtime;
  ram_mb: number;
  max_concurrency: number;
  idle_timeout_s?: number | null;
  min_instances: number;
  eviction_priority?: 'best_effort' | 'reserved';
  status: string;
  url: string;
  manifest: AppManifest;
}

export interface Deployment {
  id: string;
  app_id: string;
  build_id?: string | null;
  image_digest: string;
  kind: string;
  status: string;
  error?: string | null;
  error_code?: string | null;
  created_at: string;
  stage_state?: Record<string, unknown>;
  source_url?: string | null;
  commit_sha?: string | null;
  source_root?: string;
  scope?: string | null;
  build_plan?: Record<string, unknown> | null;
  min_instances?: number;
  traffic_percent?: number;
  has_overrides?: boolean;
  canary_preset?: string;
  rollback_on_5xx?: boolean;
  rollout_state?: string;
}




export interface Instance {
  id: string;
  app_id: string;
  deployment_id: string;
  state: string;
  host_ip?: string | null;
  ram_mb: number;
  wake_id?: string;
  started_at?: string | null;
  last_request_at?: string | null;
  parked_at?: string | null;
}







/** Per-app usage row for one billing month (GET /v1/usage). */
export interface AppUsage {
  month?: string;
  app_id: string;
  mb_seconds: number;
  requests: number;
  included_gb_hours: number;
  used_gb_hours?: number;
}

export type InvocationSource = 'async_invoke' | 'queue' | 'delayed_task' | 'cron';
export type InvocationState = 'pending' | 'dispatching' | 'completed' | 'failed' | 'cancelled';

/** A row from the invocations table — the console's only per-request signal. */
export interface Invocation {
  id: string;
  app_id: string;
  account_id: string;
  source: InvocationSource;
  state: InvocationState;
  method?: string;
  path?: string;
  scheduled_at?: string | null;
  due_at?: string;
  created_at: string;
  completed_at?: string | null;
  instance_id?: string | null;
  last_error?: string | null;
  attempts?: number;
  received_at?: string | null;
  lease_expires_at?: string | null;
}


/**
 * RFC 7807 problem envelope returned by the backend on errors.
 * @go api.Problem
 */
export interface Problem {
  type?: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  limit?: number | null;
  observed?: number | null;
  docs_url?: string;
  billing_portal_url?: string;
}

/** Thrown by every client call on a non-2xx response. */
export class ApiError extends Error {
  status: number;
  code: string;
  problem: Problem | null;
  constructor(problem: Problem | null, status: number, fallback: string) {
    super(problem?.detail || problem?.title || fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = problem?.code || 'unknown';
    this.problem = problem;
  }
}

/* ────────────────────────────── Transport ──────────────────────────────── */

/** A fresh key for one logical operation; reuse it when that operation is retried. */
export function newIdempotencyKey(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Every /v1/admin/* write requires a TOTP step-up less than five minutes old
 * (403 step_up_required). The operations shell registers a handler that asks
 * the operator for a code and resolves true once /v1/account/mfa/verify has
 * re-issued the session cookie; the request is then replayed with the same
 * headers, including its Idempotency-Key, so the retry cannot double-apply.
 */
type StepUpHandler = (reason: ApiError) => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

export function setStepUpHandler(handler: StepUpHandler | null): void {
  stepUpHandler = handler;
}

/**
 * Both need a second factor before the request can go through:
 * step_up_required (enrolled, code older than five minutes) and mfa_required
 * (an mfa_pending session, or an operator who has never enrolled — see
 * needsEnrollment).
 */
export function isStepUpError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 403 && (err.code === 'step_up_required' || err.code === 'mfa_required');
}

/**
 * apid's requireEnrolledOperatorSession answers mfa_required with "platform
 * operators must enroll an authenticator" when the account has no TOTP at all;
 * a code prompt cannot satisfy that, enrollment can.
 */
export function needsEnrollment(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'mfa_required' && /must enroll/i.test(err.problem?.detail ?? '');
}

/**
 * Called when an authenticated request comes back 401 mid-session (expired or
 * revoked cookie). The shell signs the operator out locally and sends them to
 * the login page with a way back.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/** Paths whose 401 is an expected answer, not an expired session. */
const SESSION_PROBES = new Set(['/v1/account', '/v1/auth/logout', '/v1/auth/csrf']);

/** A request that has not answered by then is abandoned, so one hung call cannot freeze a page's polling. */
export const REQUEST_TIMEOUT_MS = 20_000;

async function readProblem(res: Response): Promise<Problem | null> {
  try {
    return (await res.json()) as Problem;
  } catch {
    /* non-JSON error body (e.g. rate-limit plain text) */
    return null;
  }
}

/**
 * All calls are relative and same-origin. In production the Vercel rewrites
 * in next.config.ts proxy /v1/* (and /login, /auth/*, /logout, /oauth/*) to
 * the DO backend, so the browser sees one origin and the session cookie is
 * first-party.
 */
export async function request<T>(
  path: string,
  init: RequestInit = {},
  parse: 'json' | 'none' = 'json',
): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const isAdminMutation = path.startsWith('/v1/admin/') && !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    // FormData must set its own Content-Type: the browser appends the
    // multipart boundary, and forcing application/json here would produce
    // a body the server cannot parse.
    ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string>),
  };
  if (isAdminMutation && !requestHeaders['Idempotency-Key']) {
    requestHeaders['Idempotency-Key'] = newIdempotencyKey();
  }
  const send = async (): Promise<Response> => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    // AbortSignal.any is recent; without it a caller's own signal wins over the timeout.
    const signal = !init.signal
      ? timeout.signal
      : typeof AbortSignal.any === 'function'
        ? AbortSignal.any([init.signal, timeout.signal])
        : init.signal;
    try {
      return await fetch(path, {
        ...init,
        signal,
        credentials: 'include',
        // API calls must never silently follow an HTML navigation redirect.
        // A redirect usually means middleware or auth routing is misconfigured;
        // surface it as an API error instead.
        redirect: 'manual',
        headers: requestHeaders,
      });
    } catch (err) {
      if (timeout.signal.aborted && !init.signal?.aborted) {
        throw new ApiError(null, 0, `The control plane did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.`);
      }
      throw new ApiError(null, 0, `Network error: could not reach the control plane (${(err as Error).message})`);
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await send();
  if (!res.ok) {
    let error = new ApiError(await readProblem(res), res.status, `Request failed (HTTP ${res.status})`);
    if (isStepUpError(error) && stepUpHandler && (await stepUpHandler(error))) {
      res = await send();
      if (!res.ok) error = new ApiError(await readProblem(res), res.status, `Request failed (HTTP ${res.status})`);
    }
    if (!res.ok) {
      if (error.status === 401 && !SESSION_PROBES.has(path.split('?')[0])) unauthorizedHandler?.();
      throw error;
    }
  }

  if (parse === 'none' || res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('json')) {
    throw new ApiError(null, res.status, `Control plane returned an unexpected response (HTTP ${res.status}; expected JSON).`);
  }
  return (await res.json()) as T;
}

/* ─────────────────────────────── Auth ──────────────────────────────────── */

/**
 * Body of a successful POST /login. No API key is ever returned.
 * @go api.PasswordLoginResponse
 */
export interface LoginResult {
  account_id: string;
  plan: Plan;
}

/** Minimum accepted by the backend (NIST-style: length only, no complexity). */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Shared form-post helper for the auth aliases. These endpoints answer with an
 * RFC 7807 problem document, so the body is parsed into an ApiError rather
 * than surfaced raw — dumping `{"type":"","title":"Validation failed",…}` into
 * the UI is how this page used to report a missing password.
 */
async function authPost(path: string, fields: Record<string, string>): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(fields).toString(),
    });
  } catch (err) {
    throw new ApiError(null, 0, `Network error: could not reach the control plane (${(err as Error).message})`);
  }

  if (!res.ok) {
    let problem: Problem | null = null;
    try {
      problem = (await res.json()) as Problem;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(problem, res.status, `Sign-in failed (HTTP ${res.status})`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('json')) {
    throw new ApiError(null, res.status, 'Authentication service returned an unexpected response.');
  }

  return (await res.json().catch(() => ({ account_id: '', plan: 'free' as Plan }))) as LoginResult;
}

/**
 * POST /login — email + password, verified against an Argon2id hash. Sets the
 * HttpOnly faas_sid session cookie on success.
 *
 * Anti-enumeration: an unknown email, a wrong password and an OAuth-only
 * account all return the same 401, so the UI must not try to distinguish them.
 */
export const login = (email: string, password: string) =>
  authPost('/api/auth/login', { email, password });

/** POST /login/forgot — always succeeds, so it can't be used to probe emails. */
export async function requestPasswordReset(email: string): Promise<void> {
  await authPost('/api/auth/forgot', { email }).catch((err) => {
    // A 4xx here would itself leak whether the address exists; only surface
    // transport failures.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) return;
    throw err;
  });
}

/** Mints a double-submit token bound to one browser action (GET /v1/auth/csrf). */
export const issueCSRF = async (action: 'auth.logout' | 'mfa_recover' | 'mfa_confirm') =>
  (await request<{ csrf_token: string }>(`/v1/auth/csrf?action=${encodeURIComponent(action)}`, { cache: 'no-store' })).csrf_token;

/**
 * Ends the server session. apid revokes it only when the JSON body carries a
 * CSRF token bound to auth.logout; without one it answers 400 csrf_mismatch
 * and the cookie stays valid. A 401 means the session is already gone.
 * @goBody - (apid reads csrf_token in middleware, no request struct)
 */
export async function logout(): Promise<void> {
  try {
    const csrf_token = await issueCSRF('auth.logout');
    await request<void>('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ csrf_token }) }, 'none');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (err instanceof ApiError && err.status === 0) return; // offline: the cookie expires on its own
    throw err;
  }
}

/**
 * POST /v1/account/mfa/verify — refreshes the session's five-minute step-up stamp.
 * @goBody api.MFAVerifyRequest
 */
export const verifyMfa = (totp: string) =>
  request<void>('/v1/account/mfa/verify', {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey() },
    body: JSON.stringify({ totp }),
  }, 'none');

/**
 * A new authenticator for the signed-in account: the QR code (PNG, base64),
 * the secret for manual entry, and one-time recovery codes shown only now.
 * @go api.MFAEnrollResponse
 */
export interface MfaEnrollment {
  otpauth_url: string;
  secret: string;
  qr_code_png_base64: string;
  recovery_codes: string[];
}

/**
 * POST /v1/account/mfa/enroll — starts enrollment. 409 means an authenticator
 * is already enrolled, so verify instead.
 * @goBody api.MFAEnrollRequest
 */
export const enrollMfa = () =>
  request<MfaEnrollment>('/v1/account/mfa/enroll', { method: 'POST', body: JSON.stringify({}) });

/**
 * POST /v1/account/mfa/confirm — proves the new authenticator works and
 * re-issues the session cookie as MFA-complete with a fresh step-up.
 * @goBody api.MFAConfirmRequest
 */
export async function confirmMfa(totp: string): Promise<void> {
  const csrf_token = await issueCSRF('mfa_confirm');
  await request<void>('/v1/account/mfa/confirm', {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey() },
    body: JSON.stringify({ totp, csrf_token }),
  }, 'none');
}

/**
 * POST /v1/account/mfa/recover — burns a recovery code; also refreshes step-up.
 * @goBody api.MFARecoverRequest
 */
export async function recoverMfa(code: string): Promise<void> {
  const csrf_token = await issueCSRF('mfa_recover');
  await request<void>('/v1/account/mfa/recover', {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey() },
    body: JSON.stringify({ code, csrf_token }),
  }, 'none');
}

/**
 * Whether the signed-in account is a platform operator. The admin scope alone
 * is held by every customer session; only the FAAS_ADMIN_EMAILS allowlist
 * admits /v1/admin/*, so a cheap admin read is the authoritative check.
 */
export async function probeOperatorAccess(): Promise<'granted' | 'denied'> {
  try {
    await request('/v1/admin/config', { cache: 'no-store' });
    return 'granted';
  } catch (err) {
    if (err instanceof ApiError && err.status === 403 && !isStepUpError(err)) return 'denied';
    throw err;
  }
}

/** Lightweight unauthenticated probe used by the operations shell. */
export async function probeControlPlane(): Promise<boolean> {
  try {
    const response = await fetch('/healthz', {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'manual',
      headers: { Accept: 'text/plain' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/* ────────────────────────────── Account ────────────────────────────────── */

export const getAccount = () => request<Account>('/v1/account', { cache: 'no-store' });

/* ────────────────────────── Operator & Admin (/v1/admin/*) ─────────────────────── */

/** @go api.ObsOverviewTotals */
export interface ObsOverviewTotals {
  accounts_active: number;
  accounts_past_due: number;
  accounts_suspended: number;
  orgs_total: number;
  apps_total: number;
  instances_live: number;
  instances_waking: number;
  nodes_active: number;
  nodes_inactive: number;
  audit_events_24h: number;
}

/** @go api.ObsOverviewRateLimited */
export interface ObsOverviewRateLimited {
  account_id: string;
  hits: number;
}

/** @go api.ObsOverviewNodeHealth */
export interface ObsOverviewNodeHealth {
  name: string;
  active: boolean;
  last_heartbeat_at?: string;
  stale: boolean;
}

/** @go api.ObsOverviewFailureKind */
export interface ObsOverviewFailureKind {
  kind: string;
  count: number;
}

/** @go api.ObsOverviewResponse */
export interface ObsOverviewResponse {
  generated_at: string;
  totals: ObsOverviewTotals;
  top_rate_limited_accounts_24h: ObsOverviewRateLimited[];
  node_health: ObsOverviewNodeHealth[];
  recent_failures_1h: ObsOverviewFailureKind[];
}

/** @go api.ObsHealthResponse */
export interface ObsHealthResponse {
  generated_at: string;
  prometheus_available: boolean;
  audit_log_write_total_5m: number;
  audit_log_write_failures_5m: number;
  audit_log_coverage_ratio_5m: number;
  operator_intent_outcome_missing_total: Record<string, number>;
  trace_id_completeness_ratio: Record<string, number>;
  alerts_firing: number;
}

/** @go api.ObsTenantRow */
export interface ObsTenantRow {
  account_id: string;
  plan: Plan;
  status: AccountStatus;
  org_slug?: string;
  is_personal: boolean;
  created_at: string;
  mfa_enrolled: boolean;
  apps_count: number;
  deployments_live_count: number;
  email?: string;
}

/** @go api.ObsTenantListResponse */
export interface ObsTenantListResponse {
  items: ObsTenantRow[];
  next_cursor: string;
  limit: number;
}

/** @go api.ObsTenantApp */
export interface ObsTenantApp {
  id: string;
  slug: string;
  status: string;
  deployments: number;
}

/** @go api.ObsTenantOrg */
export interface ObsTenantOrg {
  id: string;
  slug: string;
  role: string;
}

/** @go api.ObsTenantCounts */
export interface ObsTenantCounts {
  active: number;
  revoked: number;
}

/** @go api.ObsTenantDetailResponse */
export interface ObsTenantDetailResponse {
  account: ObsTenantRow;
  apps: ObsTenantApp[];
  orgs: ObsTenantOrg[];
  api_keys: ObsTenantCounts;
  sessions: ObsTenantCounts;
}

/** @go api.ObsTenant360Response */
export interface ObsTenant360Response extends ObsTenantDetailResponse {
  usage: ObsTenantUsage;
  billing: ObsTenantBilling;
}

/** @go api.ObsTenantUsage */
export interface ObsTenantUsage {
  month: string;
  used_gb_hours: number;
  included_gb_hours: number;
  overage_gb_hours: number;
  overage_cents: number;
  used_cpu_hours: number;
  used_egress_gb: number;
  used_ingress_gb: number;
  cold_boots: number;
  requests: number;
  apps: ObsTenantUsageApp[];
}

/** @go api.ObsTenantUsageApp */
export interface ObsTenantUsageApp {
  app_id: string;
  app_slug?: string;
  mb_seconds: number;
  cpu_usec: number;
  requests: number;
  tx_bytes: number;
  net_tx_bytes: number;
  net_rx_bytes: number;
  cold_boots: number;
}

/** @go api.ObsTenantBilling */
export interface ObsTenantBilling {
  current_month_overage_cents: number;
  overage_cap_cents?: number;
  active_credits_cents: number;
  invoices: ObsInvoiceSummary[];
}

/** @go api.ObsInvoiceSummary */
export interface ObsInvoiceSummary {
  id: string;
  provider: string;
  number?: string;
  status: string;
  currency: string;
  period_start: string;
  period_end: string;
  total_cents: number;
  amount_paid_cents: number;
}

/** @go api.ObsCapacityResponse */
export interface ObsCapacityResponse {
  generated_at: string;
  summary: ObsCapacitySummary;
  nodes: ObsCapacityNode[];
}

/** @go api.ObsCapacitySummary */
export interface ObsCapacitySummary {
  total_nodes: number;
  active_nodes: number;
  inactive_nodes: number;
  total_vcpus: number;
  total_vcpu_budget: number;
  total_mem_mb: number;
  total_admission_ceiling_mb: number;
  ram_used_mb: number;
  admission_margin_mb: number;
  instances_live: number;
  instances_running: number;
  instances_waking: number;
  instances_cold_booting: number;
  apps_total: number;
  tenants_total: number;
  unplaced_apps: number;
}

/** @go api.ObsCapacityNode */
export interface ObsCapacityNode {
  id: string;
  name: string;
  active: boolean;
  vpcpus: number;
  vcpu_budget: number;
  mem_mb: number;
  admission_ceiling_mb: number;
  instances_live: number;
  instances_running: number;
  instances_waking: number;
  instances_cold_booting: number;
  ram_used_mb: number;
  admission_margin_mb: number;
  apps_count: number;
  tenants_count: number;
}

/** @go api.ObsInvocationRow */
export interface ObsInvocationRow {
  id: string;
  app_id: string;
  app_slug?: string;
  state: string;
  source: string;
  method: string;
  path: string;
  outcome?: string;
  attempts: number;
  last_error?: string;
  created_at: string;
  completed_at?: string;
}

/** @go api.ObsAuditActivityRow */
export interface ObsAuditActivityRow {
  id: string;
  at: string;
  kind: string;
  actor?: string;
}

/** @go api.ObsTenantActivityResponse */
export interface ObsTenantActivityResponse {
  account_id: string;
  generated_at: string;
  invocations: ObsInvocationRow[];
  audit_events: ObsAuditActivityRow[];
  limit: number;
}

/** @go api.ObsAccountMutationResponse */
export interface ObsAccountMutationResponse {
  account: ObsTenantRow;
  action: string;
  revoked_sessions: number;
}

/** @go api.ObsDeploymentRow */
export interface ObsDeploymentRow {
  id: string;
  status: string;
  kind: string;
  image_digest?: string;
  source_url?: string;
  commit_sha?: string;
  error_code?: string;
  created_at: string;
}

/** @go api.ObsInstanceRow */
export interface ObsInstanceRow {
  id: string;
  app_id: string;
  app_slug?: string;
  account_id?: string;
  deployment_id: string;
  node_id?: string;
  node_name?: string;
  state: string;
  ram_mb: number;
  started_at: string;
  last_request_at: string;
  parked_at?: string;
}

/** @go api.ObsAppDetail */
export interface ObsAppDetail {
  id: string;
  account_id: string;
  slug: string;
  type: string;
  runtime: string;
  status: string;
  ram_mb: number;
  max_concurrency: number;
  min_instances: number;
  created_at: string;
}

/** @go api.ObsAppDetailResponse */
export interface ObsAppDetailResponse {
  app: ObsAppDetail;
  deployments: ObsDeploymentRow[];
  instances: ObsInstanceRow[];
  invocations: ObsInvocationRow[];
  health: ObsAppHealth;
}

/** @go api.AppErrorSummaryItem */
export interface ObsAppErrorSummary {
  fingerprint: string;
  error_class: string;
  route: string;
  http_status: number;
  count: number;
  request_count: number;
  first_seen_at: string;
  last_seen_at: string;
  sample_message: string;
}

export type MetricsRange = '5m' | '15m' | '1h' | '6h' | '24h' | '7d' | '15d';

/**
 * Per-app request metrics as embedded in the admin app drill-down.
 * @go api.AppMetricsResponse
 */
export interface AppMetrics {
  app_id: string;
  range: MetricsRange;
  source: string;
  as_of: string;
  request_count: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  error_rate_pct: number;
  cold_start_pct: number;
  wake_p95_ms: number;
  queue_depth: number;
}

/** @go api.ObsAppHealth */
export interface ObsAppHealth {
  generated_at: string;
  metrics: AppMetrics;
  errors: ObsAppErrorSummary[];
  errors_window_start: string;
  errors_window_end: string;
}

/** @go api.ObsNodeRow */
export interface ObsNodeRow {
  id: string;
  name: string;
  active: boolean;
  vpcpus: number;
  mem_mb: number;
  max_concurrency: number;
  admission_ceiling_mb: number;
  instances_live: number;
  instances_running: number;
  instances_waking: number;
  instances_cold_booting: number;
  ram_used_mb: number;
  admission_margin_mb: number;
  cpu_pct_60s?: number;
  disk_used_bytes?: number;
  overlay_ip?: string;
  last_heartbeat_at?: string;
  created_at: string;
}

/** @go api.ObsNodeListResponse */
export interface ObsNodeListResponse {
  items: ObsNodeRow[];
  next_cursor: string;
  limit: number;
}

/** @go api.ObsNodeApp */
export interface ObsNodeApp {
  id: string;
  slug: string;
  account_id: string;
  status: string;
  instances_live: number;
  instances_running: number;
  instances_waking: number;
  instances_cold_booting: number;
  ram_used_mb: number;
  last_request_at?: string;
}

/** @go api.ObsNodeDetailResponse */
export interface ObsNodeDetailResponse {
  node: ObsNodeRow;
  apps: ObsNodeApp[];
  instances: ObsInstanceRow[];
  drain: ObsNodeDrainStatus;
}

/** @go api.ObsNodeDrainStatus */
export interface ObsNodeDrainStatus {
  total_instances: number;
  live_instances: number;
  running_instances: number;
  waking_instances: number;
  cold_booting_instances: number;
  drain_safe: boolean;
  observed_at: string;
}

/** @go api.ObsNodeOperationPreflight */
export interface ObsNodeOperationPreflight {
  affected_apps: number;
  affected_tenants: number;
  total_instances: number;
  live_instances: number;
  live_ram_mb: number;
  capacity_change_mb: number;
  reversible: boolean;
  disruption_warning: boolean;
}

/**
 * 202 Accepted: the lifecycle change is queued as an operator intent and
 * converges asynchronously. `active` is the requested state, not the observed
 * one — poll `status_url` (getOperatorIntent) for the outcome.
 * @go api.ObsNodeMutationResponse
 */
export interface ObsNodeMutationResponse {
  ok: boolean;
  intent_id: string;
  status_url: string;
  expires_at: string;
  kind: string;
  node: string;
  previous_active: boolean;
  active: boolean;
  previous_lifecycle: string;
  requested_lifecycle: string;
  live_instances: number;
  forced: boolean;
  reason: string;
  preflight: ObsNodeOperationPreflight;
}

/** @go api.ObsHeartbeatRow */
export interface ObsHeartbeatRow {
  received_at: string;
  last_heartbeat_at: string;
  source: string;
  gap_to_previous_ms: number;
  missed: boolean;
  stale: boolean;
}

/** @go api.ObsHeartbeatListResponse */
export interface ObsHeartbeatListResponse {
  node_id: string;
  name: string;
  since: string;
  since_clamped: boolean;
  heartbeats: ObsHeartbeatRow[];
  limit: number;
}

/** @go api.ObsAnomalyRow */
export interface ObsAnomalyRow {
  account_id: string;
  app_id: string;
  minute: string;
  current: number;
  baseline_mean: number;
  baseline_stddev: number;
  baseline_samples: number;
  z_score: number | null;
  reason: string;
}

/** @go api.ObsAnomalyListResponse */
export interface ObsAnomalyListResponse {
  generated_at: string;
  window_hours: number;
  baseline_window_days: number;
  items: ObsAnomalyRow[];
}

/** @go api.ObsRateLimitDurableRow */
export interface ObsRateLimitDurableRow {
  account_id: string;
  hits: number;
  last_event_at: string;
}

/** @go api.ObsRateLimitLiveRow */
export interface ObsRateLimitLiveRow {
  ip: string;
  currently_rate_limited: boolean;
  live_hits_30s: number;
  last_event_at: string;
}

/** @go api.ObsRateLimitResponse */
export interface ObsRateLimitResponse {
  generated_at: string;
  window_hours: number;
  sources: string[];
  lag_seconds: number;
  durable: ObsRateLimitDurableRow[];
  live: ObsRateLimitLiveRow[];
}

/**
 * One provider product/price handle. Plan is a billable plan (free has none).
 * @go api.BillingCatalogEntry
 */
export interface BillingCatalogEntry {
  plan: string;
  kind: 'monthly' | 'overage' | 'product' | string;
  handle: string;
  synced_at: string;
}

/**
 * Providers without a catalog surface answer 501 instead of this body.
 * @go api.BillingCatalogResponse
 */
export interface BillingCatalogResponse {
  provider: string;
  synced_at: string;
  entries: BillingCatalogEntry[];
}

/**
 * One audit_log row, as both /v1/audit-log/all and the admin search return it.
 * @go api.ObsAuditLogRow
 */
export interface GlobalAuditLogEntry {
  id: string;
  kind: string;
  account_id?: string;
  account_email?: string;
  actor?: string;
  received_at: string;
  data?: Record<string, unknown> | null;
  /** Admin search only: true for operator.action.* kinds. */
  is_operator_action?: boolean;
}

/**
 * GET /v1/audit-log/all. next_before is omitted on the last page.
 * @go api.ListAuditLogResponse
 */
export interface GlobalAuditLogResponse {
  entries: GlobalAuditLogEntry[];
  limit: number;
  next_before?: string;
}

export const getObsOverview = () =>
  request<ObsOverviewResponse>('/v1/admin/obs/overview', { cache: 'no-store' });

export const getObsHealth = () =>
  request<ObsHealthResponse>('/v1/admin/obs/health', { cache: 'no-store' });

export interface ObsTenantFilters {
  plan?: string;
  status?: string;
}

export const listObsTenants = (limit = 200, cursor?: string, includePii = false, filters: ObsTenantFilters = {}) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set('cursor', cursor);
  if (includePii) q.set('include_pii', '1');
  if (filters.plan) q.set('plan', filters.plan);
  if (filters.status) q.set('status', filters.status);
  return request<ObsTenantListResponse>(`/v1/admin/obs/tenants?${q}`, { cache: 'no-store' });
};

export const getObsTenantDetail = (id: string, includePii = false) => {
  const q = includePii ? '?include_pii=1' : '';
  return request<ObsTenantDetailResponse>(`/v1/admin/obs/tenants/${encodeURIComponent(id)}${q}`, { cache: 'no-store' });
};

export const getObsTenantActivity = (id: string, limit = 50) =>
  request<ObsTenantActivityResponse>(
    `/v1/admin/obs/tenants/${encodeURIComponent(id)}/activity?limit=${limit}`,
    { cache: 'no-store' },
  );

export const getObsTenant360 = (id: string, month?: string, includePii = false) => {
  const q = new URLSearchParams();
  if (month) q.set('month', month);
  if (includePii) q.set('include_pii', '1');
  const query = q.toString();
  return request<ObsTenant360Response>(
    `/v1/admin/obs/tenants/${encodeURIComponent(id)}/360${query ? `?${query}` : ''}`,
    { cache: 'no-store' },
  );
};

export const getObsCapacity = () =>
  request<ObsCapacityResponse>('/v1/admin/obs/capacity', { cache: 'no-store' });

/**
 * Operator writes take the caller's Idempotency-Key so a retry of the same
 * logical operation (timeout, step-up prompt, double click) replays instead of
 * applying twice. Pages hold one key per open dialog (useOperationKey).
 */
export interface OperatorWrite {
  idempotencyKey?: string;
}

/** Headers for an operator write; area clients in src/lib/ops/* use this too. */
export const writeHeaders = (opts?: OperatorWrite): Record<string, string> =>
  opts?.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {};

/**
 * Lifecycle endpoints require `reason` to match [a-z0-9_]{1,64} and an
 * explicit `confirm=true`, which the console sends only after the operator has
 * confirmed in a dialog.
 */
const mutateObsAccount = (id: string, action: 'suspend' | 'restore' | 'revoke-sessions', reason: string, opts?: OperatorWrite) =>
  request<ObsAccountMutationResponse>(
    `/v1/admin/ops/accounts/${encodeURIComponent(id)}/${action}?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

export const suspendObsAccount = (id: string, reason: string, opts?: OperatorWrite) =>
  mutateObsAccount(id, 'suspend', reason, opts);

export const restoreObsAccount = (id: string, reason: string, opts?: OperatorWrite) =>
  mutateObsAccount(id, 'restore', reason, opts);

export const revokeObsAccountSessions = (id: string, reason: string, opts?: OperatorWrite) =>
  mutateObsAccount(id, 'revoke-sessions', reason, opts);

export const getObsAppDetail = (id: string) =>
  request<ObsAppDetailResponse>(`/v1/admin/obs/apps/${encodeURIComponent(id)}`, { cache: 'no-store' });

/** @go api.AccountCreditResponse */
export interface AccountCreditResponse {
  id: string;
  cents_remaining: number;
  reason: string;
}

/** @goBody apidserver.issueCreditPayload */
export const issueAccountCredit = (accountId: string, amountCents: number, reason: string, opts?: OperatorWrite) =>
  request<AccountCreditResponse>(
    `/v1/admin/accounts/${encodeURIComponent(accountId)}/credits`,
    { method: 'POST', headers: writeHeaders(opts), body: JSON.stringify({ cents: amountCents, reason }) },
  );

/** @go api.AdminRefundResponse */
export interface AdminRefundResponse {
  account_id: string;
  invoice_id: string;
  provider: string;
  provider_refund_id: string;
  charge_id: string;
  amount_cents: number;
  currency: string;
  status: string;
}

/** @goBody apidserver.adminRefundPayload */
export const refundAccount = (
  accountId: string,
  invoiceId: string,
  amountCents: number,
  reason: string,
  opts?: OperatorWrite,
) =>
  request<AdminRefundResponse>(
    `/v1/admin/accounts/${encodeURIComponent(accountId)}/refunds`,
    {
      method: 'POST',
      headers: writeHeaders(opts),
      body: JSON.stringify({ invoice_id: invoiceId, amount_cents: amountCents, reason }),
    },
  );

/** @go api.BillingReconcileResponse */
export interface BillingReconcileResponse {
  account_id: string;
  start: string;
  end: string;
  mb_seconds: number;
}

export const reconcileAccount = (accountId: string, opts?: OperatorWrite) =>
  request<BillingReconcileResponse>(
    `/v1/admin/billing-reconcile/${encodeURIComponent(accountId)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

/** Drained and retired nodes are listed only with include_inactive=1. */
export const listObsNodes = (cursor?: string, includeInactive = true) => {
  const q = new URLSearchParams();
  if (cursor) q.set('cursor', cursor);
  if (includeInactive) q.set('include_inactive', '1');
  const query = q.toString();
  return request<ObsNodeListResponse>(`/v1/admin/obs/nodes${query ? `?${query}` : ''}`, { cache: 'no-store' });
};

export const getObsNodeHeartbeats = (name: string, sinceMinutes = 30) =>
  request<ObsHeartbeatListResponse>(
    `/v1/admin/obs/nodes/${encodeURIComponent(name)}/heartbeats?since=${encodeURIComponent(new Date(Date.now() - sinceMinutes * 60000).toISOString())}`,
    { cache: 'no-store' },
  );

export const getObsNodeDetail = (name: string) =>
  request<ObsNodeDetailResponse>(
    `/v1/admin/obs/nodes/${encodeURIComponent(name)}/detail`,
    { cache: 'no-store' },
  );

export type ObsNodeAction = 'drain' | 'force-drain' | 'activate' | 'retire';

export const mutateObsNode = (name: string, action: ObsNodeAction, reason: string, opts?: OperatorWrite) =>
  request<ObsNodeMutationResponse>(
    `/v1/admin/ops/nodes/${encodeURIComponent(name)}/${action}?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

export const drainObsNode = (name: string, reason: string, opts?: OperatorWrite) =>
  mutateObsNode(name, 'drain', reason, opts);

export const forceDrainObsNode = (name: string, reason: string, opts?: OperatorWrite) =>
  mutateObsNode(name, 'force-drain', reason, opts);

export const activateObsNode = (name: string, reason: string, opts?: OperatorWrite) =>
  mutateObsNode(name, 'activate', reason, opts);

export const retireObsNode = (name: string, reason: string, opts?: OperatorWrite) =>
  mutateObsNode(name, 'retire', reason, opts);

export const getObsAnomalies = (windowHours = 24) =>
  request<ObsAnomalyListResponse>(`/v1/admin/obs/anomalies?window_hours=${windowHours}`, { cache: 'no-store' });

export const getObsRateLimits = (windowHours = 24) =>
  request<ObsRateLimitResponse>(`/v1/admin/obs/rate-limits?window_hours=${windowHours}`, { cache: 'no-store' });

export const listPaddleCatalog = () =>
  request<BillingCatalogResponse>('/v1/admin/billing-paddle-catalog', { cache: 'no-store' });

export const syncPaddleCatalog = (opts?: OperatorWrite) =>
  request<BillingCatalogResponse>('/v1/admin/billing-paddle-catalog/sync', { method: 'POST', headers: writeHeaders(opts) });

export const resetPaddleCatalog = (opts?: OperatorWrite) =>
  request<void>('/v1/admin/billing-paddle-catalog', { method: 'DELETE', headers: writeHeaders(opts) }, 'none');

/** @go api.BillingPaddleOveragePreflightResponse */
export interface BillingPaddleOveragePreflightResponse {
  table_exists: boolean;
  has_window_start: boolean;
  has_state: boolean;
  has_claimed_at: boolean;
  has_claimed_by: boolean;
  pending_rows: number;
  completed_rows: number;
}

export const getPaddleOveragePreflight = () =>
  request<BillingPaddleOveragePreflightResponse>('/v1/admin/billing-paddle-overage/preflight', { cache: 'no-store' });

/** @go api.ObsEventRow */
export interface ObsEventRow {
  id: number;
  at: string;
  kind: string;
  actor: string;
  subject?: string;
  data?: Record<string, unknown> | null;
}

/** @go api.ObsEventListResponse */
export interface ObsEventListResponse {
  generated_at: string;
  items: ObsEventRow[];
  limit: number;
  window_hours?: number;
  kind_prefix?: string;
  actor?: string;
  subject?: string;
}

export const listObsEvents = (limit = 100, kindPrefix?: string, actor?: string, subject?: string) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (kindPrefix) q.set('kind_prefix', kindPrefix);
  if (actor) q.set('actor', actor);
  if (subject) q.set('subject', subject);
  return request<ObsEventListResponse>(`/v1/admin/obs/events?${q}`, { cache: 'no-store' });
};

/** Same-origin SSE feed for app, deployment, instance, and node changes. */
export const obsNodeEventsUrl = '/v1/admin/obs/nodes/events';

/** @go api.AdminSetGithubWebhookSecretResponse */
export interface AdminSetGithubWebhookSecretResponse {
  installation_id: number;
  upgraded_at: string;
  upgraded_by: string;
}

/** @goBody apidserver.setGithubWebhookSecretPayload */
export const setGithubWebhookSecret = (installationId: number, secretHex: string, opts?: OperatorWrite) =>
  request<AdminSetGithubWebhookSecretResponse>('/v1/admin/github-webhook-secrets', {
    method: 'POST',
    headers: writeHeaders(opts),
    body: JSON.stringify({ installation_id: installationId, secret_hex: secretHex }),
  });

export const listGlobalAuditLog = (limit = 100, before?: string, includeAnonymous = true) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set('before', before);
  if (includeAnonymous) q.set('include_anonymous', 'true');
  return request<GlobalAuditLogResponse>(`/v1/audit-log/all?${q}`, { cache: 'no-store' });
};

export type OperatorIntentStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown';

export const TERMINAL_INTENT_STATUSES: readonly OperatorIntentStatus[] = ['succeeded', 'failed', 'cancelled', 'outcome_unknown'];

/** @go api.OperatorParkExecutionResponse */
export interface OperatorParkExecution {
  phase: string;
  node_id: string;
  wake_id: string;
  generation: string;
  action: string;
  capture_completed: boolean;
  stopped_at?: string;
  terminal_state?: string;
  cold_boot_required: boolean;
  reason?: string;
  updated_at: string;
}

/** @go api.OperatorIntentResponse */
export interface OperatorIntentResponse {
  intent_id: string;
  kind: string;
  status: OperatorIntentStatus;
  target_id: string;
  account_id?: string;
  actor_id: string;
  reason: string;
  metadata?: Record<string, unknown> | null;
  trace_id?: string;
  requested_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  snap_ids_marked_stale?: string[];
  park_execution?: OperatorParkExecution;
  restart_execution?: Record<string, unknown>;
  cold_boot_generation?: number;
}

/** @go api.OperatorIntentAcceptedResponse */
export interface OperatorIntentAcceptedResponse {
  ok: boolean;
  intent_id: string;
  status_url: string;
  expires_at: string;
}

export type RuntimeConfigApplyMode = 'hot' | 'graceful' | 'rolling' | 'break_glass';
export type RuntimeConfigStatus = 'pending' | 'applied' | 'failed' | 'blocked';
export type RuntimeConfigScope = 'global' | 'control_plane' | 'daemon' | 'node';
export type RuntimeConfigKind =
  | 'boolean'
  | 'integer'
  | 'duration'
  | 'string'
  | 'enum'
  | 'secret_reference'
  /** ADR-1700 platform flags: values are JSON objects, edited as JSON. */
  | 'platform_flag'
  | 'platform_flag_groups'
  | 'platform_flag_opt_ins';

export interface OperatorRuntimeConfigAck {
  consumer: string;
  node_id?: string;
  version: number;
  status: 'applied' | 'failed';
  effective_value?: unknown;
  error?: string;
  updated_at: string;
  applied_at?: string;
}

export interface OperatorRuntimeConfigTarget {
  scope: RuntimeConfigScope;
  scopeId?: string;
}

/** @go apidserver.runtimeConfigEntryResponse */
export interface OperatorRuntimeConfig {
  key: string;
  label: string;
  description: string;
  category: string;
  kind: RuntimeConfigKind;
  default_value: unknown;
  desired_value: unknown;
  effective_value: unknown;
  source: 'default_or_environment' | 'operator';
  apply_mode: RuntimeConfigApplyMode;
  controller_enabled: boolean;
  mutable: boolean;
  sensitive: boolean;
  status: RuntimeConfigStatus;
  last_error?: string;
  version: number;
  updated_at?: string;
  applied_at?: string;
}

/** @go apidserver.runtimeConfigListResponse */
export interface OperatorRuntimeConfigListResponse {
  items: OperatorRuntimeConfig[];
  generated_at: string;
}

/** @go api.OperatorRuntimeConfigOperation */
export interface OperatorRuntimeConfigOperation {
  id: string;
  key: string;
  scope: RuntimeConfigScope;
  scope_id: string;
  version: number;
  desired_value: unknown;
  effective_value: unknown;
  apply_mode: Exclude<RuntimeConfigApplyMode, 'hot'>;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled';
  phase: string;
  error?: string;
  reason: string;
  target_count: number;
  applied_count: number;
  failed_count: number;
  requested_at: string;
  started_at?: string;
  finished_at?: string;
}

/** @go api.OperatorRuntimeConfigRevision */
export interface OperatorRuntimeConfigRevision {
  id: number;
  key: string;
  scope: RuntimeConfigScope;
  scope_id: string;
  version: number;
  old_value: unknown;
  new_value: unknown;
  actor_id?: string;
  reason: string;
  created_at: string;
}

export const getOperatorRuntimeConfig = () =>
  request<OperatorRuntimeConfigListResponse>('/v1/admin/config', { cache: 'no-store' });

/**
 * apid accepts exactly {value, reason, expected_version, force} and rejects
 * unknown fields with 400, so no scope or rollout fields are sent. `force` is
 * required to disable a core platform flag (the first attempt answers 409).
 * expected_version must be the version the operator was looking at when they
 * started editing, so a concurrent change surfaces as a conflict.
 * @goBody apidserver.runtimeConfigPatchRequest
 */
export const updateOperatorRuntimeConfig = (
  key: string,
  value: unknown,
  reason: string,
  expectedVersion: number,
  opts: OperatorWrite & { force?: boolean } = {},
) =>
  request<OperatorRuntimeConfig | OperatorRuntimeConfigOperation>(
    `/v1/admin/config/${encodeURIComponent(key)}`,
    {
      method: 'PATCH',
      headers: writeHeaders(opts),
      body: JSON.stringify({
        value,
        reason,
        expected_version: expectedVersion,
        ...(opts.force ? { force: true } : {}),
      }),
    },
  );

/** @goBody apidserver.runtimeConfigRollbackRequest */
export const rollbackOperatorRuntimeConfig = (
  key: string,
  version: number,
  reason: string,
  expectedVersion: number,
  opts: OperatorWrite & { force?: boolean } = {},
) =>
  request<OperatorRuntimeConfig | OperatorRuntimeConfigOperation>(
    `/v1/admin/config/${encodeURIComponent(key)}/rollback`,
    {
      method: 'POST',
      headers: writeHeaders(opts),
      body: JSON.stringify({
        version,
        reason,
        expected_version: expectedVersion,
        ...(opts.force ? { force: true } : {}),
      }),
    },
  );

export const getOperatorRuntimeConfigOperation = (operationId: string) =>
  request<OperatorRuntimeConfigOperation>(
    `/v1/admin/config-operations/${encodeURIComponent(operationId)}`,
    { cache: 'no-store' },
  );

export const getOperatorRuntimeConfigRevisions = (key: string, limit = 20) => {
  const query = new URLSearchParams({ limit: String(limit) });
  return request<{ items: OperatorRuntimeConfigRevision[] }>(
    `/v1/admin/config/${encodeURIComponent(key)}/revisions?${query.toString()}`,
    { cache: 'no-store' },
  );
};

/** @go api.SweepStuckBuildsResponse */
export interface SweepStuckBuildsResponse {
  ok: boolean;
  swept_count: number;
  older_than_seconds: number;
  threshold_iso: string;
}

/** @go api.ObsBuilderHeartbeatRow */
export interface ObsBuilderHeartbeatRow {
  node_id: string;
  received_at: string;
  cpu_pct_60s: number | null;
  disk_used_bytes: number | null;
}

/** @go api.ObsBuilderHeartbeatListResponse */
export interface ObsBuilderHeartbeatListResponse {
  generated_at: string;
  items: ObsBuilderHeartbeatRow[];
  queued_builds: number;
}

/**
 * Cumulative counters of the secret rekey walk. When the rekey runner is off
 * the endpoint answers 503 rekey_disabled rather than a body.
 * @go api.RekeyProgress
 */
export interface RekeyProgressResponse {
  total: number;
  rekeyed: number;
  skipped: number;
  failed: number;
  last_id?: string;
}

/** @go api.ObsWakeLatencyQuantile */
export interface ObsWakeLatencyRow {
  node_id: string;
  node_name: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  sample_count: number;
}

/** @go api.ObsNodeWakeLatencyResponse */
export interface ObsWakeLatencyResponse {
  window: string;
  quantiles: ObsWakeLatencyRow[];
  fleet_p95_ms: number;
  as_of: string;
  prometheus_available: boolean;
}

export interface AuditLogSearchParams {
  since?: string;
  before?: string;
  kind_prefix?: string;
  include_anonymous?: boolean;
  limit?: number;
  actor_email?: string;
  operator_only?: boolean;
  target_account_id?: string;
}

/** @go api.ObsAuditLogSearchResponse */
export interface ObsAuditLogSearchResponse {
  generated_at: string;
  items: GlobalAuditLogEntry[];
  limit: number;
  include_anonymous: boolean;
  window_hours: number;
  /** Omitted on the last page. */
  next_before?: string;
}

export const forceParkInstance = (instanceId: string, reason: string, opts?: OperatorWrite) =>
  request<OperatorIntentAcceptedResponse>(
    `/v1/admin/instances/${encodeURIComponent(instanceId)}/force-park?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

export const forceRestartInstance = (instanceId: string, reason: string, opts?: OperatorWrite) =>
  request<OperatorIntentAcceptedResponse>(
    `/v1/admin/instances/${encodeURIComponent(instanceId)}/force-restart?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

export const forceColdBootApp = (slug: string, reason: string, opts?: OperatorWrite) =>
  request<OperatorIntentAcceptedResponse>(
    `/v1/admin/apps/${encodeURIComponent(slug)}/force-cold-boot?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

export const getOperatorIntent = (intentId: string) =>
  request<OperatorIntentResponse>(`/v1/admin/operator-intents/${encodeURIComponent(intentId)}`, {
    cache: 'no-store',
  });

export const sweepStuckBuilds = (olderThan: string, reason: string, opts?: OperatorWrite) =>
  request<SweepStuckBuildsResponse>(
    `/v1/admin/builds/sweep-stuck?confirm=true&older_than=${encodeURIComponent(olderThan)}&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

export const getObsBuilderHeartbeats = () =>
  request<ObsBuilderHeartbeatListResponse>('/v1/admin/obs/builder-heartbeats', {
    cache: 'no-store',
  });

export const getRekeyProgress = () =>
  request<RekeyProgressResponse>('/v1/admin/secrets/rekey-progress', {
    cache: 'no-store',
  });

export const getObsWakeLatencies = () =>
  request<ObsWakeLatencyResponse>('/v1/admin/obs/nodes/wake-latency', {
    cache: 'no-store',
  });

export const searchObsAuditLog = (params: AuditLogSearchParams = {}) => {
  const q = new URLSearchParams();
  if (params.since) q.set('since', params.since);
  if (params.before) q.set('before', params.before);
  if (params.kind_prefix) q.set('kind_prefix', params.kind_prefix);
  if (params.include_anonymous !== undefined) q.set('include_anonymous', String(params.include_anonymous));
  if (params.limit) q.set('limit', String(params.limit));
  if (params.actor_email) q.set('actor_email', params.actor_email);
  if (params.operator_only) q.set('operator_only', 'true');
  if (params.target_account_id) q.set('target_account_id', params.target_account_id);
  return request<ObsAuditLogSearchResponse>(`/v1/admin/obs/audit-log/search?${q}`, {
    cache: 'no-store',
  });
};
