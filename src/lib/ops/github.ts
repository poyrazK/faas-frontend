/* ==========================================================================
   GitHub recovery: githubd's durable webhook-delivery and Check Run update
   queues, as projected by apid (payloads and installation credentials are
   never returned).

   Contract source of truth (faas origin/main):
   - routes   pkg/apid/apidserver/server.go (/v1/admin/ops/github/*)
   - handler  pkg/apid/apidserver/handlers_admin_github_recovery.go
   - structs  pkg/api/dto.go (GithubRecoveryStatusResponse,
              GithubWebhookDeliveryRecord, GithubCheckUpdateRecord,
              GithubRecoveryRetryResponse)

   The list has no account filter: deliveries carry no tenant, and check
   updates are keyed by deployment id only. A retry resets a *dead* item to
   pending (attempts 0); anything else answers 409.
   ========================================================================== */

import { request, writeHeaders, type OperatorWrite } from '@/lib/api';

export const GITHUB_RECOVERY_STATUSES = ['pending', 'processing', 'succeeded', 'dead'] as const;
export type GithubRecoveryStatus = (typeof GITHUB_RECOVERY_STATUSES)[number];

/** Upper bound the handler accepts for ?limit= (default 100). Applied to each queue. */
export const GITHUB_RECOVERY_MAX_LIMIT = 500;

export const GITHUB_REASON_SUGGESTIONS = [
  'github_outage_recovery',
  'webhook_backlog',
  'customer_request',
  'incident_mitigation',
] as const;

/** @go api.GithubWebhookDeliveryRecord */
export interface GithubWebhookDeliveryRecord {
  delivery_id: string;
  event_type: string;
  status: string;
  attempts: number;
  /** time.Time without omitempty: year 1 when never scheduled. */
  next_attempt_at: string;
  last_error?: string;
  received_at: string;
  processed_at?: string | null;
  updated_at: string;
}

/** @go api.GithubCheckUpdateRecord */
export interface GithubCheckUpdateRecord {
  deployment_id: string;
  generation: number;
  status: string;
  attempts: number;
  next_attempt_at: string;
  last_error?: string;
  processed_at?: string | null;
  updated_at: string;
}

/** @go api.GithubRecoveryStatusResponse */
export interface GithubRecoveryStatusResponse {
  deliveries: GithubWebhookDeliveryRecord[];
  check_updates: GithubCheckUpdateRecord[];
}

/** @go api.GithubRecoveryRetryResponse */
export interface GithubRecoveryRetryResponse {
  ok: boolean;
  kind: 'delivery' | 'check_update';
  target_id: string;
  /** Always "pending" on success. */
  status: string;
}

/** Only dead items are requeued by githubd (`where … status = 'dead'`). */
export const isGithubRetryable = (status: string) => status === 'dead';

export function githubStatusTone(status: string): 'badge-success' | 'badge-warning' | 'badge-danger' | 'badge-neutral' | 'badge-info' {
  switch (status) {
    case 'succeeded':
      return 'badge-success';
    case 'dead':
      return 'badge-danger';
    case 'processing':
      return 'badge-info';
    case 'pending':
      return 'badge-warning';
    default:
      return 'badge-neutral';
  }
}

export const getGithubRecovery = (filters: { status?: GithubRecoveryStatus | ''; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (filters.status) q.set('status', filters.status);
  if (filters.limit != null) q.set('limit', String(filters.limit));
  const query = q.toString();
  return request<GithubRecoveryStatusResponse>(`/v1/admin/ops/github/recovery${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
};

export const retryGithubDelivery = (deliveryId: string, reason: string, opts?: OperatorWrite) =>
  request<GithubRecoveryRetryResponse>(
    `/v1/admin/ops/github/deliveries/${encodeURIComponent(deliveryId)}/retry?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );

/** The check-update queue is keyed by deployment id. */
export const retryGithubCheckUpdate = (deploymentId: string, reason: string, opts?: OperatorWrite) =>
  request<GithubRecoveryRetryResponse>(
    `/v1/admin/ops/github/check-updates/${encodeURIComponent(deploymentId)}/retry?confirm=true&reason=${encodeURIComponent(reason)}`,
    { method: 'POST', headers: writeHeaders(opts) },
  );
