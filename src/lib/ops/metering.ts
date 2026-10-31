/* ==========================================================================
   Metering clients: the egress flow log, managed PostgreSQL usage and
   accounting repair, and operator object-storage usage reports.

   Contract: faas origin/main —
     pkg/apid/apidserver/handlers_admin_egress_flows.go, pkg/api/dto.go
     pkg/apid/apidserver/handlers_managed_postgres*.go, pkg/api/managed_postgres*.go
     pkg/managedpostgres/{usage_import,accounting_reconciliation}.go
     pkg/apid/object/storage_accounting.go, pkg/api/object_storage_usage.go

   Read-only vs money-affecting:
     - GET egress-flows, GET managed-postgres/usage, GET managed-postgres/accounting: reads.
     - POST …/usage-imports/preview and …/reconciliations/preview: read-only
       plans (MFA + operator, no step-up). They return a `revision` hash of the
       request, actor and current ledger state.
     - POST …/usage-imports and …/reconciliations: apply. Step-up + Idempotency-Key.
       `expected_revision` must equal the preview's `revision` (409 otherwise),
       and the request (including `reason`) must be byte-identical to it.
       Usage imports rewrite billed usage rows (cost delta); reconciliations
       mark a deleted database's provider shutdown.
     - POST object-storage/usage-reports: apply only, no preview endpoint.
       Appends a cumulative month report that must never go backwards. 204.
   ========================================================================== */

import { request, writeHeaders, type OperatorWrite } from '@/lib/api';

/* ─────────────────────────────── Shared ────────────────────────────────── */

/** RFC 3339 with at most microsecond precision (Go rejects sub-microsecond values here). */
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/i;

/**
 * Microseconds since the epoch for an RFC 3339 string, or null when it is not
 * one or carries sub-microsecond precision. Used for ordering and window
 * arithmetic; the operator's string is sent verbatim.
 */
export function parseRfc3339Micros(value: string): number | null {
  const m = RFC3339.exec(value.trim());
  if (!m) return null;
  const fraction = m[7] ?? '';
  if (fraction.length > 6 && /[1-9]/.test(fraction.slice(6))) return null;
  const whole = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[8].toUpperCase()}`);
  if (!Number.isFinite(whole)) return null;
  const micros = Number((fraction + '000000').slice(0, 6));
  return whole * 1000 + micros;
}

/** "2026-10-30T12:00:00Z" from a Date (seconds precision). */
export const toRfc3339Seconds = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** datetime-local value ("2026-10-30T12:00") → RFC 3339 UTC, or null when empty/invalid. */
export function localInputToRfc3339(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : toRfc3339Seconds(date);
}

/** Date → datetime-local value in the browser's zone. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID_PATTERN.test(value.trim());

/** managedpostgres.validSHA256: 64 lowercase hex characters. */
export const isLowerSha256 = (value: string) => /^[0-9a-f]{64}$/.test(value);

/**
 * managedpostgres.validImportText: non-empty, at most `limit` bytes, no
 * surrounding whitespace, no control characters.
 */
export function isImportText(value: string, limit: number): boolean {
  return (
    value.length > 0 &&
    new TextEncoder().encode(value).length <= limit &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

/** A client-generated request id (import_id / reconciliation_id); the server dedups on it. */
export function newRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** A non-negative integer the browser can represent exactly. */
export function parseCount(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Millicents (1/1000 of a cent) in major units. These endpoints carry no
 * currency code, so the amount is shown bare unless the caller supplies one.
 */
export function formatMillicents(millicents: number, currency?: string | null): string {
  const major = millicents / 100_000;
  const options: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 5 };
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat('en-IE', { ...options, style: 'currency', currency: currency.toUpperCase() }).format(major);
    } catch {
      /* unknown ISO code: fall through to the bare amount */
    }
  }
  return new Intl.NumberFormat('en-IE', options).format(major);
}

/** Byte-seconds → "12.40 GB-h" (GiB × hours). */
export function formatByteSeconds(byteSeconds: number): string {
  if (!Number.isFinite(byteSeconds)) return '—';
  const gbHours = byteSeconds / 1024 ** 3 / 3600;
  return `${gbHours >= 100 ? gbHours.toFixed(0) : gbHours.toFixed(2)} GB-h`;
}

/** Compute-unit seconds → "3.50 CU-h". */
export function formatUnitSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  return `${(seconds / 3600).toFixed(2)} CU-h`;
}

/* ───────────────────────────── Egress flows ────────────────────────────── */

/** api.EgressFlowLogRetentionDays / EgressFlowLogPageMax. */
export const EGRESS_FLOW_RETENTION_DAYS = 30;
export const EGRESS_FLOW_PAGE_MAX = 1000;
export const EGRESS_FLOW_DEFAULT_LIMIT = 200;

/**
 * api.EgressFlowLogEntry: one new flow a tenant guest opened.
 * @go api.EgressFlowLogEntry
 */
export interface EgressFlowLogEntry {
  observed_at: string;
  node: string;
  account_id: string;
  app_id: string;
  instance_id: string;
  remote_ip: string;
  remote_port: number;
}

/**
 * api.EgressFlowLogResponse. `truncated` means the page limit was reached.
 * @go api.EgressFlowLogResponse
 */
export interface EgressFlowLogResponse {
  flows: EgressFlowLogEntry[];
  truncated: boolean;
}

export interface EgressFlowQuery {
  /** IP address or CIDR. */
  remote?: string;
  account_id?: string;
  /** RFC 3339; the server defaults to the last 24 hours. */
  from?: string;
  to?: string;
  limit?: number;
}

/** Client-side mirror of parseEgressFlowFilter; null when the server would accept it. */
export function egressQueryError(q: EgressFlowQuery, now = Date.now()): string | null {
  if (q.remote && !isIpOrCidr(q.remote)) return 'Remote must be an IP address or CIDR.';
  if (q.account_id && !isUuid(q.account_id)) return 'Account must be an account UUID.';
  const to = q.to ? Date.parse(q.to) : now;
  const from = q.from ? Date.parse(q.from) : to - 24 * 3600_000;
  if (!Number.isFinite(to) || !Number.isFinite(from)) return 'From and to must be valid times.';
  if (from >= to) return 'From must be before to.';
  if (to - from > (EGRESS_FLOW_RETENTION_DAYS + 1) * 24 * 3600_000) {
    return `The window may not exceed the ${EGRESS_FLOW_RETENTION_DAYS}-day flow log retention.`;
  }
  if (q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > EGRESS_FLOW_PAGE_MAX)) {
    return `Limit must be between 1 and ${EGRESS_FLOW_PAGE_MAX}.`;
  }
  return null;
}

/** Loose IPv4/IPv6 (+ optional /prefix) check; the server is the authority. */
export function isIpOrCidr(value: string): boolean {
  const [addr, prefix, extra] = value.trim().split('/');
  if (extra !== undefined || !addr) return false;
  const v4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(addr);
  const v6 = !v4 && addr.includes(':') && /^[0-9a-f:.]+$/i.test(addr) && (addr.match(/::/g)?.length ?? 0) <= 1;
  if (!v4 && !v6) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (v4 ? 32 : 128);
}

export function egressFlowSearchParams(q: EgressFlowQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (q.remote?.trim()) params.set('remote', q.remote.trim());
  if (q.account_id?.trim()) params.set('account_id', q.account_id.trim());
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  if (q.limit) params.set('limit', String(q.limit));
  return params;
}

/** GET /v1/admin/egress-flows — newest first, `[from, to)`. */
export const listEgressFlows = (q: EgressFlowQuery = {}) => {
  const params = egressFlowSearchParams(q).toString();
  return request<EgressFlowLogResponse>(`/v1/admin/egress-flows${params ? `?${params}` : ''}`, { cache: 'no-store' });
};

/* ──────────────────────── Managed PostgreSQL: reads ────────────────────── */

/** managedpostgres.Meter* — the usage meters a backend may report. */
export const MANAGED_POSTGRES_METERS = [
  'active_seconds',
  'compute_unit_seconds',
  'storage_byte_seconds',
  'history_byte_seconds',
  'egress_bytes',
  'operations',
] as const;

/**
 * api.ManagedPostgresUsageLineItem: internal cost per meter.
 * @go api.ManagedPostgresUsageLineItem
 */
export interface ManagedPostgresUsageLineItem {
  code: string;
  meter: string;
  unit: string;
  quantity: number;
  cost_millicents: number;
}

/** guardrail_state as derived by managedPostgresUsageView. */
export type ManagedPostgresGuardrailState = 'disabled' | 'stale' | 'reached' | 'healthy';

/**
 * api.ManagedPostgresUsageOperatorResponse — GET /v1/admin/managed-postgres/usage/{account_id}.
 * @go api.ManagedPostgresUsageOperatorResponse
 */
export interface ManagedPostgresUsageOperatorResponse {
  account_id: string;
  period_start: string;
  observed_at?: string;
  policy_enabled: boolean;
  fresh: boolean;
  guardrail_state: ManagedPostgresGuardrailState | string;
  ready_databases: number;
  database_limit: number;
  storage_limit_bytes: number;
  compute_unit_seconds: number;
  storage_byte_seconds: number;
  storage_byte_seconds_limit: number;
  storage_byte_seconds_remaining: number;
  history_byte_seconds: number;
  egress_bytes: number;
  cost_millicents: number;
  max_monthly_cost_millicents: number;
  max_monthly_compute_unit_seconds: number;
  max_monthly_storage_byte_seconds: number;
  max_monthly_history_byte_seconds: number;
  max_monthly_egress_bytes: number;
  line_items: ManagedPostgresUsageLineItem[];
}

/** Reasons from managedpostgres.accountingDiagnostic. */
export const ACCOUNTING_REASON_LABELS: Record<string, string> = {
  identity_unknown: 'Provider identity unknown',
  legacy_identity_unknown: 'Deleted before identity was recorded — reconcile',
  coverage_missing: 'No usage collected — import',
  window_mismatch: 'Collection window differs from policy',
  shutdown_unconfirmed: 'Provider shutdown not confirmed',
  coverage_incomplete: 'Usage coverage incomplete — import',
  observation_stale: 'Last observation is stale',
  final_correction_pending: 'Final correction pending',
};

/**
 * api.ManagedPostgresAccountingDiagnostic.
 * @go api.ManagedPostgresAccountingDiagnostic
 */
export interface ManagedPostgresAccountingDiagnostic {
  database_id: string;
  name: string;
  state: string;
  accounting_required: boolean;
  identity_known: boolean;
  accounting_database_id: string;
  blocking: boolean;
  reasons: string[];
  required_from?: string;
  required_until?: string;
  collected_window_seconds: number;
  collected_from?: string;
  collected_until?: string;
  observed_at?: string;
  correction_observed_at?: string;
  correction_required_at?: string;
  lease_until?: string;
}

/**
 * api.ManagedPostgresAccountingDiagnosticsResponse. `next_cursor` is a database id.
 * @go api.ManagedPostgresAccountingDiagnosticsResponse
 */
export interface ManagedPostgresAccountingDiagnosticsResponse {
  account_id: string;
  evaluated_at: string;
  policy_enabled: boolean;
  /** The usage policy's collection window; every imported window must be exactly this long. */
  window_seconds: number;
  items: ManagedPostgresAccountingDiagnostic[];
  next_cursor?: string;
}

/** 503 managed_postgres_unavailable when the environment has no provider configured. */
export const getManagedPostgresUsage = (accountId: string) =>
  request<ManagedPostgresUsageOperatorResponse>(
    `/v1/admin/managed-postgres/usage/${encodeURIComponent(accountId)}`,
    { cache: 'no-store' },
  );

/** limit 1..100 (server default 50); `after` is the previous page's next_cursor. */
export const getManagedPostgresAccounting = (accountId: string, after?: string, limit = 50) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (after) q.set('after', after);
  return request<ManagedPostgresAccountingDiagnosticsResponse>(
    `/v1/admin/managed-postgres/accounting/${encodeURIComponent(accountId)}?${q}`,
    { cache: 'no-store' },
  );
};

/** Problem codes that mean "not available here", not "something broke". */
export const MANAGED_POSTGRES_UNAVAILABLE_CODES = ['managed_postgres_unavailable', 'managed_postgres_plan_unknown'];

/* ───────────────────── Managed PostgreSQL: usage import ────────────────── */

/** @go api.ManagedPostgresUsageImportReading */
export interface ManagedPostgresUsageImportReading {
  meter: string;
  quantity: number;
}

/** @go api.ManagedPostgresUsageImportWindow */
export interface ManagedPostgresUsageImportWindow {
  from: string;
  to: string;
  observed_at: string;
  readings: ManagedPostgresUsageImportReading[];
}

/**
 * api.ManagedPostgresUsageImportRequest without expected_revision (preview body).
 * @go api.ManagedPostgresUsageImportRequest
 */
export interface ManagedPostgresUsageImportRequest {
  import_id: string;
  database_id: string;
  evidence_reference: string;
  evidence_sha256: string;
  reason: string;
  windows: ManagedPostgresUsageImportWindow[];
}

/**
 * api.ManagedPostgresUsageImportResult. `applied` is false on preview.
 * @go api.ManagedPostgresUsageImportResult
 */
export interface ManagedPostgresUsageImportResult {
  import_id: string;
  database_id: string;
  revision: string;
  applied: boolean;
  window_count: number;
  previous_cost_millicents: number;
  imported_cost_millicents: number;
  cost_delta_millicents: number;
  collected_from: string;
  collected_until: string;
  observed_at: string;
}

/** managedpostgres.MaximumUsageImportWindows. */
export const MAX_USAGE_IMPORT_WINDOWS = 256;

/**
 * Read-only plan. Must not carry expected_revision (the server rejects it).
 * @goBody api.ManagedPostgresUsageImportRequest
 */
export const previewManagedPostgresUsageImport = (accountId: string, body: ManagedPostgresUsageImportRequest) =>
  request<ManagedPostgresUsageImportResult>(
    `/v1/admin/managed-postgres/accounting/${encodeURIComponent(accountId)}/usage-imports/preview`,
    { method: 'POST', body: JSON.stringify(body) },
  );

/**
 * Applies exactly the previewed request; `expectedRevision` is the preview's `revision`.
 * @goBody api.ManagedPostgresUsageImportRequest
 */
export const applyManagedPostgresUsageImport = (
  accountId: string,
  body: ManagedPostgresUsageImportRequest,
  expectedRevision: string,
  opts?: OperatorWrite,
) =>
  request<ManagedPostgresUsageImportResult>(
    `/v1/admin/managed-postgres/accounting/${encodeURIComponent(accountId)}/usage-imports`,
    { method: 'POST', headers: writeHeaders(opts), body: JSON.stringify({ ...body, expected_revision: expectedRevision }) },
  );

/**
 * Parses the operator's windows JSON and mirrors validateUsageImportRequest
 * plus the per-window checks ImportUsage makes against the policy window.
 * Returns the windows or the first problem found.
 */
export function parseUsageImportWindows(
  raw: string,
  opts: { now?: number; windowSeconds?: number } = {},
): { windows: ManagedPostgresUsageImportWindow[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { error: `Windows must be JSON: ${(err as Error).message}` };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: 'Windows must be a non-empty JSON array.' };
  if (parsed.length > MAX_USAGE_IMPORT_WINDOWS) return { error: `At most ${MAX_USAGE_IMPORT_WINDOWS} windows per import.` };
  const nowMicros = (opts.now ?? Date.now()) * 1000;
  const windows: ManagedPostgresUsageImportWindow[] = [];
  let previousTo: number | null = null;
  for (const [index, item] of parsed.entries()) {
    const where = `Window ${index + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: `${where} must be an object.` };
    const w = item as Record<string, unknown>;
    const allowed = new Set(['from', 'to', 'observed_at', 'readings']);
    const unknown = Object.keys(w).find((key) => !allowed.has(key));
    if (unknown) return { error: `${where}: unknown field "${unknown}".` };
    const { from, to, observed_at: observedAt, readings } = w;
    if (typeof from !== 'string' || typeof to !== 'string' || typeof observedAt !== 'string') {
      return { error: `${where}: from, to and observed_at must be RFC 3339 strings.` };
    }
    const f = parseRfc3339Micros(from);
    const t = parseRfc3339Micros(to);
    const o = parseRfc3339Micros(observedAt);
    if (f === null || t === null || o === null) {
      return { error: `${where}: times must be RFC 3339 with at most microsecond precision.` };
    }
    if (t <= f) return { error: `${where}: to must be after from.` };
    if (opts.windowSeconds && t - f !== opts.windowSeconds * 1_000_000) {
      return { error: `${where}: must span exactly the policy window (${opts.windowSeconds} s).` };
    }
    if (o < t) return { error: `${where}: observed_at must not be before to.` };
    if (o > nowMicros) return { error: `${where}: observed_at is in the future.` };
    if (previousTo !== null && f !== previousTo) return { error: `${where}: must start where the previous window ended.` };
    previousTo = t;
    if (!Array.isArray(readings) || readings.length === 0 || readings.length > 6) {
      return { error: `${where}: readings must list 1–6 meters.` };
    }
    const seen = new Set<string>();
    const cleanReadings: ManagedPostgresUsageImportReading[] = [];
    for (const reading of readings) {
      const r = reading as Record<string, unknown> | null;
      if (!r || typeof r !== 'object' || typeof r.meter !== 'string' || typeof r.quantity !== 'number') {
        return { error: `${where}: each reading needs a meter name and a numeric quantity.` };
      }
      if (!(MANAGED_POSTGRES_METERS as readonly string[]).includes(r.meter)) {
        return { error: `${where}: unknown meter "${r.meter}".` };
      }
      if (seen.has(r.meter)) return { error: `${where}: meter "${r.meter}" is listed twice.` };
      if (!Number.isSafeInteger(r.quantity) || r.quantity < 0) {
        return { error: `${where}: ${r.meter} quantity must be a non-negative integer.` };
      }
      seen.add(r.meter);
      cleanReadings.push({ meter: r.meter, quantity: r.quantity });
    }
    windows.push({ from, to, observed_at: observedAt, readings: cleanReadings });
  }
  return { windows };
}

/** A starter window aligned to the policy window, ending at the last full boundary. */
export function usageImportTemplate(windowSeconds: number, now = Date.now()): ManagedPostgresUsageImportWindow[] {
  const span = Math.max(1, windowSeconds) * 1000;
  const to = Math.floor(now / span) * span;
  return [
    {
      from: toRfc3339Seconds(new Date(to - span)),
      to: toRfc3339Seconds(new Date(to)),
      observed_at: toRfc3339Seconds(new Date(to)),
      readings: [{ meter: 'compute_unit_seconds', quantity: 0 }],
    },
  ];
}

/** Field-level problems with the non-window parts of an import request. */
export function usageImportFieldError(body: Omit<ManagedPostgresUsageImportRequest, 'windows'>): string | null {
  if (!isUuid(body.import_id)) return 'Import ID must be a UUID.';
  if (!isUuid(body.database_id)) return 'Database ID must be a UUID.';
  if (!isImportText(body.evidence_reference, 256)) return 'Evidence reference is required (≤256 bytes, no surrounding spaces).';
  if (!isLowerSha256(body.evidence_sha256)) return 'Evidence SHA-256 must be 64 lowercase hex characters.';
  if (!isImportText(body.reason, 512)) return 'Reason is required (≤512 bytes, no surrounding spaces).';
  return null;
}

/* ─────────────────── Managed PostgreSQL: reconciliation ────────────────── */

/**
 * api.ManagedPostgresAccountingReconciliationRequest without expected_revision.
 * @go api.ManagedPostgresAccountingReconciliationRequest
 */
export interface ManagedPostgresReconciliationRequest {
  reconciliation_id: string;
  database_id: string;
  backend_id: string;
  backend_fingerprint: string;
  provider_resource_id: string;
  shutdown_at: string;
  observed_at: string;
  evidence_reference: string;
  evidence_sha256: string;
  reason: string;
}

/**
 * api.ManagedPostgresAccountingReconciliationResult.
 * @go api.ManagedPostgresAccountingReconciliationResult
 */
export interface ManagedPostgresReconciliationResult {
  reconciliation_id: string;
  database_id: string;
  revision: string;
  applied: boolean;
  previous_deleted_at?: string;
  shutdown_at: string;
  observed_at: string;
  shared_accounting: boolean;
  /** Always true today: the database's usage still has to be imported afterwards. */
  requires_usage_recovery: boolean;
}

/** @goBody api.ManagedPostgresAccountingReconciliationRequest */
export const previewManagedPostgresReconciliation = (accountId: string, body: ManagedPostgresReconciliationRequest) =>
  request<ManagedPostgresReconciliationResult>(
    `/v1/admin/managed-postgres/accounting/${encodeURIComponent(accountId)}/reconciliations/preview`,
    { method: 'POST', body: JSON.stringify(body) },
  );

/** @goBody api.ManagedPostgresAccountingReconciliationRequest */
export const applyManagedPostgresReconciliation = (
  accountId: string,
  body: ManagedPostgresReconciliationRequest,
  expectedRevision: string,
  opts?: OperatorWrite,
) =>
  request<ManagedPostgresReconciliationResult>(
    `/v1/admin/managed-postgres/accounting/${encodeURIComponent(accountId)}/reconciliations`,
    { method: 'POST', headers: writeHeaders(opts), body: JSON.stringify({ ...body, expected_revision: expectedRevision }) },
  );

/** Mirror of validateAccountingReconciliation (minus the actor, which the server supplies). */
export function reconciliationFieldError(body: ManagedPostgresReconciliationRequest, now = Date.now()): string | null {
  if (!isUuid(body.reconciliation_id)) return 'Reconciliation ID must be a UUID.';
  if (!isUuid(body.database_id)) return 'Database ID must be a UUID.';
  if (!isImportText(body.backend_id, 128)) return 'Backend ID is required (≤128 bytes).';
  if (!isLowerSha256(body.backend_fingerprint)) return 'Backend fingerprint must be 64 lowercase hex characters.';
  if (!isImportText(body.provider_resource_id, 1024)) return 'Provider resource ID is required (≤1024 bytes).';
  const shutdown = parseRfc3339Micros(body.shutdown_at);
  const observed = parseRfc3339Micros(body.observed_at);
  if (shutdown === null) return 'Shutdown time must be RFC 3339 with at most microsecond precision.';
  if (observed === null) return 'Observed time must be RFC 3339 with at most microsecond precision.';
  if (observed < shutdown) return 'Observed time must not be before the shutdown.';
  if (observed > now * 1000) return 'Observed time is in the future.';
  if (!isImportText(body.evidence_reference, 256)) return 'Evidence reference is required (≤256 bytes, no surrounding spaces).';
  if (!isLowerSha256(body.evidence_sha256)) return 'Evidence SHA-256 must be 64 lowercase hex characters.';
  if (!isImportText(body.reason, 512)) return 'Reason is required (≤512 bytes, no surrounding spaces).';
  return null;
}

/* ─────────────────────── Object storage usage report ───────────────────── */

/**
 * api.ObjectStorageUsageReport: an authoritative cumulative UTC-month report
 * from a provider adapter. Every field is required (explicit zeros allowed,
 * null rejected) and unknown fields are refused.
 * @go api.ObjectStorageUsageReport
 */
export interface ObjectStorageUsageReport {
  account_id: string;
  backend_id: string;
  backend_fingerprint: string;
  source: string;
  period_start: string;
  observed_at: string;
  stored_byte_hours: number;
  request_count: number;
  egress_bytes: number;
  cost_millicents: number;
}

/** state.ObjectStoragePeriod: the first instant of observed_at's UTC month. */
export function objectStoragePeriodStart(observedAt: string): string | null {
  const micros = parseRfc3339Micros(observedAt);
  if (micros === null) return null;
  const d = new Date(Math.floor(micros / 1000));
  return toRfc3339Seconds(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/** Mirror of state.validObjectReport. The server also requires the backend to hold one of the account's buckets and the report to advance every counter. */
export function objectStorageReportError(r: ObjectStorageUsageReport, now = Date.now()): string | null {
  if (!isUuid(r.account_id)) return 'Account must be an account UUID.';
  if (!r.backend_id || r.backend_id.length > 63) return 'Backend ID is required (≤63 characters).';
  if (!/^[0-9a-fA-F]{64}$/.test(r.backend_fingerprint)) return 'Backend fingerprint must be 64 hex characters.';
  if (!r.source || r.source.length > 128) return 'Source is required (≤128 characters).';
  const observed = parseRfc3339Micros(r.observed_at);
  if (observed === null) return 'Observed time must be RFC 3339.';
  if (observed > now * 1000) return 'Observed time is in the future.';
  if (r.period_start !== objectStoragePeriodStart(r.observed_at)) return 'Period start must be the first instant of the observed UTC month.';
  for (const [name, value] of [
    ['Stored byte-hours', r.stored_byte_hours],
    ['Request count', r.request_count],
    ['Egress bytes', r.egress_bytes],
    ['Cost (millicents)', r.cost_millicents],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) return `${name} must be a non-negative integer.`;
  }
  return null;
}

/**
 * POST /v1/admin/object-storage/usage-reports → 204. A replay of the identical report is a no-op.
 * @goBody api.ObjectStorageUsageReport
 */
export const recordObjectStorageUsageReport = (report: ObjectStorageUsageReport, opts?: OperatorWrite) =>
  request<void>(
    '/v1/admin/object-storage/usage-reports',
    { method: 'POST', headers: writeHeaders(opts), body: JSON.stringify(report) },
    'none',
  );
