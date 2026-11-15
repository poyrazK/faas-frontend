/* ==========================================================================
   Support inbox (apid pkg/apid/support; account panel ADR-20261115120000).
   Staff routes need an MFA-completed operator session on the support roster;
   writes also need fresh step-up, the console origin and an Idempotency-Key
   (a UUID), which OperatorActionDialog supplies.

     GET  /v1/admin/support/tickets                    inbox, newest first
     GET  /v1/admin/support/tickets/{id}               one ticket with its SLA clock
     GET  /v1/admin/support/tickets/{id}/messages      thread, internal notes included
     GET  /v1/admin/support/tickets/{id}/customer      the account behind it
     POST /v1/admin/support/tickets/{id}/{op}          reply, note, close, reopen, pause, resume, triage
     GET  /v1/admin/support/notifications              this operator's unread count
     POST /v1/admin/support/tickets/{id}/read          mark this operator's notifications read
   ========================================================================== */

import { request, writeHeaders, type OperatorWrite } from '@/lib/api';
import type { AccountHealth, AccountHealthRequest, ObsTenantDiagnosis } from './accountHealth';

/** @go api.SupportContext */
export interface SupportContext {
  app_id?: string;
  deployment_id?: string;
  request_id?: string;
}

/** @go api.SupportTicket */
export interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  /** open, pending (waiting on the customer) or resolved. */
  status: string;
  revision: number;
  context: SupportContext;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  unread_count?: number;
}

/** The ticket's current SLA episode. @go support.Episode */
export interface SupportEpisode {
  id: string;
  started_at: string;
  plan: string;
  priority: string;
  category: string;
  first_response_due: string;
  first_response_at?: string;
  next_reply_due?: string;
  resolution_due: string;
  resolved_at?: string;
  /** Set while the clock is paused waiting for the customer. */
  wait_since?: string;
  resolution_breached: boolean;
}

/** @go support.StaffTicket */
export interface StaffTicket {
  ticket: SupportTicket;
  priority: string;
  team_id?: string;
  assignee_id?: string;
  episode: SupportEpisode;
  required_skills: string[];
  customer_reopens: number;
}

/** @go support.StaffPage */
export interface StaffTicketPage {
  items: StaffTicket[];
  next_cursor?: string;
}

/** @go api.SupportMessage */
export interface SupportMessage {
  id: string;
  sequence: number;
  /** customer, staff or note (internal, never shown to the customer). */
  author: string;
  body: string;
  redacted: boolean;
  created_at: string;
}

/** @go api.SupportMessagePage */
export interface SupportMessagePage {
  items: SupportMessage[];
  next_cursor?: number;
}

/** @go api.SupportSubmission */
export interface SupportSubmission {
  ticket_id: string;
  submission_id: string;
  revision: number;
}

/** @go api.SupportNotification */
export interface SupportNotification {
  id: string;
  sequence: number;
  ticket_id: string;
  kind: string;
  created_at: string;
  read_at?: string;
}

/** @go api.SupportNotificationPage */
export interface SupportNotificationPage {
  items: SupportNotification[];
  unread_count: number;
}

/** @go api.ObsSupportTicketSnapshot */
export interface SupportTicketSnapshot {
  captured_at: string;
  plan: string;
  status: string;
  health: AccountHealth;
  request?: AccountHealthRequest;
  request_id?: string;
}

/** The account behind a ticket. @go api.ObsSupportTicketCustomer */
export interface SupportTicketCustomer {
  ticket_id: string;
  unavailable?: boolean;
  account_id?: string;
  org_slug?: string;
  plan?: string;
  status?: string;
  apps: number;
  diagnosis?: ObsTenantDiagnosis;
  snapshot?: SupportTicketSnapshot;
  lifted?: string[];
  added?: string[];
}

export const TICKET_STATUSES = ['open', 'pending', 'resolved'] as const;
export const TICKET_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  pending: 'Waiting on customer',
  resolved: 'Resolved',
};
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/** apid's SupportBodyMaxBytes, SupportReasonMaxBytes and SupportSubjectMaxBytes (search). */
export const SUPPORT_BODY_MAX = 10000;
export const SUPPORT_REASON_MAX = 200;
export const SUPPORT_SEARCH_MAX = 200;

export interface TicketFilters {
  status?: string;
  search?: string;
  assigneeId?: string;
  cursor?: string;
}

export function ticketQuery(f: TicketFilters): string {
  const q = new URLSearchParams();
  if (f.status && (TICKET_STATUSES as readonly string[]).includes(f.status)) q.set('status', f.status);
  const search = f.search?.trim();
  if (search) q.set('search', search.slice(0, SUPPORT_SEARCH_MAX));
  if (f.assigneeId) q.set('assignee_id', f.assigneeId);
  if (f.cursor) q.set('cursor', f.cursor);
  const s = q.toString();
  return s ? `?${s}` : '';
}

const ticketPath = (id: string) => `/v1/admin/support/tickets/${encodeURIComponent(id)}`;

export const listSupportTickets = (f: TicketFilters = {}) =>
  request<StaffTicketPage>(`/v1/admin/support/tickets${ticketQuery(f)}`, { cache: 'no-store' });

export const getSupportTicket = (id: string) => request<StaffTicket>(ticketPath(id), { cache: 'no-store' });

export const getTicketCustomer = (id: string) => request<SupportTicketCustomer>(`${ticketPath(id)}/customer`, { cache: 'no-store' });

/** The whole thread, oldest first (apid pages it 50 at a time). */
export async function listSupportMessages(id: string, maxPages = 20): Promise<SupportMessage[]> {
  const out: SupportMessage[] = [];
  let after = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await request<SupportMessagePage>(`${ticketPath(id)}/messages${after ? `?after=${after}` : ''}`, { cache: 'no-store' });
    out.push(...res.items);
    if (!res.next_cursor) break;
    after = res.next_cursor;
  }
  return out;
}

export type TicketOp = 'reply' | 'note' | 'close' | 'reopen' | 'pause' | 'resume' | 'triage';

const OP_PATH: Record<TicketOp, string> = {
  reply: 'messages',
  note: 'notes',
  close: 'close',
  reopen: 'reopen',
  pause: 'pause',
  resume: 'resume',
  triage: 'triage',
};

export interface TicketChange {
  body?: string;
  priority?: string;
  assignee_id?: string;
  team_id?: string;
  reason?: string;
  route?: boolean;
  /** Triage replaces the ticket's skills, so send the current ones to keep them. */
  required_skills?: string[];
}

/**
 * Applies one staff action at the revision the operator was looking at; apid
 * answers 409 when the ticket changed since.
 * @goBody support.Change
 */
export const supportTicketAction = (id: string, op: TicketOp, revision: number, change: TicketChange, opts?: OperatorWrite) =>
  request<SupportSubmission>(`${ticketPath(id)}/${OP_PATH[op]}`, {
    method: 'POST',
    headers: writeHeaders(opts),
    body: JSON.stringify({ expected_revision: revision, ...change }),
  });

export const getSupportNotifications = (unread = true) =>
  request<SupportNotificationPage>(`/v1/admin/support/notifications${unread ? '?unread=true' : ''}`, { cache: 'no-store' });

/** @goBody api.SupportReadRequest */
export const markSupportRead = (id: string, throughSequence: number) =>
  request<unknown>(`${ticketPath(id)}/read`, { method: 'POST', body: JSON.stringify({ through_sequence: throughSequence }) });

/** Marks every unread notification about one ticket read; quiet when there are none. */
export async function markTicketRead(id: string): Promise<void> {
  const page = await getSupportNotifications(true);
  const latest = Math.max(0, ...page.items.filter((n) => n.ticket_id === id).map((n) => n.sequence));
  if (latest > 0) await markSupportRead(id, latest);
}

/** The SLA deadline the operator should look at next, or null when none is running. */
export function nextDue(e: SupportEpisode, status: string): { label: string; at: string } | null {
  if (status === 'resolved' || e.wait_since) return null;
  if (!e.first_response_at) return { label: 'First response', at: e.first_response_due };
  if (e.next_reply_due) return { label: 'Next reply', at: e.next_reply_due };
  return { label: 'Resolution', at: e.resolution_due };
}

/** Whether an SLA deadline has passed. */
export const isOverdue = (at: string, now = Date.now()) => Date.parse(at) < now;
