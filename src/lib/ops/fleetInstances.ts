/* ==========================================================================
   Instances across the fleet (apid ADR-20261121161842).

     GET /v1/admin/obs/instances       resident instances on every node,
                                       most recently used first
     GET /v1/admin/obs/instances/{id}  one instance in any state
   ========================================================================== */

import { request, type ObsInstanceRow, type ObsInvocationRow } from '@/lib/api';
import type { ObsWakeEvent } from '@/lib/ops/support';

/** @go api.ObsInstanceListResponse */
export interface ObsInstanceListResponse {
  items: ObsInstanceRow[];
  limit: number;
  truncated: boolean;
  /** Nodes whose instances could not be read: the list may be missing theirs. */
  unavailable_nodes?: string[];
}

/** running: serving now. resident: every VM held on a node (adds warm, frozen, starting, draining, …). */
export type InstanceListState = 'running' | 'resident';

export interface InstanceListFilter {
  state?: InstanceListState;
  node?: string;
  appId?: string;
  accountId?: string;
  limit?: number;
}

/** apid's ObsInstanceListMax. */
export const INSTANCE_LIST_MAX = 1000;

export function instanceListQuery(f: InstanceListFilter): string {
  const q = new URLSearchParams();
  if (f.state === 'resident') q.set('state', 'resident');
  if (f.node) q.set('node', f.node);
  if (f.appId) q.set('app_id', f.appId);
  if (f.accountId) q.set('account_id', f.accountId);
  const limit = Math.trunc(f.limit ?? 0);
  if (limit >= 1) q.set('limit', String(Math.min(limit, INSTANCE_LIST_MAX)));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const listFleetInstances = (f: InstanceListFilter = {}) =>
  request<ObsInstanceListResponse>(`/v1/admin/obs/instances${instanceListQuery(f)}`, { cache: 'no-store' });

export const getObsInstance = (id: string) =>
  request<ObsInstanceRow>(`/v1/admin/obs/instances/${encodeURIComponent(id)}`, { cache: 'no-store' });

/** The app's recent invocations this instance ran (apid sends instance_id once one claimed it). */
export const invocationsOnInstance = (rows: ObsInvocationRow[], instanceId: string) =>
  rows.filter((row) => row.instance_id === instanceId);

export interface WakePhase {
  kind: string;
  at: string;
  /** Milliseconds since the wake's first event. */
  offsetMs: number;
}

/** A wake's events as phases with their offset from the first, for a compact summary. */
export function wakePhases(events: ObsWakeEvent[]): WakePhase[] {
  const first = events.length ? Date.parse(events[0].at) : NaN;
  return events.map((e) => {
    const at = Date.parse(e.at);
    return { kind: e.kind, at: e.at, offsetMs: Number.isFinite(at) && Number.isFinite(first) ? at - first : 0 };
  });
}
