/* ==========================================================================
   Egress denials and abuse signals (apid ADR-20261127100000).

     GET /v1/admin/obs/egress?window=24h

   Tenant egress the platform dropped (vmmd's per-app nftables counters, by
   class, node and app), first contacts with new destinations, and the abuse
   signals schedd, gatewayd's guest DNS resolver and imaged emit. Counts are
   Prometheus increase() over the window, rounded: estimates, not ledgers.
   ========================================================================== */

import { request } from '@/lib/api';

/** @go api.ObsEgressTotals */
export interface ObsEgressTotals {
  denied: number;
  denied_last_hour: number;
  apps_denied: number;
  new_destinations: number;
  abuse_recycles: number;
  abuse_holds: number;
  cpu_abuse_signals: number;
  dns_blocked: number;
  scan_blocked: number;
  scan_flagged: number;
  /** Absent when the flow log read failed. */
  flow_log_rows?: number;
}

/** @go api.ObsEgressCount */
export interface ObsEgressCount {
  key: string;
  count: number;
}

/** @go api.ObsEgressApp */
export interface ObsEgressApp {
  app_id: string;
  app_slug?: string;
  account_id?: string;
  denied: number;
  classes: ObsEgressCount[];
  new_destinations: number;
  abuse_recycles: number;
}

/** @go api.ObsEgressRecycle */
export interface ObsEgressRecycle {
  app_id: string;
  app_slug?: string;
  account_id?: string;
  /** fanout or flood. */
  reason: string;
  count: number;
}

/** @go api.ObsEgressCPUSignal */
export interface ObsEgressCPUSignal {
  plan: string;
  action: string;
  count: number;
}

/** @go api.ObsEgressScanFinding */
export interface ObsEgressScanFinding {
  category: string;
  /** block or flag. */
  action: string;
  count: number;
}

/** @go api.ObsEgressDenylistDrop */
export interface ObsEgressDenylistDrop {
  /** firewall (tenant traffic) or image_pull. */
  source: string;
  cidr: string;
  count: number;
}

/** @go api.ObsEgressReport */
export interface ObsEgressReport {
  as_of: string;
  window_seconds: number;
  /** observed, partial, unavailable or not_configured. */
  source: string;
  failed_queries: string[];
  totals: ObsEgressTotals;
  classes: ObsEgressCount[];
  nodes: ObsEgressCount[];
  apps: ObsEgressApp[];
  recycles: ObsEgressRecycle[];
  holds: ObsEgressCount[];
  cpu_signals: ObsEgressCPUSignal[];
  dns_blocked: ObsEgressCount[];
  scan_findings: ObsEgressScanFinding[];
  denylist: ObsEgressDenylistDrop[];
}

export const EGRESS_WINDOWS = ['1h', '6h', '24h', '168h'] as const;
export type EgressWindow = (typeof EGRESS_WINDOWS)[number];
export const EGRESS_DEFAULT_WINDOW: EgressWindow = '24h';

export const isEgressWindow = (v: string | null | undefined): v is EgressWindow => (EGRESS_WINDOWS as readonly string[]).includes(v ?? '');

export const egressWindowLabel = (w: EgressWindow) => (w === '168h' ? '7d' : w);

export const getEgress = (window: EgressWindow = EGRESS_DEFAULT_WINDOW) =>
  request<ObsEgressReport>(`/v1/admin/obs/egress?window=${encodeURIComponent(window)}`, { cache: 'no-store' });

const CLASSES: Record<string, { label: string; detail: string }> = {
  smtp: { label: 'SMTP', detail: 'Mail ports 25, 465 and 587 are always blocked.' },
  rfc1918: { label: 'Private network', detail: 'RFC1918 and link-local addresses: other hosts on the platform network.' },
  metadata: { label: 'Metadata', detail: 'Cloud metadata endpoints.' },
  allowlist: { label: 'Not on allowlist', detail: "Outside the app's egress allowlist." },
  port_policy: { label: 'Port policy', detail: 'An undeclared port, or traffic that is not TCP.' },
  rate_limit: { label: 'Rate limit', detail: 'New connections over the per-app rate.' },
  flood: { label: 'Flood', detail: 'A burst the flood guard dropped.' },
  unresolved: { label: 'Unresolved IP', detail: 'Connected to an address it never resolved through platform DNS.' },
};

/** The operator name for a denial class. */
export const denialClassLabel = (c: string) => CLASSES[c]?.label ?? c;

/** What a denial class means. */
export const denialClassDetail = (c: string) => CLASSES[c]?.detail ?? '';

/** Classes that point at abuse rather than a misconfigured app. */
export const denialClassSevere = (c: string) => c === 'smtp' || c === 'metadata' || c === 'flood';

/** The egress flow log search for an account. */
export const flowLogHref = (accountId: string) => `/metering?account=${encodeURIComponent(accountId.trim())}`;

/** Abuse signals in the window, summed. */
export const abuseSignalTotal = (t: ObsEgressTotals) => t.abuse_recycles + t.abuse_holds + t.cpu_abuse_signals + t.dns_blocked + t.scan_blocked + t.scan_flagged;
