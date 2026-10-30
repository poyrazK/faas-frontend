/* ==========================================================================
   Status page authoring — operator client for /v1/admin/status/incidents.

   Contract: faas origin/main pkg/api/dto.go (PublicStatusEvent,
   PublicStatusUpdate, AdminStatus*Request), the handlers in
   pkg/apid/apidserver/handlers_admin_status.go and the rules in
   pkg/publicstatus/model.go. The admin endpoints return the same
   PublicStatusEvent customers read at gregale.dev/status, so there is no
   separate admin model. apid decodes every body strictly: an unknown field
   (a `reason`, say) is a 400, so these writes carry none.
   ========================================================================== */

import { request, writeHeaders, type OperatorWrite } from '@/lib/api';

export type StatusEventKind = 'incident' | 'maintenance';

/** Public components (publicstatus.AllComponents). */
export type StatusComponent = 'api_console' | 'deployments' | 'app_execution' | 'networking' | 'observability';

/** Public health states; an event's impact is one of them. */
export type StatusImpact = 'operational' | 'maintenance' | 'degraded' | 'partial_outage' | 'major_outage' | 'unknown';

export type IncidentImpact = 'degraded' | 'partial_outage' | 'major_outage';

export type StatusLifecycle =
  | 'investigating'
  | 'identified'
  | 'monitoring'
  | 'resolved'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/** One timeline entry. impact/components are set only when the update changed them. */
export interface PublicStatusUpdate {
  id: string;
  state: StatusLifecycle;
  message: string;
  posted_at: string;
  edited_at?: string;
  impact?: StatusImpact;
  components?: StatusComponent[];
}

/** The event as customers read it. `id` is the public id ({public_id} in paths). */
export interface PublicStatusEvent {
  id: string;
  kind: StatusEventKind;
  title: string;
  impact: StatusImpact;
  components: StatusComponent[];
  state: StatusLifecycle;
  starts_at?: string;
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  updated_at: string;
  edited_at?: string;
  resolved_at?: string;
  updates: PublicStatusUpdate[];
}

/**
 * POST body. apid fills an incident's starts_at with now and a maintenance
 * impact/state when omitted; an incident must not carry a schedule and
 * maintenance must not carry starts_at (publicstatus.ValidateEvent).
 */
export interface AdminStatusEventCreateRequest {
  kind: StatusEventKind;
  title: string;
  impact: StatusImpact;
  components: StatusComponent[];
  state: StatusLifecycle;
  starts_at?: string;
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  message: string;
}

/**
 * POST …/updates body. impact and components are optional; an empty
 * components array is not "unchanged" — apid refuses it — so omit it.
 */
export interface AdminStatusEventUpdateRequest {
  state: StatusLifecycle;
  message: string;
  impact?: StatusImpact;
  components?: StatusComponent[];
}

/** Subset of GET /v1/status (PublicStatusOverview) the console reads. */
export interface PublicStatusOverviewSummary {
  overall_status: StatusImpact;
  data_status: string;
  updated_at: string;
  components: { id: string; name: string; status: StatusImpact }[];
}

export interface StatusEventFilter {
  kind?: StatusEventKind | '';
  /** Server-side: only events whose resolved_at is unset. */
  active?: boolean;
}

/** Newest first by updated_at; apid returns at most 200. */
export const listAdminStatusEvents = (filter: StatusEventFilter = {}) => {
  const q = new URLSearchParams();
  if (filter.kind) q.set('kind', filter.kind);
  if (filter.active) q.set('active', 'true');
  const query = q.toString();
  return request<PublicStatusEvent[]>(`/v1/admin/status/incidents${query ? `?${query}` : ''}`, { cache: 'no-store' });
};

export const STATUS_LIST_LIMIT = 200;

/** Publishes an incident or schedules maintenance. Customer-visible at once. */
export const createAdminStatusEvent = (body: AdminStatusEventCreateRequest, opts?: OperatorWrite) =>
  request<PublicStatusEvent>('/v1/admin/status/incidents', {
    method: 'POST',
    headers: writeHeaders(opts),
    body: JSON.stringify(body),
  });

/** Appends a lifecycle update; a terminal state closes the event. */
export const appendAdminStatusUpdate = (publicId: string, body: AdminStatusEventUpdateRequest, opts?: OperatorWrite) =>
  request<PublicStatusEvent>(`/v1/admin/status/incidents/${encodeURIComponent(publicId)}/updates`, {
    method: 'POST',
    headers: writeHeaders(opts),
    body: JSON.stringify(body),
  });

/** Corrects a published title (any state); the event is marked edited. */
export const editAdminStatusEventTitle = (publicId: string, title: string, opts?: OperatorWrite) =>
  request<PublicStatusEvent>(`/v1/admin/status/incidents/${encodeURIComponent(publicId)}`, {
    method: 'PATCH',
    headers: writeHeaders(opts),
    body: JSON.stringify({ title }),
  });

/** Corrects one published timeline message; its posted_at ordering is kept. */
export const editAdminStatusUpdateMessage = (publicId: string, updateId: string, message: string, opts?: OperatorWrite) =>
  request<PublicStatusEvent>(
    `/v1/admin/status/incidents/${encodeURIComponent(publicId)}/updates/${encodeURIComponent(updateId)}`,
    {
      method: 'PATCH',
      headers: writeHeaders(opts),
      body: JSON.stringify({ message }),
    },
  );

/** Unauthenticated public snapshot, the same response gregale.dev/status renders. */
export const getPublicStatusOverview = () =>
  request<PublicStatusOverviewSummary>('/v1/status', { cache: 'no-store' });
