/* ==========================================================================
   Gregale — typed REST client for the apid control plane (/v1/*)

   Contract source of truth: faas/api/openapi.yaml. Every path, method and
   response shape below is verified against the live backend, not guessed.

   Auth model: the web console authenticates with the HttpOnly `faas_sid`
   session cookie set by POST /login (and the OAuth flows). All requests go
   out same-origin (Vercel rewrites proxy /v1/* to the DO backend) with
   credentials:'include', so the cookie rides along automatically. We never
   store the raw API key in the browser.
   ========================================================================== */

/* ────────────────────────────── Models ─────────────────────────────────── */

export type Plan = 'free' | 'hobby' | 'pro' | 'scale';
export type AccountStatus = 'active' | 'past_due' | 'suspended' | 'deleted_pending';

export interface AccountLimits {
  plan: Plan;
  ram_mb: number;
  max_concurrency: number;
  deployed_apps: number;
  included_gb_hours: number;
  app_layer_max_mb: number;
}

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
}

export interface DeploymentList {
  items: Deployment[];
  next_before: string | null;
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

export interface CustomDomain {
  domain: string;
  app_id: string;
  challenge_token?: string | null;
  verified: boolean;
  verified_at?: string | null;
  txt_record?: string | null;
}

export interface Cron {
  id: string;
  app_id: string;
  schedule: string;
  path: string;
  enabled: boolean;
  created_at: string;
  last_fired_at?: string | null;
}

export interface ApiKey {
  id: string;
  prefix: string;
  label: string | null;
  last_used_at?: string | null;
  created_at: string;
  /** Present ONLY in the POST /v1/keys response; never returned again. */
  plaintext?: string | null;
}

export interface UsageSummary {
  month: string;
  used_gb_hours: number;
  included_gb_hours: number;
  overage_gb_hours: number;
  overage_cents: number;
}

export interface AppSecret {
  key: string;
  created_at: string;
  updated_at: string;
}

export interface AppSecretList {
  secrets: AppSecret[];
  quota_max: number;
  count: number;
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

export interface InvocationList {
  invocations: Invocation[];
}

/* ─────────────────────────── Metrics (#273 / #393) ─────────────────────── */

/** Closed vocabulary bounded by Prometheus retention (prom_retention_days: 15). */
export type MetricsRange = '5m' | '15m' | '1h' | '6h' | '24h' | '7d' | '15d';

export const METRICS_RANGES: MetricsRange[] = ['5m', '15m', '1h', '6h', '24h', '7d', '15d'];

/**
 * Gateway-measured metrics for one app. Latencies are 2xx-class only;
 * failures surface via error_rate_pct. `wake_p95_ms` is the FLEET p95 — the
 * underlying histogram is unlabeled, so it is NOT this app's wake latency.
 *
 * On Prometheus failure the endpoint still returns 200 with zeroed fields and
 * `source: "degraded: <reason>"`. Callers must branch on `source`, not on the
 * numbers, or they will render a convincing wall of zeros.
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

/** Account-wide rollup: same per-app shape, keyed by app slug. */
export interface AppsMetrics {
  range: MetricsRange;
  source: string;
  as_of: string;
  apps: Record<string, AppMetrics> | null;
}

/** True when the rollup came back degraded and its numbers are meaningless. */
export const isDegraded = (source: string | undefined): boolean =>
  !!source && source.startsWith('degraded');

/** Reason text from a `degraded: <reason>` source string. */
export const degradedReason = (source: string): string =>
  source.replace(/^degraded:\s*/, '') || 'metrics backend unavailable';

/* ──────────────────────── Account-scoped lists (#393) ──────────────────── */

export interface InstanceList {
  instances: Instance[];
  next_before?: string | null;
}

/** One sealed secret with its owning app attached. Plaintext never appears. */
export interface AccountSecret {
  app_id: string;
  app_slug: string;
  key: string;
  ciphertext: string;
  created_at: string;
  updated_at: string;
}

export interface AccountSecretList {
  secrets: AccountSecret[];
  next_before?: string | null;
}

/* ────────────────────────────── Env vars (#395) ────────────────────────── */

/** Env var envelope. The plaintext value is not returned on list. */
export interface AppEnv {
  key: string;
  created_at: string;
  updated_at: string;
}

export interface AppEnvList {
  env: AppEnv[];
  quota_max: number;
  count: number;
}

/* ────────────────────────── Outbound Webhooks (#476) ───────────────────── */

export type AppWebhookEventType = 'cron.fired' | 'app.created' | 'app.deleted' | 'build.succeeded' | 'build.failed';
export type AppWebhookRetryPolicy = 'default' | 'aggressive' | 'none';
export type AppWebhookDeliveryStatus = 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'dead';

export interface AppWebhook {
  id: string;
  app_id: string;
  account_id: string;
  target_url: string;
  webhook_secret_sealed_masked: string;
  event_filter: AppWebhookEventType[];
  retry_policy: AppWebhookRetryPolicy;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAppWebhookInput {
  target_url: string;
  webhook_secret?: string;
  event_filter?: AppWebhookEventType[];
  retry_policy?: AppWebhookRetryPolicy;
  enabled?: boolean;
}

export interface AppWebhookDelivery {
  id: string;
  webhook_id: string;
  app_id: string;
  account_id: string;
  event: string;
  payload?: Record<string, unknown>;
  attempt: number;
  status: AppWebhookDeliveryStatus;
  last_error?: string;
  last_response_code?: number;
  next_attempt_at: string;
  delivered_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AppWebhookDeliveryListResponse {
  deliveries: AppWebhookDelivery[];
  next_token?: string | null;
}

/* ─────────────────────── Queue introspection (#394) ────────────────────── */

export interface QueueState {
  app_slug: string;
  plan: Plan;
  plan_cap: number;
  depth: number;
  in_flight: number;
  oldest_pending_at?: string | null;
  oldest_pending_age_seconds?: number | null;
  generated_at: string;
}

/** A pending row. Peeking acquires no lease and does not bump `attempts`. */
export interface QueuePeekMessage {
  id: string;
  created_at: string;
  attempts: number;
  payload: string;
  last_error?: string;
}

export interface QueuePeek {
  app_slug: string;
  messages: QueuePeekMessage[];
  next_before?: string;
}

/** A row that exhausted the plan's retry budget. */
export interface QueueDeadLetterMessage {
  id: string;
  created_at: string;
  failed_at: string;
  attempts: number;
  last_error: string;
  payload: string;
}

export interface QueueDeadLetter {
  app_slug: string;
  messages: QueueDeadLetterMessage[];
  next_before?: string;
}

/* ────────────────────────── Alert rules (#396) ─────────────────────────── */

export type AlertMetric =
  | 'error_rate_pct'
  | 'latency_p50_ms'
  | 'latency_p95_ms'
  | 'latency_p99_ms'
  | 'cold_start_pct'
  | 'request_count'
  | 'failed_invocations';

export type AlertComparison = 'gt' | 'gte' | 'lt' | 'lte';
export type AlertFailureSource = 'any' | 'cron' | 'queue' | 'delayed_task' | 'async_invoke';

export interface AlertRule {
  id: string;
  /** Empty string means an account-wide rule. */
  app_id: string;
  name: string;
  enabled: boolean;
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: number;
  window_spec: MetricsRange;
  failure_source?: AlertFailureSource;
  webhook_url: string;
  webhook_secret_sealed_masked: string;
  cooldown_minutes: number;
  state: 'ok' | 'firing';
  last_fired_at?: string | null;
  last_evaluated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAlertRuleInput {
  name: string;
  enabled?: boolean;
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: number;
  window_spec: MetricsRange;
  /** Required when metric === 'failed_invocations'; must be omitted otherwise. */
  failure_source?: AlertFailureSource;
  webhook_url: string;
  webhook_secret: string;
  cooldown_minutes?: number;
}

/* ───────────────────────────── Sessions (IAM-3) ────────────────────────── */

export interface SessionInfo {
  id: string;
  account_id: string;
  issued_ip?: string;
  issued_ua?: string;
  issued_at: string;
  last_seen_at?: string;
  /** Exactly one row in a list response carries this. */
  current_session: boolean;
}

export interface SessionList {
  sessions: SessionInfo[];
}

/* ──────────────────────── GitHub App installation ──────────────────────── */

/** A repo the account's GitHub App installation can see. */
export interface InstallRepo {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
}

export interface InstallBindResult {
  binding_id?: string;
}

/**
 * Lists repos for one installation. This is a POST, not a GET, because the
 * installation id travels in the body.
 *
 * SPEC ODDITY: the endpoint reuses `InstallBindRequest`, which declares
 * `repo_full_name` as required — a field that has no meaning when listing.
 * Only `installation_id` is sent here; inventing a placeholder repo name to
 * satisfy a schema would put fiction on the wire. If the server enforces the
 * shared schema this surfaces as a validation error the caller can act on.
 */
export const listInstallRepos = (installationId: number) =>
  request<InstallRepo[]>('/v1/install/repos/list', {
    method: 'POST',
    body: JSON.stringify({ installation_id: installationId }),
    cache: 'no-store',
  });

/** Persists the (account, app, installation, repo, branch) bind row. */
export const bindAppInstall = (
  slug: string,
  installationId: number,
  repoFullName: string,
  productionBranch?: string,
) =>
  request<InstallBindResult>(`/v1/apps/${slug}/install/bind`, {
    method: 'POST',
    body: JSON.stringify({
      installation_id: installationId,
      repo_full_name: repoFullName,
      ...(productionBranch ? { production_branch: productionBranch } : {}),
    }),
  });

/* ────────────────────── Build provenance / SBOM (#197) ─────────────────── */

/**
 * "What actually ran" record for one successful build. Empty strings are
 * meaningful: they mark columns the Phase-3 populator (cosign + syft) has not
 * filled yet, so the UI must distinguish empty from absent.
 */
export interface BuildProvenance {
  id: string;
  build_id: string;
  buildkit_version?: string;
  railpack_version?: string;
  base_digest?: string;
  source_sha256: string;
  source_url?: string;
  commit_sha?: string;
  plan: string;
  runner_digest?: string;
  builder_node_id: string;
  started_at: string;
  finished_at: string;
  sbom_storage_key?: string | null;
}

/* ───────────────────────────── Invoices (#259) ─────────────────────────── */

export interface Invoice {
  id: string;
  provider: 'stripe' | 'paddle';
  provider_invoice_id: string;
  number?: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  period_start: string;
  period_end: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  currency: string;
  /**
   * The hosted PDF URL is provider-scoped and deliberately not on the wire —
   * customers fetch it from the Stripe/Paddle portal. This flag is the only
   * PDF surface the API exposes.
   */
  pdf_available: boolean;
  created_at: string;
}

export interface InvoiceList {
  items: Invoice[];
  next_before?: string | null;
}

/** Security-event timeline row (GET /v1/audit-events). */
export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  kind: string;
  subject?: string;
  data?: Record<string, unknown>;
}

export interface AuditEventList {
  events: AuditEvent[];
  limit: number;
}

/** RFC 7807 problem envelope returned by the backend on errors. */
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

/**
 * All calls are relative and same-origin. In production the Vercel rewrites
 * in next.config.ts proxy /v1/* (and /login, /auth/*, /logout, /oauth/*) to
 * the DO backend, so the browser sees one origin and the session cookie is
 * first-party.
 */
async function request<T>(
  path: string,
  init: RequestInit = {},
  parse: 'json' | 'none' = 'json',
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        // FormData must set its own Content-Type: the browser appends the
        // multipart boundary, and forcing application/json here would produce
        // a body the server cannot parse.
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(typeof window !== 'undefined' && localStorage.getItem('faas_active_org')
          ? { 'X-Active-Org': localStorage.getItem('faas_active_org')! }
          : {}),
        ...(init.headers as Record<string, string>),
      },
    });
  } catch (err) {
    throw new ApiError(null, 0, `Network error: could not reach the control plane (${(err as Error).message})`);
  }

  if (!res.ok) {
    let problem: Problem | null = null;
    try {
      problem = (await res.json()) as Problem;
    } catch {
      /* non-JSON error body (e.g. rate-limit plain text) */
    }
    throw new ApiError(problem, res.status, `Request failed (HTTP ${res.status})`);
  }

  if (parse === 'none' || res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ─────────────────────────────── Auth ──────────────────────────────────── */

/** Body of a successful POST /login or /signup. No API key is ever returned. */
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

/**
 * POST /signup — creates the account and signs in. Idempotent when the email
 * exists AND the password matches; a colliding email with a different password
 * returns 401, not 409, to avoid leaking which addresses are registered.
 */
export const signup = (email: string, password: string) =>
  authPost('/api/auth/signup', { email, password });

/** POST /login/forgot — always succeeds, so it can't be used to probe emails. */
export async function requestPasswordReset(email: string): Promise<void> {
  await authPost('/api/auth/forgot', { email }).catch((err) => {
    // A 4xx here would itself leak whether the address exists; only surface
    // transport failures.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) return;
    throw err;
  });
}

export async function logout(): Promise<void> {
  await fetch('/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
}

/** OAuth consent redirects. Both 302 to the provider; the callback mints the session. */
export const googleAuthUrl = '/v1/auth/google';
export const githubAuthUrl = '/v1/auth/github';

/* ────────────────────────────── Account ────────────────────────────────── */

export const getAccount = () => request<Account>('/v1/account', { cache: 'no-store' });

export const changePlan = (plan: Plan) =>
  request<Account>('/v1/account/plan', { method: 'PATCH', body: JSON.stringify({ plan }) });

export const exportAccount = () => request<unknown>('/v1/account/export');

export const deleteAccount = () => request<unknown>('/v1/account', { method: 'DELETE' });

export const restoreAccount = () => request<Account>('/v1/account/restore', { method: 'POST' });

/* ──────────────────────────────── Apps ─────────────────────────────────── */

export const listApps = () => request<App[]>('/v1/apps', { cache: 'no-store' });

export const getApp = (slug: string) => request<App>(`/v1/apps/${slug}`);

export interface CreateAppInput {
  slug: string;
  type?: AppType;
  runtime?: Runtime;
  ram_mb?: number;
  max_concurrency?: number;
  idle_timeout_s?: number;
}
export const createApp = (input: CreateAppInput) =>
  request<App>('/v1/apps', { method: 'POST', body: JSON.stringify(input) });

export interface UpdateAppInput {
  ram_mb?: number;
  idle_timeout_s?: number;
  max_concurrency?: number;
  min_instances?: number;
}
export const updateApp = (slug: string, input: UpdateAppInput) =>
  request<App>(`/v1/apps/${slug}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteApp = (slug: string) =>
  request<void>(`/v1/apps/${slug}`, { method: 'DELETE' }, 'none');

export const renameApp = (slug: string, newSlug: string) =>
  request<App>(`/v1/apps/${slug}/rename`, { method: 'POST', body: JSON.stringify({ new_slug: newSlug }) });

export const parkApp = (slug: string) =>
  request<void>(`/v1/apps/${slug}/park`, { method: 'POST' }, 'none');

export const wakeApp = (slug: string) =>
  request<Instance>(`/v1/apps/${slug}/wake`, { method: 'POST' });

export const rollbackApp = (slug: string) =>
  request<Deployment>(`/v1/apps/${slug}/rollback`, { method: 'POST' });

export const listInstances = (slug: string) =>
  request<Instance[]>(`/v1/apps/${slug}/instances`, { cache: 'no-store' });

/** Account-wide instance list — one call instead of one per app (#393). */
export const listAllInstances = (limit = 100, before?: string) => {
  const q = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
  if (before) q.set('before', before);
  return request<InstanceList>(`/v1/instances?${q}`, { cache: 'no-store' });
};

/* ────────────────────────────── Metrics ────────────────────────────────── */

export const getAppMetrics = (slug: string, range: MetricsRange = '24h') =>
  request<AppMetrics>(`/v1/apps/${slug}/metrics?range=${range}`, { cache: 'no-store' });

/** Account-wide per-app rollup, keyed by slug — one call for the whole page. */
export const getAppsMetrics = (range: MetricsRange = '24h') =>
  request<AppsMetrics>(`/v1/apps/metrics?range=${range}`, { cache: 'no-store' });

/* ─────────────────────────────── Env vars ──────────────────────────────── */

export const listEnv = (slug: string) => request<AppEnvList>(`/v1/apps/${slug}/env`, { cache: 'no-store' });

/** key must match ^[A-Z][A-Z0-9_]*$. Plaintext by contract — not for secrets. */
export const setEnv = (slug: string, key: string, value: string) =>
  request<void>(`/v1/apps/${slug}/env/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }, 'none');

export const deleteEnv = (slug: string, key: string) =>
  request<void>(`/v1/apps/${slug}/env/${key}`, { method: 'DELETE' }, 'none');

/* ────────────────────────── Queue introspection ────────────────────────── */

export const getQueueState = (slug: string) =>
  request<QueueState>(`/v1/apps/${slug}/queues/state`, { cache: 'no-store' });

/** Read-only: acquires no lease and does not increment `attempts`. */
export const peekQueue = (slug: string, limit = 25, before?: string) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set('before', before);
  return request<QueuePeek>(`/v1/apps/${slug}/queues/peek?${q}`, { cache: 'no-store' });
};

export const listDeadLetter = (slug: string, limit = 25, before?: string) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set('before', before);
  return request<QueueDeadLetter>(`/v1/apps/${slug}/queues/dead_letter?${q}`, { cache: 'no-store' });
};

/* ──────────────────────────── Alert rules ──────────────────────────────── */

export const listAlertRules = (slug: string) =>
  request<AlertRule[]>(`/v1/apps/${slug}/alerts`, { cache: 'no-store' });

export const createAlertRule = (slug: string, input: CreateAlertRuleInput) =>
  request<AlertRule>(`/v1/apps/${slug}/alerts`, { method: 'POST', body: JSON.stringify(input) });

export const updateAlertRule = (slug: string, id: string, input: Partial<CreateAlertRuleInput>) =>
  request<AlertRule>(`/v1/apps/${slug}/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteAlertRule = (slug: string, id: string) =>
  request<void>(`/v1/apps/${slug}/alerts/${id}`, { method: 'DELETE' }, 'none');

export const rotateAlertSecret = (slug: string, id: string, secret: string) =>
  request<AlertRule>(`/v1/apps/${slug}/alerts/${id}/rotate-secret`, {
    method: 'POST',
    body: JSON.stringify({ webhook_secret: secret }),
  });

/* ────────────────────────── Outbound Webhooks ─────────────────────────── */

export const listAppWebhooks = (slug: string) =>
  request<AppWebhook[]>(`/v1/apps/${slug}/webhooks`, { cache: 'no-store' });

export const createAppWebhook = (slug: string, input: CreateAppWebhookInput) =>
  request<AppWebhook>(`/v1/apps/${slug}/webhooks`, { method: 'POST', body: JSON.stringify(input) });

export const getAppWebhook = (slug: string, id: string) =>
  request<AppWebhook>(`/v1/apps/${slug}/webhooks/${id}`, { cache: 'no-store' });

export const updateAppWebhook = (slug: string, id: string, input: Partial<CreateAppWebhookInput>) =>
  request<AppWebhook>(`/v1/apps/${slug}/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteAppWebhook = (slug: string, id: string) =>
  request<void>(`/v1/apps/${slug}/webhooks/${id}`, { method: 'DELETE' }, 'none');

export const rotateAppWebhookSecret = (slug: string, id: string) =>
  request<{ webhook_secret_sealed_masked: string; rotated_at: string }>(`/v1/apps/${slug}/webhooks/${id}/rotate-secret`, {
    method: 'POST',
  });

export const listAppWebhookDeliveries = (slug: string, id: string, pageSize = 50, pageToken?: string) => {
  const q = new URLSearchParams({ page_size: String(pageSize) });
  if (pageToken) q.set('page_token', pageToken);
  return request<AppWebhookDeliveryListResponse>(`/v1/apps/${slug}/webhooks/${id}/deliveries?${q}`, { cache: 'no-store' });
};

export const retryAppWebhookDelivery = (slug: string, id: string, did: string) =>
  request<AppWebhookDelivery>(`/v1/apps/${slug}/webhooks/${id}/deliveries/${did}/retry`, { method: 'POST' });

/* ───────────────────────────── Sessions ────────────────────────────────── */

export const listSessions = () => request<SessionList>('/v1/auth/sessions', { cache: 'no-store' });

export const revokeSession = (id: string) =>
  request<void>(`/v1/auth/sessions/${id}`, { method: 'DELETE' }, 'none');

/** Revokes every session including the caller's — the UI must sign out after. */
export const revokeAllSessions = () =>
  request<void>('/v1/auth/sessions/revoke_all', { method: 'POST' }, 'none');

/* ───────────────────────────── Invoices ────────────────────────────────── */

export const listInvoices = (limit = 25, before?: string, month?: string) => {
  const q = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
  if (before) q.set('before', before);
  if (month) q.set('month', month);
  return request<InvoiceList>(`/v1/invoices?${q}`, { cache: 'no-store' });
};

/* ────────────────────────────── Deployments ────────────────────────────── */

export const listDeployments = () => request<DeploymentList>('/v1/deployments', { cache: 'no-store' });

export const getDeployment = (id: string) => request<Deployment>(`/v1/deployments/${id}`);

export const listAppDeployments = (slug: string) =>
  request<DeploymentList>(`/v1/apps/${slug}/deployments`, { cache: 'no-store' });

/**
 * Deploy a prebuilt, digest-pinned OCI image. Returns 202 — the build is
 * queued, not finished; poll the deployment or watch its build log.
 */
export const deployImage = (slug: string, image: string) =>
  request<Deployment>(`/v1/apps/${slug}/deployments`, {
    method: 'POST',
    body: JSON.stringify({ image }),
  });

/**
 * Deploy from a source tarball. Sent as multipart, so `Content-Type` is left
 * to the browser — setting it manually would omit the multipart boundary and
 * the backend would reject the body.
 */
export async function deploySource(
  slug: string,
  file: File,
  opts: { dockerfile?: boolean; kind?: AppType; runtime?: Runtime } = {},
): Promise<Deployment> {
  const form = new FormData();
  form.append('source', file);
  if (opts.dockerfile) form.append('dockerfile', 'true');
  if (opts.kind) form.append('kind', opts.kind);
  if (opts.runtime) form.append('runtime', opts.runtime);

  return request<Deployment>(`/v1/apps/${slug}/deployments`, { method: 'POST', body: form });
}

/** CycloneDX SBOM for a build. Served as vnd.cyclonedx+json. */
export const getBuildSbom = (id: string) =>
  request<Record<string, unknown>>(`/v1/builds/${id}/sbom`, {
    headers: { Accept: 'application/vnd.cyclonedx+json' },
    cache: 'no-store',
  });

export const getBuildProvenance = (id: string) =>
  request<BuildProvenance>(`/v1/builds/${id}/provenance`, { cache: 'no-store' });

/* ───────────────────────────── Invocations ─────────────────────────────── */

/**
 * Newest-first page of invocations. This is the only per-request telemetry the
 * control plane exposes, so it backs the Overview charts, the queue/cron run
 * histories and the Metrics page. `limit` is capped server-side at 200.
 */
export const listInvocations = (limit = 100, before?: string) => {
  const q = new URLSearchParams({ limit: String(Math.min(limit, 200)) });
  if (before) q.set('before', before);
  return request<InvocationList>(`/v1/invocations?${q}`, { cache: 'no-store' });
};

export const getInvocation = (id: string) => request<Invocation>(`/v1/invocations/${id}`);

/* ────────────────────────── Queues & delayed tasks ─────────────────────── */

export interface InvokeInput {
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  method?: string;
  path?: string;
}

export interface InvokeResult {
  id: string;
  status: InvocationState;
  result?: Record<string, unknown>;
}

/**
 * Sync invoke: the server long-polls until the drain reaches a terminal
 * state, capped at 30s on paid plans and 5s on Free. A 504 is NOT a failure —
 * the work continues, and the row can be read back from /v1/invocations/{id}.
 */
export const invokeApp = (slug: string, input: InvokeInput) =>
  request<InvokeResult>(`/v1/apps/${slug}/invoke`, { method: 'POST', body: JSON.stringify(input) });

/** Async invoke: returns immediately with the row id. */
export const invokeAppAsync = (slug: string, input: InvokeInput) =>
  request<InvokeResult>(`/v1/apps/${slug}/invoke/async`, { method: 'POST', body: JSON.stringify(input) });

export const queueSend = (slug: string, payload: Record<string, unknown>) =>
  request<Invocation>(`/v1/apps/${slug}/queues/send`, { method: 'POST', body: JSON.stringify({ payload }) });

export const createDelayedTask = (slug: string, scheduledAt: string, payload: Record<string, unknown>) =>
  request<Invocation>(`/v1/apps/${slug}/delayed-tasks`, {
    method: 'POST',
    body: JSON.stringify({ scheduled_at: scheduledAt, payload }),
  });

export const cancelDelayedTask = (id: string) =>
  request<void>(`/v1/delayed-tasks/${id}`, { method: 'DELETE' }, 'none');

/* ─────────────────────────── Audit / activity ──────────────────────────── */

export const listAuditEvents = (limit = 50, kindPrefix?: string) => {
  const q = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
  if (kindPrefix) q.set('kind_prefix', kindPrefix);
  return request<AuditEventList>(`/v1/audit-events?${q}`, { cache: 'no-store' });
};

/* ──────────────────────────────── Logs ─────────────────────────────────── */

/**
 * SSE endpoints. These stream `text/event-stream`, so callers attach an
 * EventSource rather than going through `request()`. Same-origin, so the
 * session cookie rides along without extra config.
 */
export const appLogsUrl = (slug: string, follow = true) =>
  `/v1/apps/${slug}/logs?follow=${follow ? 1 : 0}`;

export const deploymentLogsUrl = (id: string, follow = true) =>
  `/v1/deployments/${id}/logs?follow=${follow ? 1 : 0}`;

/* ─────────────────────────── Per-app secrets ───────────────────────────── */

export const listSecrets = (slug: string) => request<AppSecretList>(`/v1/apps/${slug}/secrets`);

/** Account-wide sealed-secret list — one call instead of one per app (#393). */
export const listAllSecrets = (limit = 100, before?: string) => {
  const q = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
  if (before) q.set('before', before);
  return request<AccountSecretList>(`/v1/secrets?${q}`, { cache: 'no-store' });
};

/** key must match ^[A-Z][A-Z0-9_]*$. Body carries the plaintext value. */
export const setSecret = (slug: string, key: string, value: string) =>
  request<void>(`/v1/apps/${slug}/secrets/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }, 'none');

export const deleteSecret = (slug: string, key: string) =>
  request<void>(`/v1/apps/${slug}/secrets/${key}`, { method: 'DELETE' }, 'none');

/* ───────────────────────────────── Domains ─────────────────────────────── */

export const listDomains = () => request<CustomDomain[]>('/v1/domains', { cache: 'no-store' });

export const createDomain = (domain: string, appId: string) =>
  request<CustomDomain>('/v1/domains', { method: 'POST', body: JSON.stringify({ domain, app_id: appId }) });

export const deleteDomain = (domain: string) =>
  request<void>(`/v1/domains/${domain}`, { method: 'DELETE' }, 'none');

/* ────────────────────────────────── Crons ──────────────────────────────── */

export const listCrons = () => request<Cron[]>('/v1/crons', { cache: 'no-store' });

export interface CreateCronInput {
  app_id: string;
  schedule: string;
  path?: string;
  enabled?: boolean;
}
export const createCron = (input: CreateCronInput) =>
  request<Cron>('/v1/crons', { method: 'POST', body: JSON.stringify(input) });

export const updateCron = (id: string, input: Partial<Pick<Cron, 'schedule' | 'path' | 'enabled'>>) =>
  request<Cron>(`/v1/crons/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteCron = (id: string) =>
  request<void>(`/v1/crons/${id}`, { method: 'DELETE' }, 'none');

/* ────────────────────────────────── Keys ───────────────────────────────── */

export const listKeys = () => request<ApiKey[]>('/v1/keys', { cache: 'no-store' });

export const createKey = (label: string) =>
  request<ApiKey>('/v1/keys', { method: 'POST', body: JSON.stringify({ label }) });

export const deleteKey = (id: string) =>
  request<void>(`/v1/keys/${id}`, { method: 'DELETE' }, 'none');

/* ────────────────────────────────── Usage ──────────────────────────────── */

export const getUsageSummary = (month?: string) =>
  request<UsageSummary>(`/v1/usage/summary${month ? `?month=${month}` : ''}`, { cache: 'no-store' });

/** Per-app rows for a billing month (YYYY-MM); defaults to the current month. */
export const getUsageByApp = (month?: string) =>
  request<AppUsage[]>(`/v1/usage${month ? `?month=${month}` : ''}`, { cache: 'no-store' });

/* ───────────────────────────── CLI Device Auth ──────────────────────────── */

export interface CliAuthClaimInput {
  code: string;
  email: string;
}

/** Claim a CLI authorization device code. */
export const claimCliAuthCode = async (code: string, email: string) => {
  const form = new URLSearchParams();
  form.set('code', code);
  form.set('email', email);
  return request<void>('/api/cli-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }, 'none');
};

/* ───────────────────────────── Organizations ──────────────────────────── */

export type OrgRole = 'owner' | 'admin' | 'developer' | 'viewer' | 'billing';

export interface Org {
  id: string;
  slug: string;
  name: string;
  personal: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrgWithRole extends Org {
  role: OrgRole;
}

export interface OrgMeResponse {
  org: OrgWithRole | null;
}

export interface OrgMember {
  user_id: string;
  email: string;
  role: OrgRole;
  joined_at: string;
}

export interface OrgInvitation {
  token: string;
  email: string;
  role: OrgRole;
  invited_by: string;
  expires_at: string;
  created_at: string;
}

export interface OrgSeatUsage {
  total_members: number;
  pending_invitations: number;
}

export interface CreateOrgInput {
  slug: string;
  name: string;
}

export interface UpdateOrgInput {
  name?: string;
  owner_id?: string;
}

export interface ListOrgsResponse { orgs: OrgWithRole[]; }
export const listOrgs = () => request<ListOrgsResponse>('/v1/orgs', { cache: 'no-store' });

export const createOrg = (input: CreateOrgInput) =>
  request<Org>('/v1/orgs', { method: 'POST', body: JSON.stringify(input) });

export const getOrgMe = () => request<OrgMeResponse>('/v1/orgs/me', { cache: 'no-store' });

export const getOrg = (slug: string) => request<Org>(`/v1/orgs/${slug}`, { cache: 'no-store' });

export const updateOrg = (slug: string, input: UpdateOrgInput) =>
  request<Org>(`/v1/orgs/${slug}`, { method: 'PATCH', body: JSON.stringify(input) });

export interface ListOrgMembersResponse { members: OrgMember[]; }
export const listOrgMembers = (slug: string) =>
  request<ListOrgMembersResponse>(`/v1/orgs/${slug}/members`, { cache: 'no-store' });

export const addOrgMember = (slug: string, email: string, role: OrgRole) =>
  request<OrgInvitation>(`/v1/orgs/${slug}/members`, { method: 'POST', body: JSON.stringify({ email, role }) });

export const updateOrgMemberRole = (slug: string, userId: string, role: OrgRole) =>
  request<void>(`/v1/orgs/${slug}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }, 'none');

export const removeOrgMember = (slug: string, userId: string) =>
  request<void>(`/v1/orgs/${slug}/members/${userId}`, { method: 'DELETE' }, 'none');

export interface ListOrgInvitationsResponse { invitations: OrgInvitation[]; }
export const listOrgInvitations = (slug: string) =>
  request<ListOrgInvitationsResponse>(`/v1/orgs/${slug}/invitations`, { cache: 'no-store' });

export const revokeOrgInvitation = (slug: string, token: string) =>
  request<void>(`/v1/orgs/${slug}/invitations/${token}`, { method: 'DELETE' }, 'none');

export const getInvitation = (token: string) =>
  request<OrgInvitation>(`/v1/invitations/${token}`, { cache: 'no-store' });

export const acceptInvitation = (token: string) =>
  request<OrgMember>(`/v1/invitations/${token}/accept`, { method: 'POST' });

export const transferOrgOwnership = (slug: string, newOwnerId: string) =>
  request<void>(`/v1/orgs/${slug}/transfer_ownership`, { method: 'POST', body: JSON.stringify({ new_owner_id: newOwnerId }) }, 'none');

export const getOrgSeatUsage = (slug: string) =>
  request<OrgSeatUsage>(`/v1/orgs/${slug}/seat_usage`, { cache: 'no-store' });

/* ────────────────────────── Operator & Admin (/v1/admin/*) ─────────────────────── */

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

export interface ObsOverviewRateLimited {
  account_id: string;
  hits: number;
}

export interface ObsOverviewNodeHealth {
  name: string;
  active: boolean;
  last_heartbeat_at?: string;
  stale: boolean;
}

export interface ObsOverviewFailureKind {
  kind: string;
  count: number;
}

export interface ObsOverviewResponse {
  generated_at: string;
  totals: ObsOverviewTotals;
  top_rate_limited_accounts_24h: ObsOverviewRateLimited[];
  node_health: ObsOverviewNodeHealth[];
  recent_failures_1h: ObsOverviewFailureKind[];
}

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

export interface ObsTenantListResponse {
  items: ObsTenantRow[];
  next_cursor: string;
  limit: number;
}

export interface ObsTenantApp {
  id: string;
  slug: string;
  status: string;
  deployments: number;
}

export interface ObsTenantOrg {
  id: string;
  slug: string;
  role: string;
}

export interface ObsTenantCounts {
  active: number;
  revoked: number;
}

export interface ObsTenantDetailResponse {
  account: ObsTenantRow;
  apps: ObsTenantApp[];
  orgs: ObsTenantOrg[];
  api_keys: ObsTenantCounts;
  sessions: ObsTenantCounts;
}

export interface ObsTenant360Response extends ObsTenantDetailResponse {
  usage: ObsTenantUsage;
  billing: ObsTenantBilling;
}

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

export interface ObsTenantBilling {
  current_month_overage_cents: number;
  overage_cap_cents?: number;
  active_credits_cents: number;
  invoices: ObsInvoiceSummary[];
}

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

export interface ObsCapacityResponse {
  generated_at: string;
  summary: ObsCapacitySummary;
  nodes: ObsCapacityNode[];
}

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

export interface ObsAuditActivityRow {
  id: string;
  at: string;
  kind: string;
  actor?: string;
}

export interface ObsTenantActivityResponse {
  account_id: string;
  generated_at: string;
  invocations: ObsInvocationRow[];
  audit_events: ObsAuditActivityRow[];
  limit: number;
}

export interface ObsAccountMutationResponse {
  account: ObsTenantRow;
  action: string;
  revoked_sessions: number;
}

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

export interface ObsAppDetailResponse {
  app: ObsAppDetail;
  deployments: ObsDeploymentRow[];
  instances: ObsInstanceRow[];
  invocations: ObsInvocationRow[];
  health: ObsAppHealth;
}

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

export interface ObsAppHealth {
  generated_at: string;
  metrics: AppMetrics;
  errors: ObsAppErrorSummary[];
  errors_window_start: string;
  errors_window_end: string;
}

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

export interface ObsNodeListResponse {
  items: ObsNodeRow[];
  next_cursor: string;
  limit: number;
}

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

export interface ObsNodeDetailResponse {
  node: ObsNodeRow;
  apps: ObsNodeApp[];
  instances: ObsInstanceRow[];
  drain: ObsNodeDrainStatus;
}

export interface ObsNodeDrainStatus {
  total_instances: number;
  live_instances: number;
  running_instances: number;
  waking_instances: number;
  cold_booting_instances: number;
  drain_safe: boolean;
  observed_at: string;
}

export interface ObsNodeMutationResponse {
  ok: boolean;
  node: string;
  previous_active: boolean;
  active: boolean;
  live_instances: number;
  forced: boolean;
  reason: string;
}

export interface ObsHeartbeatRow {
  received_at: string;
  last_heartbeat_at: string;
  source: string;
  gap_to_previous_ms: number;
  missed: boolean;
  stale: boolean;
}

export interface ObsHeartbeatListResponse {
  node_id: string;
  name: string;
  since: string;
  since_clamped: boolean;
  heartbeats: ObsHeartbeatRow[];
  limit: number;
}

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

export interface ObsAnomalyListResponse {
  generated_at: string;
  window_hours: number;
  baseline_window_days: number;
  items: ObsAnomalyRow[];
}

export interface ObsRateLimitDurableRow {
  account_id: string;
  hits: number;
  last_event_at: string;
}

export interface ObsRateLimitLiveRow {
  ip: string;
  currently_rate_limited: boolean;
  live_hits_30s: number;
  last_event_at: string;
}

export interface ObsRateLimitResponse {
  generated_at: string;
  window_hours: number;
  sources: string[];
  lag_seconds: number;
  durable: ObsRateLimitDurableRow[];
  live: ObsRateLimitLiveRow[];
}

export interface BillingCatalogEntry {
  id: string;
  kind: string;
  plan?: string;
  price_cents: number;
  currency: string;
  interval?: string;
  created_at: string;
}

export interface BillingCatalogResponse {
  items: BillingCatalogEntry[];
}

export interface GlobalAuditLogEntry {
  id: string;
  at: string;
  account_id?: string | null;
  actor: string;
  kind: string;
  subject?: string | null;
  data?: Record<string, unknown>;
}

export interface GlobalAuditLogResponse {
  items: GlobalAuditLogEntry[];
  next_before?: string | null;
}

export const getObsOverview = () =>
  request<ObsOverviewResponse>('/v1/admin/obs/overview', { cache: 'no-store' });

export const listObsTenants = (limit = 200, cursor?: string, includePii = false) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set('cursor', cursor);
  if (includePii) q.set('include_pii', '1');
  return request<ObsTenantListResponse>(`/v1/admin/obs/tenants?${q}`, { cache: 'no-store' });
};

export const getObsTenantDetail = (id: string, includePii = false) => {
  const q = includePii ? '?include_pii=1' : '';
  return request<ObsTenantDetailResponse>(`/v1/admin/obs/tenants/${id}${q}`, { cache: 'no-store' });
};

export const getObsTenantActivity = (id: string, limit = 50) =>
  request<ObsTenantActivityResponse>(
    `/v1/admin/obs/tenants/${id}/activity?limit=${limit}`,
    { cache: 'no-store' },
  );

export const getObsTenant360 = (id: string, month?: string, includePii = false) => {
  const q = new URLSearchParams();
  if (month) q.set('month', month);
  if (includePii) q.set('include_pii', '1');
  const query = q.toString();
  return request<ObsTenant360Response>(
    `/v1/admin/obs/tenants/${id}/360${query ? `?${query}` : ''}`,
    { cache: 'no-store' },
  );
};

export const getObsCapacity = () =>
  request<ObsCapacityResponse>('/v1/admin/obs/capacity', { cache: 'no-store' });

const mutateObsAccount = (id: string, action: 'suspend' | 'restore' | 'revoke-sessions', reason: string) =>
  request<ObsAccountMutationResponse>(
    `/v1/admin/ops/accounts/${encodeURIComponent(id)}/${action}?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST' },
  );

export const suspendObsAccount = (id: string, reason = 'operator_console_suspend') =>
  mutateObsAccount(id, 'suspend', reason);

export const restoreObsAccount = (id: string, reason = 'operator_console_restore') =>
  mutateObsAccount(id, 'restore', reason);

export const revokeObsAccountSessions = (id: string, reason = 'operator_console_revoke_sessions') =>
  mutateObsAccount(id, 'revoke-sessions', reason);

export const getObsAppDetail = (id: string) =>
  request<ObsAppDetailResponse>(`/v1/admin/obs/apps/${id}`, { cache: 'no-store' });

export const issueAccountCredit = (accountId: string, amountCents: number, reason: string) =>
  request<{ id: string; amount_cents: number; reason: string }>(
    `/v1/admin/accounts/${accountId}/credits`,
    { method: 'POST', body: JSON.stringify({ amount_cents: amountCents, reason }) },
  );

export const reconcileAccount = (accountId: string) =>
  request<{ account_id: string; reconciled_at: string; status: string }>(
    `/v1/admin/billing-reconcile/${accountId}`,
    { method: 'POST' },
  );

export const listObsNodes = () =>
  request<ObsNodeListResponse>('/v1/admin/obs/nodes', { cache: 'no-store' });

export const getObsNodeHeartbeats = (name: string, sinceMinutes = 30) =>
  request<ObsHeartbeatListResponse>(
    `/v1/admin/obs/nodes/${encodeURIComponent(name)}/heartbeats?since=${sinceMinutes}m`,
    { cache: 'no-store' },
  );

export const getObsNodeDetail = (name: string) =>
  request<ObsNodeDetailResponse>(
    `/v1/admin/obs/nodes/${encodeURIComponent(name)}/detail`,
    { cache: 'no-store' },
  );

const mutateObsNode = (name: string, action: 'drain' | 'force-drain' | 'activate', reason: string) =>
  request<ObsNodeMutationResponse>(
    `/v1/admin/ops/nodes/${encodeURIComponent(name)}/${action}?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST' },
  );

export const drainObsNode = (name: string, reason = 'operator_console_drain') =>
  mutateObsNode(name, 'drain', reason);

export const forceDrainObsNode = (name: string, reason = 'operator_console_force_drain') =>
  mutateObsNode(name, 'force-drain', reason);

export const activateObsNode = (name: string, reason = 'operator_console_activate') =>
  mutateObsNode(name, 'activate', reason);

export const getObsAnomalies = (windowHours = 24) =>
  request<ObsAnomalyListResponse>(`/v1/admin/obs/anomalies?window_hours=${windowHours}`, { cache: 'no-store' });

export const getObsRateLimits = (windowHours = 24) =>
  request<ObsRateLimitResponse>(`/v1/admin/obs/rate-limits?window_hours=${windowHours}`, { cache: 'no-store' });

export const listPaddleCatalog = () =>
  request<BillingCatalogResponse>('/v1/admin/billing-paddle-catalog', { cache: 'no-store' });

export const syncPaddleCatalog = () =>
  request<BillingCatalogResponse>('/v1/admin/billing-paddle-catalog/sync', { method: 'POST' });

export const resetPaddleCatalog = () =>
  request<void>('/v1/admin/billing-paddle-catalog', { method: 'DELETE' }, 'none');

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

export interface ObsEventRow {
  id: string;
  at: string;
  kind: string;
  actor: string;
  subject: string | null;
  data: Record<string, unknown> | null;
}

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

export const setGithubWebhookSecret = (secret: string) =>
  request<{ ok: boolean }>('/v1/admin/github-webhook-secrets', {
    method: 'POST',
    body: JSON.stringify({ secret }),
  });

export const listGlobalAuditLog = (limit = 100, before?: string, includeAnonymous = true) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set('before', before);
  if (includeAnonymous) q.set('include_anonymous', 'true');
  return request<GlobalAuditLogResponse>(`/v1/audit-log/all?${q}`, { cache: 'no-store' });
};

export interface OperatorIntentResponse {
  intent_id: string;
  kind: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  target_id: string;
  account_id?: string;
  requested_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  snap_ids_marked_stale?: string[];
}

export interface OperatorIntentAcceptedResponse {
  ok: boolean;
  intent_id: string;
  status_url: string;
  expires_at: string;
}

export type RuntimeConfigApplyMode = 'hot' | 'graceful' | 'rolling' | 'break_glass';
export type RuntimeConfigStatus = 'pending' | 'applied' | 'failed' | 'blocked';

export interface OperatorRuntimeConfig {
  key: string;
  label: string;
  description: string;
  category: string;
  kind: 'boolean' | 'integer' | 'duration' | 'string' | 'enum' | 'secret_reference';
  default_value: unknown;
  desired_value: unknown;
  effective_value: unknown;
  source: 'default_or_environment' | 'operator';
  apply_mode: RuntimeConfigApplyMode;
  mutable: boolean;
  sensitive: boolean;
  status: RuntimeConfigStatus;
  last_error?: string;
  version: number;
  updated_at?: string;
  applied_at?: string;
}

export interface OperatorRuntimeConfigListResponse {
  items: OperatorRuntimeConfig[];
  generated_at: string;
}

export interface OperatorRuntimeConfigOperation {
  id: string;
  key: string;
  scope: string;
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

export interface OperatorRuntimeConfigRevision {
  id: number;
  key: string;
  scope: string;
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

export const updateOperatorRuntimeConfig = (
  key: string,
  value: unknown,
  reason: string,
  expectedVersion?: number,
) =>
  request<OperatorRuntimeConfig | OperatorRuntimeConfigOperation>(
    `/v1/admin/config/${encodeURIComponent(key)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        value,
        reason,
        ...(expectedVersion != null ? { expected_version: expectedVersion } : {}),
      }),
    },
  );

export const getOperatorRuntimeConfigOperation = (operationId: string) =>
  request<OperatorRuntimeConfigOperation>(
    `/v1/admin/config-operations/${encodeURIComponent(operationId)}`,
    { cache: 'no-store' },
  );

export const getOperatorRuntimeConfigRevisions = (key: string, limit = 20) =>
  request<{ items: OperatorRuntimeConfigRevision[] }>(
    `/v1/admin/config/${encodeURIComponent(key)}/revisions?limit=${limit}`,
    { cache: 'no-store' },
  );

export interface SweepStuckBuildsResponse {
  ok: boolean;
  swept_count: number;
  older_than_seconds: number;
  threshold_iso: string;
}

export interface ObsBuilderHeartbeatRow {
  node_id: string;
  received_at: string;
  cpu_pct_60s: number | null;
  disk_used_bytes: number | null;
}

export interface ObsBuilderHeartbeatListResponse {
  generated_at: string;
  items: ObsBuilderHeartbeatRow[];
  queued_builds: number;
}

export interface RekeyProgressResponse {
  total: number;
  completed: number;
  failed: number;
  in_progress: number;
  enabled: boolean;
}

export interface ObsWakeLatencyRow {
  node: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  sample_count: number;
  window_hours: number;
}

export interface ObsWakeLatencyResponse {
  items: ObsWakeLatencyRow[];
}

export interface AuditLogSearchParams {
  since?: string;
  kind_prefix?: string;
  include_anon?: boolean;
  limit?: number;
  actor_email?: string;
  operator_only?: boolean;
  target_account_id?: string;
}

export interface ObsAuditLogSearchResponse {
  items: GlobalAuditLogEntry[];
  total?: number;
  has_more?: boolean;
}

export const forceParkInstance = (instanceId: string, reason = 'operator_force_park') =>
  request<OperatorIntentAcceptedResponse>(
    `/v1/admin/instances/${encodeURIComponent(instanceId)}/force-park?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST' },
  );

export const forceColdBootApp = (slug: string, reason = 'operator_force_cold_boot') =>
  request<OperatorIntentAcceptedResponse>(
    `/v1/admin/apps/${encodeURIComponent(slug)}/force-cold-boot?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST' },
  );

export const getOperatorIntent = (intentId: string) =>
  request<OperatorIntentResponse>(`/v1/admin/operator-intents/${encodeURIComponent(intentId)}`, {
    cache: 'no-store',
  });

export const sweepStuckBuilds = (olderThan = '15m', reason = 'operator_reclaim_build') =>
  request<SweepStuckBuildsResponse>(
    `/v1/admin/builds/sweep-stuck?confirm=true&older_than=${encodeURIComponent(olderThan)}&reason=${encodeURIComponent(reason)}`,
    { method: 'POST' },
  );

export const getObsBuilderHeartbeats = () =>
  request<ObsBuilderHeartbeatListResponse>('/v1/admin/obs/builder-heartbeats', {
    cache: 'no-store',
  });

export const getRekeyProgress = () =>
  request<RekeyProgressResponse>('/v1/admin/secrets/rekey-progress', {
    cache: 'no-store',
  });

export const getObsWakeLatencies = (windowHours = 24) =>
  request<ObsWakeLatencyResponse>(`/v1/admin/obs/nodes/wake-latency?window_hours=${windowHours}`, {
    cache: 'no-store',
  });

export const searchObsAuditLog = (params: AuditLogSearchParams = {}) => {
  const q = new URLSearchParams();
  if (params.since) q.set('since', params.since);
  if (params.kind_prefix) q.set('kind_prefix', params.kind_prefix);
  if (params.include_anon !== undefined) q.set('include_anon', String(params.include_anon));
  if (params.limit) q.set('limit', String(params.limit));
  if (params.actor_email) q.set('actor_email', params.actor_email);
  if (params.operator_only) q.set('operator_only', 'true');
  if (params.target_account_id) q.set('target_account_id', params.target_account_id);
  return request<ObsAuditLogSearchResponse>(`/v1/admin/obs/audit-log/search?${q}`, {
    cache: 'no-store',
  });
};
