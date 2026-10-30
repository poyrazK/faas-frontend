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

/** Maps a raw instance/app state string to a badge variant + label + live indicator. */
export function stateBadge(
  state: string,
  hasLiveInstance = false,
  isDeployed = true,
): { cls: string; label: string; live: boolean; mode?: 'running' | 'sleeping' | 'waking' | 'failed' | 'undeployed' } {
  const s = (state || '').toLowerCase();
  if (!isDeployed && !s.includes('fail') && !s.includes('error')) {
    return { cls: 'badge-muted', label: 'Undeployed', live: false, mode: 'undeployed' };
  }
  if (s.includes('run') || (s.includes('active') && hasLiveInstance)) {
    return { cls: 'badge-brand', label: 'Running', live: true, mode: 'running' };
  }
  if (s.includes('wak') || s.includes('boot')) {
    return { cls: 'badge-warn', label: 'Waking (<350ms)', live: true, mode: 'waking' };
  }
  if (s.includes('fail') || s.includes('error')) {
    return { cls: 'badge-danger', label: state, live: false, mode: 'failed' };
  }
  if (s.includes('park') || s.includes('sleep') || s.includes('idle') || s.includes('active')) {
    return { cls: 'badge-muted', label: 'Sleeping (0 MB RAM)', live: false, mode: 'sleeping' };
  }
  return { cls: 'badge-muted', label: state || 'Unknown', live: false, mode: 'sleeping' };
}
