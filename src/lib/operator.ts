/* ==========================================================================
   Pure helpers shared by operator actions. Kept free of React so they can be
   unit-tested in the node test environment.
   ========================================================================== */

/**
 * Lifecycle and recovery endpoints (ops/accounts, ops/nodes, instances,
 * apps/force-cold-boot, builds/sweep-stuck) reject any reason that is not a
 * short machine-readable code.
 */
export const REASON_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

/** Turns "Customer request #42" into "customer_request_42" as the operator types. */
export function toReasonCode(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 64);
}

/** Null when valid; otherwise a message fit for an inline field error. */
export function reasonError(value: string, format: 'code' | 'text'): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'A reason is required; it is recorded in the audit log.';
  if (format === 'code' && !REASON_CODE_PATTERN.test(trimmed)) {
    return 'Use 1–64 lowercase letters, numbers or underscores.';
  }
  if (format === 'text' && trimmed.length < 3) return 'Give at least a few words of context.';
  if (format === 'text' && trimmed.length > 500) return 'Keep the reason under 500 characters.';
  return null;
}

/** Common reason codes per action family, offered as one-click suggestions. */
export const REASON_SUGGESTIONS = {
  account: ['abuse_report', 'payment_fraud', 'customer_request', 'security_incident', 'false_positive_restore'],
  node: ['planned_maintenance', 'hardware_fault', 'kernel_upgrade', 'capacity_rebalance', 'incident_mitigation'],
  instance: ['stuck_instance', 'runaway_resource_use', 'incident_mitigation', 'customer_request'],
  build: ['stuck_build', 'builder_crash', 'incident_mitigation'],
} as const;

/**
 * Returns `raw` only when it is a same-origin path; anything else (absolute
 * URLs, protocol-relative //host, backslash tricks) falls back. Used for the
 * login page's ?next= parameter so a crafted link cannot bounce an operator to
 * another site after sign-in.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, 'https://operations.invalid');
    if (url.origin !== 'https://operations.invalid') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Formats integer minor units. Billing runs in the provider catalog's
 * currency, so the code comes from the response; without one the amount is
 * shown bare rather than under a guessed symbol.
 */
export function formatCents(cents: number, currency?: string | null): string {
  const major = cents / 100;
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat('en-IE', { style: 'currency', currency: currency.toUpperCase() }).format(major);
    } catch {
      /* unknown ISO code: fall through to the bare amount */
    }
  }
  return major.toFixed(2);
}

/** Parses an operator-entered amount ("12.50", "12,50") into integer minor units. */
export function parseMoneyAmount(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** Bytes → "1.25 GB" / "512 MB"; null-safe for telemetry gaps. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

/** MB → "1.5 GB" / "512 MB". */
export function formatMegabytes(mb: number | null | undefined): string {
  if (mb == null || !Number.isFinite(mb)) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

/** z-score at or above which an anomaly counts as severe everywhere in the console. */
export const SEVERE_ANOMALY_Z = 3.5;

/** Product SLO: a parked app wakes in under 350 ms at p50. */
export const WAKE_SLO_P50_MS = 350;

/** Go encodes a never-set time.Time as year 1; treat anything that old as absent. */
export function isRealTimestamp(iso: string | null | undefined): iso is string {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > Date.UTC(2000, 0, 1);
}
