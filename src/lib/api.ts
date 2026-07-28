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
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
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

export interface LoginResult {
  status: string;
  account: unknown;
}

/**
 * POST /login — the backend upserts the account, sets the HttpOnly faas_sid
 * cookie, emails a magic link, and returns JSON. We deliberately ignore the
 * api_key it echoes back and rely on the cookie for session auth.
 */
export async function login(email: string): Promise<LoginResult> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ email }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(null, res.status, text || `Sign-in failed (HTTP ${res.status})`);
  }
  return (await res.json().catch(() => ({ status: 'ok', account: null }))) as LoginResult;
}

export async function logout(): Promise<void> {
  await fetch('/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
}

export const googleAuthUrl = '/v1/auth/google';
/** GitHub App install / OAuth callback entry point (see next.config rewrites). */
export const githubAuthUrl = '/oauth/callback';

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

/* ────────────────────────────── Deployments ────────────────────────────── */

export const listDeployments = () => request<DeploymentList>('/v1/deployments', { cache: 'no-store' });

export const getDeployment = (id: string) => request<Deployment>(`/v1/deployments/${id}`);

export const listAppDeployments = (slug: string) =>
  request<DeploymentList>(`/v1/apps/${slug}/deployments`, { cache: 'no-store' });

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
