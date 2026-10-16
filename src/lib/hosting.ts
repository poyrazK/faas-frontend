import { request } from './api';

// Contract: faas/pkg/api/hosting.go. All routes independently enforce the
// backend feature flag, operator allowlist, MFA, scopes, and account ownership.
export interface HostingCapabilities {
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
  id: string;
  site_id: string;
  state: 'pending' | 'ready' | 'retiring';
  manifest: HostingManifest;
  created_at: string;
  retired_at?: string;
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
export const createHostingRelease = (id: string, manifest: HostingManifest, signal?: AbortSignal) => mutate<HostingRelease>(`${sitePath(id)}/releases`, 'POST', manifest, signal);
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
