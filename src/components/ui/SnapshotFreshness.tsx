import type { AsyncState } from '@/lib/useAsync';

export function SnapshotFreshness({ snapshots }: { snapshots: Pick<AsyncState<unknown>, 'lastSuccessAt' | 'stale'>[] }) {
  const observed = snapshots.map((snapshot) => snapshot.lastSuccessAt).filter((time): time is number => time !== null);
  if (observed.length === 0) return null;
  const stale = snapshots.some((snapshot) => snapshot.stale);
  const oldest = Math.min(...observed);
  return (
    <div role={stale ? 'alert' : 'status'} className={`mb-4 text-xs ${stale ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-muted)]'}`}>
      {stale ? 'Some signals are stale. ' : ''}Last successful refresh: {new Date(oldest).toLocaleTimeString()}.
      {stale ? ' Refresh failed or is overdue; these values may no longer reflect the fleet.' : ''}
    </div>
  );
}
