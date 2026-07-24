import { Plan } from './api';

export function relativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 0) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function euros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

export interface PlanInfo {
  label: string;
  price: string;
  ramMb: number;
  concurrency: number;
  apps: number;
  gbHours: number;
}

/** Plan quotas, sourced from faas/pkg/api/limits.go (kept in sync via CLAUDE.md §hard-limits). */
export const PLANS: Record<Plan, PlanInfo> = {
  free: { label: 'Free', price: '€0', ramMb: 128, concurrency: 1, apps: 1, gbHours: 5 },
  hobby: { label: 'Hobby', price: '€9', ramMb: 256, concurrency: 2, apps: 5, gbHours: 50 },
  pro: { label: 'Pro', price: '€29', ramMb: 512, concurrency: 5, apps: 25, gbHours: 250 },
  scale: { label: 'Scale', price: '€99', ramMb: 1024, concurrency: 20, apps: 100, gbHours: 1500 },
};

/** Maps a raw instance/app state string to a badge variant + label. */
export function stateBadge(state: string): { cls: string; label: string; live: boolean } {
  const s = (state || '').toLowerCase();
  if (s.includes('run')) return { cls: 'badge-brand', label: 'Running', live: true };
  if (s.includes('wak') || s.includes('boot')) return { cls: 'badge-warn', label: 'Waking', live: true };
  if (s.includes('park')) return { cls: 'badge-muted', label: 'Parked', live: false };
  if (s.includes('fail') || s.includes('error')) return { cls: 'badge-danger', label: state, live: false };
  if (s.includes('active') || s.includes('deploy')) return { cls: 'badge-brand', label: state, live: false };
  return { cls: 'badge-muted', label: state || 'Unknown', live: false };
}
