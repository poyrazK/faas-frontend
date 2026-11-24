/* ==========================================================================
   Gateway traffic (apid ADR-20261124093000).

     GET /v1/admin/obs/gateway-traffic?window=1h

   What happened to requests in the window, read from gatewayd's Prometheus
   series. Platform errors are 5xx the gateway produced before the guest sent
   a byte; capacity refusals are 429s for an app with no capacity. Wake
   admission outcomes cover the app's own wake queue and the gateway-wide
   one. held_now and admission_leaders_now are current gauges.
   ========================================================================== */

import { request } from '@/lib/api';

/** @go api.ObsGatewayTrafficTotals */
export interface ObsGatewayTrafficTotals {
  nodes: number;
  requests: number;
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
  status_429: number;
  status_502: number;
  status_503: number;
  status_504: number;
  error_rate_percent: number;
  platform_errors: number;
  platform_error_rate_percent: number;
  capacity_refusals: number;
  wakes_admitted: number;
  wake_app_queue_full: number;
  wake_gateway_queue_full: number;
  wake_queue_timeouts: number;
  held_now: number;
  admission_leaders_now: number;
}

/** @go api.ObsGatewayNodeTraffic */
export interface ObsGatewayNodeTraffic {
  node: string;
  requests: number;
  status_5xx: number;
  error_rate_percent: number;
  platform_errors: number;
  capacity_refusals: number;
  held_now: number;
  overload_level?: number;
}

/** @go api.ObsGatewayStatusCount */
export interface ObsGatewayStatusCount {
  code: string;
  count: number;
}

/** @go api.ObsGatewayAdmissionCount */
export interface ObsGatewayAdmissionCount {
  plan: string;
  /** admitted, app_queue_full, gateway_queue_full, queue_timeout, canceled or error. */
  outcome: string;
  count: number;
}

/** @go api.ObsGatewayEdgeRejection */
export interface ObsGatewayEdgeRejection {
  kind: string;
  status: string;
  count: number;
}

/** @go api.ObsGatewayReasonCount */
export interface ObsGatewayReasonCount {
  reason: string;
  count: number;
}

/** @go api.ObsGatewayAppTraffic */
export interface ObsGatewayAppTraffic {
  app_id: string;
  app_slug?: string;
  account_id?: string;
  plan?: string;
  unknown_host?: boolean;
  requests: number;
  status_5xx: number;
  status_502: number;
  status_503: number;
  status_504: number;
  error_rate_percent: number;
  platform_errors: number;
  capacity_refusals: number;
  held_now: number;
}

/** @go api.ObsGatewayTrafficReport */
export interface ObsGatewayTrafficReport {
  as_of: string;
  window_seconds: number;
  /** observed, partial, unavailable or not_configured. */
  source: string;
  failed_queries: string[];
  totals: ObsGatewayTrafficTotals;
  nodes: ObsGatewayNodeTraffic[];
  statuses: ObsGatewayStatusCount[];
  wake_admission: ObsGatewayAdmissionCount[];
  edge_rejections: ObsGatewayEdgeRejection[];
  edge_refusals: ObsGatewayReasonCount[];
  retry_exhausted: ObsGatewayReasonCount[];
  apps: ObsGatewayAppTraffic[];
}

export const TRAFFIC_WINDOWS = ['15m', '1h', '6h', '24h', '168h'] as const;
export type TrafficWindow = (typeof TRAFFIC_WINDOWS)[number];

export const isTrafficWindow = (v: string | null | undefined): v is TrafficWindow => (TRAFFIC_WINDOWS as readonly string[]).includes(v ?? '');

export const trafficWindowLabel = (w: TrafficWindow) => (w === '168h' ? '7d' : w);

export const getGatewayTraffic = (window: TrafficWindow = '1h') =>
  request<ObsGatewayTrafficReport>(`/v1/admin/obs/gateway-traffic?window=${encodeURIComponent(window)}`, { cache: 'no-store' });

const OUTCOME_LABELS: Record<string, string> = {
  admitted: 'Admitted',
  app_queue_full: "App's wake queue full",
  gateway_queue_full: 'Gateway wake queue full',
  queue_timeout: 'Wait timed out',
  canceled: 'Client gave up',
  error: 'Error',
};

/** What a wake admission outcome means, for an operator. */
export const admissionOutcomeLabel = (outcome: string) => OUTCOME_LABELS[outcome] ?? outcome;

/** Whether an outcome turned a request away. */
export const admissionOutcomeBad = (outcome: string) => outcome === 'app_queue_full' || outcome === 'gateway_queue_full' || outcome === 'queue_timeout';

/** A whole count, compact above ten thousand. */
export function formatCount(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** A percentage with up to two decimals. */
export const formatPercent = (p: number) => `${Number(p.toFixed(2))}%`;

/** Tone for an error rate: over 5% danger, over 1% warning. */
export function errorRateTone(p: number): 'danger' | 'warning' | 'neutral' {
  if (p > 5) return 'danger';
  if (p > 1) return 'warning';
  return 'neutral';
}
