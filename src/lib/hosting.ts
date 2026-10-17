import { request } from './api';

// Contract: faas/pkg/api/hosting.go. All routes independently enforce the
// backend feature flag, operator allowlist, MFA, scopes, and account ownership.
export interface HostingCapabilities {
 preview_reservations_enabled?: boolean;
 activity_enabled?: boolean;
 activity_page_size?: number;
 ci_setup_enabled?: boolean;
 diagnostics_enabled?: boolean;
 oidc_enabled?: boolean;
 retention_enabled?: boolean;
 retention_age_default_seconds?: number;
 retention_age_min_seconds?: number;
 retention_age_max_seconds?: number;
  previews_enabled?: boolean;
  previews_per_site?: number;
  preview_ttl_default_seconds?: number;
  preview_ttl_min_seconds?: number;
  preview_ttl_max_seconds?: number;
  history_enabled?: boolean;
  history_per_site?: number;
  history_page_size?: number;
  provenance_repository_max_bytes?: number;
  provenance_branch_max_bytes?: number;
  provenance_description_max_bytes?: number;
  staged_releases_supported?: boolean;
  config_enabled?: boolean;
  config_max_bytes?: number;
  config_redirects_max?: number;
  config_header_rules_max?: number;
  config_headers_per_rule_max?: number;
  config_header_value_max_bytes?: number;
  analytics_enabled?: boolean;
  account_storage_max_bytes?: number;
  account_pending_uploads_max?: number;
  domains_enabled?: boolean;
  domains_per_site?: number;
  domain_hostname_max_bytes?: number;
  domain_cname_target?: string;
  upload_base_url: string;
  files_max: number;
  file_max_bytes: number;
  release_max_bytes: number;
  manifest_max_bytes: number;
  path_max_bytes: number;
  content_type_max_bytes: number;
  name_max_bytes: number;
  sites_per_account: number;
  releases_per_site: number;
  upload_ttl_seconds: number;
  storage_timeout_seconds: number;
  finalize_timeout_seconds: number;
}

export interface HostingSite {
  id: string;
  account_id: string;
  project_id: string;
  environment: string;
  name: string;
  hostname: string;
  status: 'active' | 'deleting';
  active_release_id: string;
  revision: number;
  durable_routing: boolean;
  suspended: boolean;
  created_at: string;
}

export interface HostingFile {
  path: string;
  sha256: string;
  size: number;
  content_type: string;
}

export interface HostingReleaseConfig {
  version: 1;
  redirects?: { from: string; to: string; status: 301 | 302 | 307 | 308 }[];
  headers?: { path: string; values: Record<string, string> }[];
  not_found?: string;
}
export interface HostingManifest { files: HostingFile[]; spa_fallback: boolean; config?: HostingReleaseConfig }

export interface HostingRelease {
  provenance?: HostingReleaseProvenance;
  id: string;
  site_id: string;
  state: 'pending' | 'ready' | 'retiring';
  manifest: HostingManifest;
  created_at: string;
  retired_at?: string;
  first_promoted_at?: string;
}

export interface HostingSiteStatus {
  site: HostingSite;
  publication: {
    state: 'pending' | 'published' | 'untracked';
    generation?: number;
    published_generation?: number;
    published_at?: string;
    pending_since?: string;
    next_attempt_at?: string;
    last_attempt_at?: string;
    retry_count: number;
    last_error_code?: string;
  };
}

export interface HostingUpload { path: string; url: string; headers: Record<string, string[]> }
export interface HostingUploadResponse { release: HostingRelease; uploads: HostingUpload[] }
export interface HostingProject { id: string; slug: string }
export interface HostingEnvironment { id: string; project_id: string; slug: string }

export interface HostingDNSRecord { type: 'TXT' | 'CNAME'; name: string; value: string }
export interface HostingDomain {
  id: string; site_id: string; hostname: string; challenge: string;
  state: 'pending_dns' | 'pending_certificate' | 'active' | 'deleting';
  revision: number; generation: number; published_generation: number; published_at?: string;
  details: { provider_id?: string; create_started_at?: string; tls_status: 'pending' | 'active' | 'failed'; records: HostingDNSRecord[]; verified_at?: string };
  next_attempt_at: string; attempts: number; last_error_code?: string; created_at: string;
}

const root = '/v1/internal/hosting';
const sitePath = (id: string) => `${root}/sites/${encodeURIComponent(id)}`;
const releasePath = (id: string, release: string) => `${sitePath(id)}/releases/${encodeURIComponent(release)}`;
// A stalled control-plane connection must become an explicit refresh failure.
// This browser transport budget is separate from provider/publication limits.
const deadline = (signal?: AbortSignal, timeout = 30000) => signal
  ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
const read = <T>(path: string, signal?: AbortSignal) => request<T>(path, { cache: 'no-store', signal: deadline(signal) });

function mutate<T>(path: string, method: string, body?: unknown, signal?: AbortSignal, timeout?: number): Promise<T> {
  // Each user intent has a distinct key. No automatic retries of ambiguous
  // creation/promotion failures: refresh the inventory before another intent.
  return request<T>(path, {
    method, signal: deadline(signal, timeout), cache: 'no-store',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export const getHostingCapabilities = (signal?: AbortSignal) => read<HostingCapabilities>(`${root}/capabilities`, signal);
export const listHostingSites = (signal?: AbortSignal) => read<HostingSite[] | null>(`${root}/sites`, signal).then((sites) => sites ?? []);
export const listHostingProjects = (signal?: AbortSignal) => read<HostingProject[]>('/v1/projects', signal);
export const listHostingEnvironments = (project: string, signal?: AbortSignal) => read<HostingEnvironment[]>(`/v1/projects/${encodeURIComponent(project)}/environments`, signal);
export const getHostingStatus = (id: string, signal?: AbortSignal) => read<HostingSiteStatus>(`${sitePath(id)}/status`, signal);
export const listHostingReleases = (id: string, signal?: AbortSignal) => read<HostingRelease[] | null>(`${sitePath(id)}/releases`, signal).then((releases) => releases ?? []);
export const createHostingSite = (project: string, environment: string, name: string, signal?: AbortSignal) => mutate<HostingSite>(`${root}/sites`, 'POST', { project, environment, name }, signal);
export const createHostingRelease = (id: string, manifest: HostingManifest, signal?: AbortSignal, provenance?: HostingReleaseProvenance) => mutate<HostingRelease>(`${sitePath(id)}/releases`, 'POST', { ...manifest, ...(provenance ? { provenance } : {}) }, signal);
export const getHostingUploads = (id: string, release: string, signal?: AbortSignal) => mutate<HostingUploadResponse>(`${releasePath(id, release)}/uploads`, 'POST', undefined, signal);
export const finalizeHostingRelease = (id: string, release: string, limits: HostingCapabilities, signal?: AbortSignal) => mutate<HostingRelease>(`${releasePath(id, release)}/finalize`, 'POST', undefined, signal, (limits.finalize_timeout_seconds + limits.storage_timeout_seconds) * 1000);
export const promoteHostingRelease = (id: string, release: string, revision: number, signal?: AbortSignal) => mutate<HostingSite>(`${sitePath(id)}/promotions`, 'POST', { release_id: release, expected_revision: revision }, signal);
export const suspendHostingSite = (id: string, suspended: boolean, revision: number) => mutate<HostingSite>(`${sitePath(id)}/suspension`, 'PUT', { suspended, expected_revision: revision });
export const retireHostingRelease = (id: string, release: string) => mutate<HostingRelease>(releasePath(id, release), 'DELETE');
export const deleteHostingSite = (id: string) => mutate<HostingSite>(sitePath(id), 'DELETE');
export const listHostingDomains = (id: string, signal?: AbortSignal) => read<HostingDomain[]>(`${sitePath(id)}/domains`, signal);
export const createHostingDomain = (id: string, hostname: string) => mutate<HostingDomain>(`${sitePath(id)}/domains`, 'POST', { hostname });
export const deleteHostingDomain = (id: string, domain: string, revision: number) => mutate<HostingDomain>(`${sitePath(id)}/domains/${encodeURIComponent(domain)}`, 'DELETE', { expected_revision: revision });

export function hostingSiteURL(hostname: string): string | null {
  // Only render an external HTTPS link, including when API data is malformed.
  if (!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname)) return null;
  return `https://${hostname}`;
}

export const recoverHostingDomain = (id: string, domain: string, revision: number, hostname: string, providerID: string) => mutate<HostingDomain>(`${sitePath(id)}/domains/${encodeURIComponent(domain)}/recover`, 'POST', { expected_revision: revision, expected_hostname: hostname, provider_id: providerID });

export interface HostingUsage {
  account_id: string; reserved_bytes: number; storage_limit_bytes: number;
  payload_bytes: number; ready_payload_bytes: number; retiring_reserved_bytes: number;
  pending_uploads: number; pending_uploads_limit: number; releases: number; observed_at: string;
}
export const getHostingUsage = (signal?: AbortSignal) => read<HostingUsage>(`${root}/usage`, signal);

export interface HostingTrafficCounters {
  requests: number; payload_bytes: number; cache_hits: number; cache_misses: number;
  client_errors: number; server_errors: number;
}
export interface HostingTraffic extends HostingTrafficCounters {
  site_id: string; source: string; approximate: boolean;
  period_start: string; period_end: string; observed_at: string; max_sample_interval: number;
  buckets: (HostingTrafficCounters & { start: string })[];
  failures: { start: string; status: number; code: string; requests: number }[];
}
export const getHostingTraffic = (id: string, signal?: AbortSignal) => read<HostingTraffic>(`${sitePath(id)}/traffic`, signal);


export interface HostingReleaseSettings { spa_fallback: boolean; config: HostingReleaseConfig | null }
export interface HostingReleaseReview {
  provenance?: HostingReleaseProvenance;
  site_id: string; expected_revision: number; base_release_id: string; release_id: string;
  added: number; changed: number; removed: number; before_bytes: number; after_bytes: number;
  files: { path: string; change: 'added' | 'changed' | 'removed'; before: HostingFile | null; after: HostingFile | null }[];
  settings_changed: boolean; before_settings: HostingReleaseSettings; after_settings: HostingReleaseSettings;
}
export interface HostingStageResult { state: 'staged'; release: HostingRelease; expected_revision: number }

export interface HostingPreview {
 id: string; site_id: string; release_id: string; hostname: string;
 expires_at: string; revoked: boolean; generation: number; published_generation: number;
 published_at?: string; next_attempt_at: string; last_error_code?: string; created_at: string;
}
export const listHostingPreviews = (site: string, signal?: AbortSignal) => read<HostingPreview[]>(`${sitePath(site)}/previews`, signal);
export const createHostingPreview = (site: string, release: string, ttlSeconds: number) => mutate<HostingPreview>(`${sitePath(site)}/previews`, 'POST', { release_id: release, ttl_seconds: ttlSeconds });
export const revokeHostingPreview = (site: string, id: string, generation: number) => mutate<HostingPreview>(`${sitePath(site)}/previews/${encodeURIComponent(id)}`, 'DELETE', { expected_generation: generation });

export interface HostingReleaseProvenance { repository?: string; commit_sha?: string; branch?: string; description?: string }
export interface HostingPromotionEvent {
 site_id: string; revision: number; previous_revision: number; release_id: string; previous_release_id?: string;
 actor: { account_id: string; key_id?: string }; accepted_at: string; provenance?: HostingReleaseProvenance;
}
export interface HostingHistoryPage { events: HostingPromotionEvent[]; next_before_revision?: number; retention_limit: number }
export const listHostingHistory = (id: string, before = 0, signal?: AbortSignal) => read<HostingHistoryPage>(`${sitePath(id)}/history${before ? `?before_revision=${encodeURIComponent(before)}` : ''}`, signal);

export interface HostingRetentionRules { pending_age_seconds: number; staged_age_seconds: number }
export interface HostingRetentionPolicy extends HostingRetentionRules { site_id: string; revision: number; enabled: boolean; updated_at?: string }
export interface HostingCleanupPlan {
 policy: HostingRetentionPolicy; rules: HostingRetentionRules; proposed: boolean; evaluated_at: string;
 entries: { release_id: string; state: string; eligible: boolean; reason: string; reserved_bytes: number; eligible_at?: string }[];
 reclaimable_reserved_bytes: number; retiring_reserved_bytes: number;
}
export function getHostingCleanupPlan(id: string, rules?: HostingRetentionRules, signal?: AbortSignal) {
 const query = rules ? '?' + new URLSearchParams({ pending_age_seconds: String(rules.pending_age_seconds), staged_age_seconds: String(rules.staged_age_seconds) }) : '';
 return read<HostingCleanupPlan>(`${sitePath(id)}/cleanup${query}`, signal);
}
export function setHostingRetentionPolicy(id: string, policy: HostingRetentionRules & { enabled: boolean; expected_revision: number }, signal?: AbortSignal) {
 return request<HostingRetentionPolicy>(`${sitePath(id)}/retention`, {method: 'PUT', cache: 'no-store', signal: deadline(signal), body: JSON.stringify(policy)});
}

export interface HostingOIDCTrustRules {
 repository_owner_id: string; repository_id: string; repository: string;
 ref: string; workflow_ref: string; event_name: 'push' | 'workflow_dispatch' | 'schedule'; environment?: string;
}
export interface HostingOIDCTrust extends HostingOIDCTrustRules { id: string; site_id: string; account_id: string; created_at: string }
export function listHostingOIDCTrusts(site: string, signal?: AbortSignal) {
 return request<HostingOIDCTrust[]>(`${sitePath(site)}/oidc-trusts`, {cache: 'no-store', signal: deadline(signal)});
}
export function createHostingOIDCTrust(site: string, rules: HostingOIDCTrustRules, signal?: AbortSignal) {
 return request<HostingOIDCTrust>(`${sitePath(site)}/oidc-trusts`, {method: 'POST', cache: 'no-store', signal: deadline(signal), body: JSON.stringify(rules)});
}
export function revokeHostingOIDCTrust(site: string, trust: string, signal?: AbortSignal) {
 return request<void>(`${sitePath(site)}/oidc-trusts/${encodeURIComponent(trust)}`, {method: 'DELETE', cache: 'no-store', signal: deadline(signal)});
}

export interface HostingDiagnosticCheck {
 step: string; state: 'ok' | 'pending' | 'blocked' | 'unknown' | 'not_checked'; code: string;
 summary: string; action: string; generation?: number; published_generation?: number; next_attempt_at?: string;
}
export interface HostingDiagnostics {
 site_id: string; run_id?: string; release_id?: string; preview_id?: string; manifest_fingerprint?: string;
 started_at: string; observed_at: string; serving_health: 'not_checked'; retry_advice: 'none' | 'retry_same_run' | 'inspect_before_retry'; checks: HostingDiagnosticCheck[];
}
export function getHostingDiagnostics(site: string, run = '', signal?: AbortSignal) {
 return request<HostingDiagnostics>(`${sitePath(site)}/diagnostics${run ? '?run_id=' + encodeURIComponent(run) : ''}`, {cache: 'no-store', signal: deadline(signal)});
}

export interface HostingCISetupConfig {
 reserve_preview?: boolean;
 api_base: string; action_commit: string; checkout_commit: string; prepare_action: string;
 cli_path: string; cli_sha256: string; output_path: string; spa_fallback: boolean;
 preview_ttl_seconds: number; wait_timeout_seconds: number; cron?: string; default_branch?: string;
}
export interface HostingCISetup {
 site_id: string; trust_id: string; repository: string; workflow_path: string;
 configuration_valid: boolean; workflow_yaml?: string; observed_at: string;
 checks: {code: string; state: 'pass' | 'blocked' | 'manual'; message: string}[]; recovery: string[];
}
export function prepareHostingCISetup(site: string, trust: string, config: HostingCISetupConfig, signal?: AbortSignal) {
 return request<HostingCISetup>(`${sitePath(site)}/ci-setup`, {method: 'POST', cache: 'no-store', signal: deadline(signal), body: JSON.stringify({trust_id: trust, config})});
}

export interface HostingActivityEntry {
 run_id: string; release_id: string; preview_id: string; created_at: string; preview_expires_at: string;
 state: 'recorded' | 'pending' | 'blocked' | 'unknown'; provenance?: HostingReleaseProvenance; checks: HostingDiagnosticCheck[];
}
export interface HostingActivityPage {
 site_id: string; entries: HostingActivityEntry[]; next_cursor?: string; observed_at: string;
 serving_health: 'not_checked'; source_labels_included: boolean;
}
export function listHostingActivity(site: string, before = '', signal?: AbortSignal) {
 return request<HostingActivityPage>(`${sitePath(site)}/runs${before ? '?before=' + encodeURIComponent(before) : ''}`, {cache: 'no-store', signal: deadline(signal)});
}

export interface HostingPreviewCapacity {
 site_id: string; limit: number; previews: number; reservations: number; available: number; observed_at: string;
}
export const getHostingPreviewCapacity = (site: string, signal?: AbortSignal) => read<HostingPreviewCapacity>(`${sitePath(site)}/preview-capacity`, signal);
export function hostingCapacityMatches(data: HostingPreviewCapacity, site: string): boolean {
 return data.site_id === site && Number.isSafeInteger(data.limit) && data.limit > 0 &&
 [data.previews, data.reservations, data.available].every(value => Number.isSafeInteger(value) && value >= 0) &&
 data.previews + data.reservations + data.available === data.limit && Number.isFinite(Date.parse(data.observed_at));
}
