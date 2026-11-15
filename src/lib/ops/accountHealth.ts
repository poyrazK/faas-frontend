/* ==========================================================================
   Account visibility (apid ADR-20261112170000, ADR-20261113123000,
   ADR-20261113180000): find the account behind anything a customer quotes,
   explain why it is not working, and list customers who look stuck.

     GET /v1/admin/obs/lookup?q=           account behind an email, slug, URL,
                                           id, request id or trace id
     GET /v1/admin/obs/tenants/{id}/360    `diagnosis` explains the account
     GET /v1/admin/obs/attention           stuck-customer signals
   ========================================================================== */

import { request } from '@/lib/api';

/** @go api.ObsLookupMatch */
export interface ObsLookupMatch {
  /** account, app, deployment, domain, request or trace. */
  kind: string;
  account_id: string;
  app_id?: string;
  app_slug?: string;
  /** Short hint such as "email", "custom domain" or "API error validation_failed". */
  detail?: string;
  at?: string;
}

/** @go api.ObsLookupResponse */
export interface ObsLookupResponse {
  query: string;
  matches: ObsLookupMatch[];
}

/** apid's ObsLookupQueryMaxBytes. */
export const LOOKUP_QUERY_MAX = 256;

/** Resolve anything a customer quotes to the account it belongs to. */
export function lookupAccount(query: string): Promise<ObsLookupResponse> {
  const q = query.trim();
  return request<ObsLookupResponse>(`/v1/admin/obs/lookup?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
}

/** @go api.ObsTenantRestriction */
export interface ObsTenantRestriction {
  kind: string;
  reason?: string;
  since?: string;
}

/** @go api.ObsTenantFailedDeploy */
export interface ObsTenantFailedDeploy {
  deployment_id: string;
  app_id: string;
  app_slug?: string;
  status: string;
  error_code?: string;
  error?: string;
  hint?: string;
  created_at: string;
}

/** @go api.ObsTenantDomainIssue */
export interface ObsTenantDomainIssue {
  domain: string;
  app_slug?: string;
  problem: string;
  cert_status?: string;
  cert_last_error?: string;
  cert_expires_at?: string;
}

/** @go api.ObsCustomerErrorCode */
export interface ObsCustomerErrorCode {
  code: string;
  count: number;
  last_at: string;
}

/** @go api.ObsCustomerErrorEvent */
export interface ObsCustomerErrorEvent {
  occurred_at: string;
  /** Matched route pattern, never the raw URL. */
  route: string;
  code: string;
  app_slug?: string;
  request_id?: string;
  trace_id?: string;
}

/** @go api.ObsCustomerErrorSummary */
export interface ObsCustomerErrorSummary {
  window_hours: number;
  total: number;
  by_code: ObsCustomerErrorCode[];
  recent: ObsCustomerErrorEvent[];
  /** Errors this apid replica did not record (budget exceeded). */
  dropped?: number;
}

/** @go api.ObsAttentionSignal */
export interface ObsAttentionSignal {
  id: number;
  account_id: string;
  kind: string;
  /** App slug, job name, problem code or hostname. */
  subject: string;
  detail?: string;
  state: string;
  observed: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at?: string;
  dismissed_at?: string;
  dismissed_by?: string;
  dismiss_reason?: string;
  outcome?: string;
  ticket_id?: string;
}

/** @go api.ObsAttentionListResponse */
export interface ObsAttentionListResponse {
  items: ObsAttentionSignal[];
  limit: number;
}

/** @go api.ObsTenantDiagnosis */
export interface ObsTenantDiagnosis {
  generated_at: string;
  restrictions: ObsTenantRestriction[];
  failed_deployments: ObsTenantFailedDeploy[];
  domain_issues: ObsTenantDomainIssue[];
  healthy_domains: number;
  enabled_flags: string[];
  customer_errors: ObsCustomerErrorSummary;
  attention_signals: ObsAttentionSignal[];
  /** Sections that could not be read: their lists mean unknown, not none. */
  unavailable?: string[];
}

/** Signal states the list filter accepts; "active" is open plus dismissed. */
export const ATTENTION_STATES = ['active', 'open', 'dismissed', 'resolved'] as const;
export type AttentionState = (typeof ATTENTION_STATES)[number];

/** apid's AttentionKinds, in its display order. */
export const ATTENTION_KINDS = [
  'deploy_failing',
  'app_oom',
  'boot_failing',
  'jobs_failing',
  'domain_stuck',
  'refused_burst',
  'limit_pressure',
  'payment_failing',
] as const;

export const ATTENTION_KIND_LABELS: Record<string, string> = {
  deploy_failing: 'Deploys keep failing',
  app_oom: 'Out of memory',
  boot_failing: 'Fails to boot',
  jobs_failing: 'Scheduled job failing',
  domain_stuck: 'Domain not serving',
  refused_burst: 'Burst of refused requests',
  limit_pressure: 'Keeps hitting a plan limit',
  payment_failing: 'Payment failing',
};

/** Kinds the customer also sees on their account health page (apid ADR-20261114190002). */
export const CUSTOMER_VISIBLE_KINDS: readonly string[] = ['deploy_failing', 'app_oom', 'jobs_failing', 'limit_pressure'];

/** apid's AttentionListMax. */
export const ATTENTION_LIST_MAX = 200;

export interface AttentionFilters {
  kind?: string;
  state?: AttentionState;
  accountId?: string;
  limit?: number;
}

export function attentionQuery(f: AttentionFilters): string {
  const q = new URLSearchParams();
  if (f.kind) q.set('kind', f.kind);
  if (f.state && f.state !== 'active') q.set('state', f.state);
  if (f.accountId) q.set('account_id', f.accountId);
  const limit = Math.trunc(f.limit ?? 0);
  if (limit >= 1) q.set('limit', String(Math.min(limit, ATTENTION_LIST_MAX)));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** List stuck-customer signals, newest first. */
export function listAttention(f: AttentionFilters = {}): Promise<ObsAttentionListResponse> {
  return request<ObsAttentionListResponse>(`/v1/admin/obs/attention${attentionQuery(f)}`, { cache: 'no-store' });
}

export const RESTRICTION_LABELS: Record<string, string> = {
  account_suspended: 'Account suspended',
  account_past_due: 'Payment past due',
  deletion_pending: 'Deletion scheduled',
  abuse_hold: 'Abuse hold',
  email_unverified: 'Email not verified',
  overage_cap_reached: 'Overage cap reached',
  platform_release_pause: 'Platform release pause',
};

export const LOOKUP_KIND_LABELS: Record<string, string> = {
  account: 'Account',
  app: 'App',
  deployment: 'Deployment',
  domain: 'Custom domain',
  request: 'Refused request',
  trace: 'Trace',
};

export const kindLabel = (labels: Record<string, string>, kind: string) => labels[kind] ?? kind.replaceAll('_', ' ');

/** How many things the diagnosis says need attention: restrictions, open signals, failed deployments and domain problems. */
export function diagnosisAttention(d: ObsTenantDiagnosis | undefined | null): number {
  if (!d) return 0;
  const open = (d.attention_signals ?? []).filter((s) => s.state === 'open').length;
  return (d.restrictions?.length ?? 0) + open + (d.failed_deployments?.length ?? 0) + (d.domain_issues?.length ?? 0);
}
