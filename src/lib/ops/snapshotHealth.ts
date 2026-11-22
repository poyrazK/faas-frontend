/* ==========================================================================
   Fleet snapshot health (apid ADR-20261122135018).

     GET /v1/admin/obs/snapshot-health

   A snapshot's footprint is its allocated mem + vmstate plus its deployment's
   above-base layer, as fcvm_snapshot_fleet_avg_bytes counts it. Fleet figures
   cover snapshots that are not stale.
   ========================================================================== */

import { request } from '@/lib/api';

/** @go api.ObsSnapshotTotals */
export interface ObsSnapshotTotals {
  live: number;
  stale: number;
  delete_pending: number;
  live_bytes: number;
  avg_bytes: number;
  p95_bytes: number;
  over_warn: number;
  unsnapshotted: number;
  /** Live deployments with neither a usable snapshot nor a rootfs: spec invariant 6.2-3 broken. */
  not_cold_bootable: number;
}

/** @go api.ObsSnapshotGroup */
export interface ObsSnapshotGroup {
  key: string;
  live: number;
  stale: number;
  avg_bytes: number;
}

/** @go api.ObsSnapshotRow */
export interface ObsSnapshotRow {
  id: string;
  deployment_id: string;
  deployment_status: string;
  app_id: string;
  app_slug?: string;
  account_id?: string;
  tier: string;
  fc_version: string;
  cpu_template?: string;
  cpu_model?: string;
  stale: boolean;
  delete_pending: boolean;
  snapshot_bytes: number;
  layer_bytes: number;
  footprint_bytes: number;
  created_at: string;
  stale_at?: string;
}

/** @go api.ObsUnsnapshottedDeployment */
export interface ObsUnsnapshottedDeployment {
  deployment_id: string;
  app_id: string;
  app_slug?: string;
  account_id?: string;
  cold_bootable: boolean;
  created_at: string;
  last_stale_at?: string;
}

/** @go api.ObsSnapshotHealthReport */
export interface ObsSnapshotHealthReport {
  as_of: string;
  target_mb: number;
  warn_mb: number;
  page_mb: number;
  /** More snapshots existed than apid reads: the smallest are missing from the figures. */
  truncated: boolean;
  totals: ObsSnapshotTotals;
  tiers: ObsSnapshotGroup[];
  fc_versions: ObsSnapshotGroup[];
  cpu_templates: ObsSnapshotGroup[];
  largest: ObsSnapshotRow[];
  recently_stale: ObsSnapshotRow[];
  unsnapshotted: ObsUnsnapshottedDeployment[];
  unsnapshotted_truncated: boolean;
}

export const getSnapshotHealth = () =>
  request<ObsSnapshotHealthReport>('/v1/admin/obs/snapshot-health', { cache: 'no-store' });

const MB = 1024 * 1024;

/** Where a footprint sits against the §12 lines: at or under target, under warn, under page, or over page. */
export function footprintTone(bytes: number, r: Pick<ObsSnapshotHealthReport, 'target_mb' | 'warn_mb' | 'page_mb'>): 'success' | 'neutral' | 'warning' | 'danger' {
  const mb = bytes / MB;
  if (mb <= r.target_mb) return 'success';
  if (mb <= r.warn_mb) return 'neutral';
  if (mb <= r.page_mb) return 'warning';
  return 'danger';
}

/** Footprint in whole MB, the unit the target is set in. */
export const formatMB = (bytes: number) => `${Math.round(bytes / MB)} MB`;

/** "T2CL/icelake" → "T2CL · icelake"; "unpinned" stays. */
export const cpuLabel = (key: string) => (key.includes('/') ? key.split('/').filter(Boolean).join(' · ') || '—' : key);
