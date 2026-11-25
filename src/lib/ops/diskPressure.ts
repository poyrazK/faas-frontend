/* ==========================================================================
   Disk pressure (apid ADR-20261124150000).

     GET /v1/admin/obs/disk-pressure

   Every host filesystem's free space, inodes and growth, graded with the
   FaasHostDisk* alert thresholds; the jail tmpfs (its use is RAM until
   reboot); the systemd journal; and the fullest guest writable disks.
   ========================================================================== */

import { request } from '@/lib/api';

/** @go api.ObsDiskTotals */
export interface ObsDiskTotals {
  nodes: number;
  nodes_critical: number;
  nodes_filling: number;
  nodes_low: number;
  nodes_inodes_low: number;
  /** Nodes none of whose disks were read. */
  nodes_unknown: number;
  /** Disk filesystems; the jail tmpfs is not counted. */
  filesystems: number;
  jail_tmpfs_used_bytes: number;
  guests_near_full: number;
  guests_full: number;
}

/** @go api.ObsDiskNode */
export interface ObsDiskNode {
  node: string;
  /** compute, database or control_plane. */
  role: string;
  /** critical, filling, low, inodes_low, unknown (no disk read) or ok. */
  state: string;
  filesystems: number;
  worst_mountpoint?: string;
  worst_free_percent: number;
  jail_tmpfs_used_bytes: number;
  journal_bytes?: number;
  guests_near_full: number;
  guests_full: number;
}

/** @go api.ObsDiskFilesystem */
export interface ObsDiskFilesystem {
  node: string;
  role: string;
  mountpoint: string;
  device: string;
  fstype: string;
  size_bytes: number;
  /** Absent when free space was not read (state unknown). */
  avail_bytes?: number;
  free_percent?: number;
  inodes_free_percent?: number;
  hours_to_full?: number;
  jail_tmpfs?: boolean;
  /** critical, filling, low, inodes_low, ok, unknown, or ram (the jail tmpfs, not graded). */
  state: string;
}

/** @go api.ObsDiskGuest */
export interface ObsDiskGuest {
  instance_id: string;
  app_id?: string;
  app_slug?: string;
  account_id?: string;
  node?: string;
  used_bytes: number;
  capacity_bytes: number;
  used_percent: number;
}

/** @go api.ObsDiskPressureReport */
export interface ObsDiskPressureReport {
  as_of: string;
  /** observed, partial, unavailable or not_configured. */
  source: string;
  failed_queries: string[];
  critical_free_percent: number;
  low_free_percent: number;
  filling_free_percent: number;
  filling_horizon_hours: number;
  inodes_low_free_percent: number;
  growth_window_seconds: number;
  truncated: boolean;
  totals: ObsDiskTotals;
  nodes: ObsDiskNode[];
  filesystems: ObsDiskFilesystem[];
  guests: ObsDiskGuest[];
}

export const getDiskPressure = () => request<ObsDiskPressureReport>('/v1/admin/obs/disk-pressure', { cache: 'no-store' });

/** Badge tone for a filesystem or node state. */
export function diskStateTone(state: string): 'danger' | 'warning' | 'success' | 'neutral' {
  switch (state) {
    case 'critical':
    case 'filling':
      return 'danger';
    case 'low':
    case 'inodes_low':
      return 'warning';
    case 'unknown':
      return 'warning';
    case 'ok':
      return 'success';
    default:
      return 'neutral';
  }
}

const STATE_LABELS: Record<string, string> = {
  critical: 'Critical',
  filling: 'Filling fast',
  low: 'Low',
  inodes_low: 'Inodes low',
  unknown: 'No disk data',
  ram: 'RAM',
  ok: 'OK',
};

export const diskStateLabel = (state: string) => STATE_LABELS[state] ?? state;

const ROLE_LABELS: Record<string, string> = { compute: 'Compute', database: 'Database', control_plane: 'Control plane' };

export const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;

/** Hours to full as "45 min", "3.5 h" or "2.1 d". */
export function formatHoursToFull(hours: number | null | undefined): string {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Number(hours.toFixed(1))} h`;
  return `${Number((hours / 24).toFixed(1))} d`;
}
