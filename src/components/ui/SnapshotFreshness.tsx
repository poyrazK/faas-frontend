import type { AsyncState } from '@/lib/useAsync';

export function SnapshotFreshness({ snapshots }: { snapshots: Pick<AsyncState<unknown>, 'lastSuccessAt' | 'stale'>[] }) {
  const observed = snapshots.map((snapshot) => snapshot.lastSuccessAt).filter((time): time is number => time !== null);
  if (observed.length === 0) return null;
  const stale = snapshots.some((snapshot) => snapshot.stale);
  const oldest = Math.min(...observed);
  const time = new Date(oldest).toLocaleTimeString();
  return stale ? (
    <div role="alert" className="-mt-2 mb-4 text-xs text-[var(--color-warning-bold)]">
      Some signals are stale: last good refresh {time}. Refresh failed or is overdue; these values may no longer reflect the fleet.
    </div>
  ) : (
    <div role="status" className="-mt-2 mb-4 text-[11px] text-[var(--color-ink-faint)]">
      Updated {time}
    </div>
  );
}
