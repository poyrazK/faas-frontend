import type { HostingFile, HostingRelease, HostingReleaseReview, HostingReleaseSettings, HostingSite } from './hosting';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const settings = (release?: HostingRelease): HostingReleaseSettings => ({ spa_fallback: release?.manifest.spa_fallback ?? false, config: release?.manifest.config ?? null });
const equalFile = (a: HostingFile, b: HostingFile) => a.path === b.path && a.sha256 === b.sha256 && a.size === b.size && a.content_type === b.content_type;

// Snapshot the reviewed manifests and revision so polling cannot silently
// replace an operator's baseline. The server still enforces promotion CAS.
export function reviewHostingRelease(site: HostingSite, releases: HostingRelease[], target: string): HostingReleaseReview {
  const error = () => new Error('Release comparison unavailable. Refresh the active site and verified releases.');
  if (site.status !== 'active' || !Number.isSafeInteger(site.revision) || site.revision < 1 || releases.some((r) => r.site_id !== site.id) || new Set(releases.map((r) => r.id)).size !== releases.length) throw error();
  const before = releases.find((r) => r.id === site.active_release_id);
  const after = releases.find((r) => r.id === target);
  if (!after || after.state !== 'ready' || site.active_release_id && (!before || before.state !== 'ready')) throw error();
  const old = new Map(before?.manifest.files.map((f) => [f.path, f]) ?? []);
  const result: HostingReleaseReview = {
    provenance: after.provenance, site_id: site.id, expected_revision: site.revision, base_release_id: site.active_release_id, release_id: target,
    added: 0, changed: 0, removed: 0, before_bytes: before?.manifest.files.reduce((n,f) => n + f.size, 0) ?? 0,
    after_bytes: after.manifest.files.reduce((n,f) => n + f.size, 0), files: [], settings_changed: false,
    before_settings: settings(before), after_settings: settings(after),
  };
  for (const f of after.manifest.files) {
    const previous = old.get(f.path); old.delete(f.path);
    if (!previous) { result.added++; result.files.push({ path: f.path, change: 'added', before: null, after: f }); }
    else if (!equalFile(previous, f)) { result.changed++; result.files.push({ path: f.path, change: 'changed', before: previous, after: f }); }
  }
  for (const f of old.values()) { result.removed++; result.files.push({ path: f.path, change: 'removed', before: f, after: null }); }
  result.files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  result.settings_changed = canonical(result.before_settings) !== canonical(result.after_settings);
  return JSON.parse(JSON.stringify(result)) as HostingReleaseReview;
}

export function hostingReviewIsCurrent(review: HostingReleaseReview, site: HostingSite, releases: HostingRelease[]): boolean {
  return review.site_id === site.id && site.status === 'active' && review.expected_revision === site.revision &&
    review.base_release_id === site.active_release_id && releases.some((r) => r.id === review.release_id && r.site_id === site.id && r.state === 'ready');
}
