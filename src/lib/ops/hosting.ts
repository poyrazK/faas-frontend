/* ==========================================================================
   Internal static hosting: the operator's sites and the credentials that
   deploy them (apid /v1/internal/hosting/*).

     - Sites are scoped to the signed-in operator account; apid never lists
       another tenant's sites here.
     - Automation credentials are bearer tokens (fp_host_…) a CI job uses to
       stage releases and previews. GitHub OIDC trusts let one exact
       repository, branch, workflow and event exchange its GitHub identity
       for a short-lived credential, so no token is stored in GitHub at all.
     - Creating or revoking either needs MFA, an operator account, a step-up
       under five minutes old and a same-origin session: API keys are
       refused, so this console is where they are managed.

   These writes take no Idempotency-Key: the token is returned once and is
   never kept in a replay receipt. A create that timed out may still have
   issued a credential, so the page reloads the list rather than retrying.

   The rest is read-only: publication status, releases, promotion history,
   CI activity, diagnostics, custom domains and previews, sampled traffic,
   storage usage and the retention cleanup plan. apid states plainly what it
   did not check (serving health, DNS, TLS), and so does the console.
   ========================================================================== */

import { ApiError, request, writeHeaders, type OperatorWrite } from '@/lib/api';

/** @go api.HostingSite */
export interface HostingSite {
  id: string;
  project_id: string;
  environment: string;
  name: string;
  hostname: string;
  status: string;
  active_release_id: string;
  /** Bumped by every promotion and suspension; writes send the one the operator saw. */
  revision: number;
  durable_routing: boolean;
  suspended: boolean;
  created_at: string;
}

/** @go api.HostingAutomationCredential */
export interface HostingAutomationCredential {
  id: string;
  site_id: string;
  label: string;
  operations: string[];
  created_at: string;
  expires_at: string;
}

/** @go api.HostingAutomationCredentialResponse */
export interface HostingAutomationCredentialResponse {
  credential: HostingAutomationCredential;
  /** Shown once. apid stores only its hash. */
  token: string;
}

/** @go api.HostingOIDCTrustRules */
export interface HostingOIDCTrustRules {
  repository_owner_id: string;
  repository_id: string;
  repository: string;
  ref: string;
  workflow_ref: string;
  event_name: string;
  environment?: string;
}

/** @go api.HostingOIDCTrust */
export interface HostingOIDCTrust extends HostingOIDCTrustRules {
  id: string;
  site_id: string;
  created_at: string;
}

export const listHostingSites = () => request<HostingSite[]>('/v1/internal/hosting/sites', { cache: 'no-store' });

export const getHostingSite = (site: string) =>
  request<HostingSite>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}`, { cache: 'no-store' });

export const listAutomationCredentials = (site: string) =>
  request<HostingAutomationCredential[]>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/automation-credentials`, {
    cache: 'no-store',
  });

/** @goBody api.CreateHostingAutomationCredentialRequest */
export const createAutomationCredential = (
  site: string,
  input: { label: string; operations: HostingOperation[]; ttlSeconds: number },
) =>
  request<HostingAutomationCredentialResponse>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/automation-credentials`, {
    method: 'POST',
    body: JSON.stringify({ label: input.label, operations: input.operations, ttl_seconds: input.ttlSeconds }),
  });

export const revokeAutomationCredential = (site: string, credential: string) =>
  request<void>(
    `/v1/internal/hosting/sites/${encodeURIComponent(site)}/automation-credentials/${encodeURIComponent(credential)}`,
    { method: 'DELETE' },
    'none',
  );

export const listOIDCTrusts = (site: string) =>
  request<HostingOIDCTrust[]>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/oidc-trusts`, { cache: 'no-store' });

/** @goBody api.HostingOIDCTrustRules */
export const createOIDCTrust = (site: string, rules: HostingOIDCTrustRules) =>
  request<HostingOIDCTrust>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/oidc-trusts`, {
    method: 'POST',
    body: JSON.stringify({
      repository_owner_id: rules.repository_owner_id,
      repository_id: rules.repository_id,
      repository: rules.repository,
      ref: rules.ref,
      workflow_ref: rules.workflow_ref,
      event_name: rules.event_name,
      environment: rules.environment || undefined,
    }),
  });

/** Revoking a trust also removes every credential issued through it. */
export const revokeOIDCTrust = (site: string, trust: string) =>
  request<void>(
    `/v1/internal/hosting/sites/${encodeURIComponent(site)}/oidc-trusts/${encodeURIComponent(trust)}`,
    { method: 'DELETE' },
    'none',
  );

/* ──────────────────────────────── Read models ─────────────────────────── */

/** @go api.HostingPublicationStatus */
export interface HostingPublicationStatus {
  /** published, pending, or untracked (a site without durable routing). */
  state: string;
  generation?: number;
  published_generation?: number;
  published_at?: string;
  pending_since?: string;
  next_attempt_at?: string;
  retry_count: number;
  last_error_code?: string;
}

/** @go api.HostingSiteStatus */
export interface HostingSiteStatus {
  site: HostingSite;
  publication: HostingPublicationStatus;
}

/** Caller-provided labels, not a verified attestation. @go api.HostingReleaseProvenance */
export interface HostingReleaseProvenance {
  repository?: string;
  commit_sha?: string;
  branch?: string;
  description?: string;
}

/** @go api.HostingManifest */
export interface HostingManifestSummary {
  files: unknown[];
  spa_fallback: boolean;
}

/** @go api.HostingRelease */
export interface HostingRelease {
  id: string;
  site_id: string;
  /** pending (uploading), ready, retiring or deleted. */
  state: string;
  manifest: HostingManifestSummary;
  artifact_bytes: number;
  created_at: string;
  last_activity_at: string;
  first_promoted_at?: string;
  retired_at?: string;
  provenance?: HostingReleaseProvenance;
}

/** @go api.HostingPromotionActor */
export interface HostingPromotionActor {
  account_id: string;
  key_id?: string;
}

/** @go api.HostingPromotionEvent */
export interface HostingPromotionEvent {
  site_id: string;
  revision: number;
  previous_revision: number;
  release_id: string;
  previous_release_id?: string;
  actor: HostingPromotionActor;
  accepted_at: string;
  provenance?: HostingReleaseProvenance;
}

/** @go api.HostingHistoryPage */
export interface HostingHistoryPage {
  events: HostingPromotionEvent[];
  next_before_revision?: number;
  retention_limit: number;
}

/** @go api.HostingDiagnosticCheck */
export interface HostingDiagnosticCheck {
  /** site, run, release, preview, publication, observation or serving. */
  step: string;
  /** ok, pending, blocked, unknown or not_checked. */
  state: string;
  code: string;
  summary: string;
  action: string;
  next_attempt_at?: string;
}

/** @go api.HostingDiagnostics */
export interface HostingDiagnostics {
  site_id: string;
  run_id?: string;
  release_id?: string;
  preview_id?: string;
  observed_at: string;
  serving_health: string;
  /** none, retry_same_run or inspect_before_retry. */
  retry_advice: string;
  checks: HostingDiagnosticCheck[];
}

/** One CI run: stored intent and observations, not GitHub job health. @go api.HostingActivityEntry */
export interface HostingActivityEntry {
  run_id: string;
  release_id: string;
  preview_id: string;
  created_at: string;
  preview_expires_at: string;
  canceled?: boolean;
  /** apid's verdict: never a run whose release is or was live, or one another preview uses. */
  can_cancel?: boolean;
  /** recorded, canceled, or the worst check state. */
  state: string;
  provenance?: HostingReleaseProvenance;
  checks: HostingDiagnosticCheck[];
}

/** @go api.HostingActivityPage */
export interface HostingActivityPage {
  site_id: string;
  entries: HostingActivityEntry[];
  next_cursor?: string;
  observed_at: string;
  serving_health: string;
  source_labels_included: boolean;
}

/** @go api.HostingDNSRecord */
export interface HostingDNSRecord {
  type: string;
  name: string;
  value: string;
}

/** @go api.HostingDomainDetails */
export interface HostingDomainDetails {
  tls_status: string;
  records: HostingDNSRecord[];
  verified_at?: string;
  /** The Cloudflare custom hostname this domain owns; empty until bound. */
  provider_id?: string;
  create_started_at?: string;
}

/** @go api.HostingDomain */
export interface HostingDomain {
  id: string;
  hostname: string;
  state: string;
  revision: number;
  details: HostingDomainDetails;
  attempts: number;
  next_attempt_at: string;
  last_error_code?: string;
  published_at?: string;
  created_at: string;
}

/** @go api.HostingPreview */
export interface HostingPreview {
  id: string;
  release_id: string;
  hostname: string;
  expires_at: string;
  revoked: boolean;
  generation: number;
  published_generation: number;
  last_error_code?: string;
  created_at: string;
}

export const getHostingSiteStatus = (site: string) =>
  request<HostingSiteStatus>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/status`, { cache: 'no-store' });

export const listHostingReleases = (site: string) =>
  request<HostingRelease[]>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/releases`, { cache: 'no-store' });

export const getHostingHistory = (site: string, beforeRevision?: number) => {
  const query = beforeRevision ? `before_revision=${beforeRevision}` : '';
  return request<HostingHistoryPage>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/history${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
};

export const getHostingActivity = (site: string, before?: string) => {
  const query = before ? `before=${encodeURIComponent(before)}` : '';
  return request<HostingActivityPage>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/runs${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
};

/** The site's production path, or one CI run's path when `runId` is given. */
export const getHostingDiagnostics = (site: string, runId?: string) => {
  const query = runId ? `run_id=${encodeURIComponent(runId)}` : '';
  return request<HostingDiagnostics>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/diagnostics${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
};

export const listHostingDomains = (site: string) =>
  request<HostingDomain[]>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/domains`, { cache: 'no-store' });

export const listHostingPreviews = (site: string) =>
  request<HostingPreview[]>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/previews`, { cache: 'no-store' });

/* ─────────────────────── Traffic, usage and capacity ──────────────────── */

/** @go api.HostingTrafficCounters */
export interface HostingTrafficCounters {
  requests: number;
  payload_bytes: number;
  cache_hits: number;
  cache_misses: number;
  client_errors: number;
  server_errors: number;
}

/** One hour of traffic. @go api.HostingTrafficBucket */
export interface HostingTrafficBucket extends HostingTrafficCounters {
  start: string;
}

/** Failed requests in one hour, grouped by status and edge code. @go api.HostingTrafficFailure */
export interface HostingTrafficFailure {
  start: string;
  status: number;
  code: string;
  requests: number;
}

/**
 * The last 24 hours at the edge, from weighted Analytics Engine samples:
 * approximate, and not billing or health evidence. @go api.HostingTraffic
 */
export interface HostingTraffic extends HostingTrafficCounters {
  site_id: string;
  source: string;
  approximate: boolean;
  period_start: string;
  period_end: string;
  observed_at: string;
  /** The largest sampling weight behind these counts; 1 means every request was recorded. */
  max_sample_interval: number;
  buckets: HostingTrafficBucket[];
  failures: HostingTrafficFailure[];
}

/** Catalog accounting for the operator account, not a provider bill. @go api.HostingUsage */
export interface HostingUsage {
  account_id: string;
  /** Two stored copies of every release plus a maximum-size manifest each. */
  reserved_bytes: number;
  storage_limit_bytes: number;
  payload_bytes: number;
  ready_payload_bytes: number;
  retiring_reserved_bytes: number;
  pending_uploads: number;
  pending_uploads_limit: number;
  releases: number;
  observed_at: string;
}

/** Preview slots: stored admission capacity, not edge health. @go api.HostingPreviewCapacity */
export interface HostingPreviewCapacity {
  site_id: string;
  limit: number;
  previews: number;
  /** Slots CI runs have claimed for previews they have not published yet. */
  reservations: number;
  available: number;
  observed_at: string;
}

/** What this control plane has switched on, and its pilot limits. @go api.HostingCapabilities */
export interface HostingCapabilities {
  automation_enabled: boolean;
  automation_credentials_per_site: number;
  oidc_enabled: boolean;
  ci_setup_enabled: boolean;
  activity_enabled: boolean;
  ci_runs_per_site: number;
  cancellation_enabled: boolean;
  diagnostics_enabled: boolean;
  history_enabled: boolean;
  history_per_site: number;
  previews_enabled: boolean;
  previews_per_site: number;
  preview_reservations_enabled: boolean;
  domains_enabled: boolean;
  domains_per_site: number;
  domain_cname_target?: string;
  analytics_enabled: boolean;
  retention_enabled: boolean;
  retention_age_default_seconds: number;
  retention_age_min_seconds: number;
  retention_age_max_seconds: number;
  config_enabled: boolean;
  sites_per_account: number;
  releases_per_site: number;
  account_storage_max_bytes: number;
  account_pending_uploads_max: number;
}

export const getHostingTraffic = (site: string) =>
  request<HostingTraffic>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/traffic`, { cache: 'no-store' });

export const getHostingUsage = () => request<HostingUsage>('/v1/internal/hosting/usage', { cache: 'no-store' });

export const getHostingCapabilities = () => request<HostingCapabilities>('/v1/internal/hosting/capabilities', { cache: 'no-store' });

export const getHostingPreviewCapacity = (site: string) =>
  request<HostingPreviewCapacity>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/preview-capacity`, { cache: 'no-store' });

/* ──────────────────────────────── Retention ───────────────────────────── */

/** @go api.HostingRetentionRules */
export interface HostingRetentionRules {
  /** How long an unfinished upload is kept after its last activity. */
  pending_age_seconds: number;
  /** How long a CI release that was never put live is kept after its last activity (never inside its run's retry window). */
  staged_age_seconds: number;
}

/** A site without a stored policy reports revision 0, off, with the default ages. @go api.HostingRetentionPolicy */
export interface HostingRetentionPolicy extends HostingRetentionRules {
  site_id: string;
  revision: number;
  enabled: boolean;
  updated_at?: string;
}

/** @go api.HostingCleanupEntry */
export interface HostingCleanupEntry {
  release_id: string;
  state: string;
  eligible: boolean;
  reason: string;
  reserved_bytes: number;
  eligible_at?: string;
}

/** An observation of what retention would retire now, never an authorization. @go api.HostingCleanupPlan */
export interface HostingCleanupPlan {
  policy: HostingRetentionPolicy;
  /** The rules this plan was evaluated with: the policy's, or proposed ones. */
  rules: HostingRetentionRules;
  proposed: boolean;
  evaluated_at: string;
  entries: HostingCleanupEntry[];
  reclaimable_reserved_bytes: number;
  retiring_reserved_bytes: number;
}

/** The site's cleanup plan under its policy, or under `rules` to preview a change. */
export const getHostingCleanupPlan = (site: string, rules?: HostingRetentionRules) => {
  const query = rules ? `pending_age_seconds=${rules.pending_age_seconds}&staged_age_seconds=${rules.staged_age_seconds}` : '';
  return request<HostingCleanupPlan>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/cleanup${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
};

/* ─────────────────────────────────── Actions ──────────────────────────── */
/*
 * Operator writes on a site. Promotion, suspension, retention, domain
 * removal and recovery, and preview revocation are revision- or
 * generation-fenced: they send what the operator saw and apid answers 409
 * when the site moved on. All but retention also replay an Idempotency-Key;
 * retention, retire and cancel take none. apid asks for an MFA session
 * (cancel and retention: an operator session) but no fresh step-up, so the
 * confirm dialog is the console's guard.
 */

/** @goBody api.PromoteHostingReleaseRequest */
export const promoteHostingRelease = (site: string, releaseId: string, expectedRevision: number, opts?: OperatorWrite) =>
  request<HostingSite>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/promotions`, {
    method: 'POST',
    headers: writeHeaders(opts),
    body: JSON.stringify({ release_id: releaseId, expected_revision: expectedRevision }),
  });

/** apid refuses the live release and releases a preview still uses (409). */
export const retireHostingRelease = (site: string, releaseId: string) =>
  request<void>(
    `/v1/internal/hosting/sites/${encodeURIComponent(site)}/releases/${encodeURIComponent(releaseId)}`,
    { method: 'DELETE' },
    'none',
  );

/** @goBody - hosting.Service.SetSuspended decodes a handler-local struct {suspended, expected_revision} */
export const setHostingSiteSuspended = (site: string, suspended: boolean, expectedRevision: number, opts?: OperatorWrite) =>
  request<HostingSite>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/suspension`, {
    method: 'PUT',
    headers: writeHeaders(opts),
    body: JSON.stringify({ suspended, expected_revision: expectedRevision }),
  });

export const cancelHostingRun = (site: string, runId: string) =>
  request<void>(
    `/v1/internal/hosting/sites/${encodeURIComponent(site)}/ci/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST' },
    'none',
  );

/** @goBody api.RevokeHostingPreviewRequest */
export const revokeHostingPreview = (site: string, previewId: string, expectedGeneration: number, opts?: OperatorWrite) =>
  request<void>(
    `/v1/internal/hosting/sites/${encodeURIComponent(site)}/previews/${encodeURIComponent(previewId)}`,
    { method: 'DELETE', headers: writeHeaders(opts), body: JSON.stringify({ expected_generation: expectedGeneration }) },
    'none',
  );

/** @goBody api.DeleteHostingDomainRequest */
export const removeHostingDomain = (site: string, domainId: string, expectedRevision: number, opts?: OperatorWrite) =>
  request<void>(
    `/v1/internal/hosting/sites/${encodeURIComponent(site)}/domains/${encodeURIComponent(domainId)}`,
    { method: 'DELETE', headers: writeHeaders(opts), body: JSON.stringify({ expected_revision: expectedRevision }) },
    'none',
  );

/** @goBody api.RecoverHostingDomainRequest */
export const recoverHostingDomain = (
  site: string,
  domain: Pick<HostingDomain, 'id' | 'hostname' | 'revision'>,
  providerId: string,
  opts?: OperatorWrite,
) =>
  request<void>(
    `/v1/internal/hosting/sites/${encodeURIComponent(site)}/domains/${encodeURIComponent(domain.id)}/recover`,
    {
      method: 'POST',
      headers: writeHeaders(opts),
      body: JSON.stringify({ expected_revision: domain.revision, provider_id: providerId, expected_hostname: domain.hostname }),
    },
    'none',
  );

/**
 * Sets the site's retention policy. Revision-fenced (409 when someone else
 * changed it, or the site is not active with durable routing); the route
 * replays no Idempotency-Key, and a repeated identical PUT is harmless.
 * @goBody api.SetHostingRetentionRequest
 */
export const setHostingRetention = (site: string, input: { enabled: boolean; rules: HostingRetentionRules; expectedRevision: number }) =>
  request<HostingRetentionPolicy>(`/v1/internal/hosting/sites/${encodeURIComponent(site)}/retention`, {
    method: 'PUT',
    body: JSON.stringify({
      enabled: input.enabled,
      pending_age_seconds: input.rules.pending_age_seconds,
      staged_age_seconds: input.rules.staged_age_seconds,
      expected_revision: input.expectedRevision,
    }),
  });

/** Which release actions apply; apid has the last word (a preview may still use a release). */
export function releaseActions(release: Pick<HostingRelease, 'id' | 'state'>, site: Pick<HostingSite, 'active_release_id' | 'status' | 'suspended'>) {
  const live = release.id === site.active_release_id;
  return {
    promote: !live && release.state === 'ready' && site.status === 'active',
    retire: !live && (release.state === 'ready' || release.state === 'pending'),
  };
}

/** apid waits this long after a hostname create began before it accepts a recovery (api.HostingDomainRecoveryDelay). */
export const DOMAIN_RECOVERY_DELAY_MS = 160_000;

/**
 * Whether "Bind reviewed provider ID" applies to a domain (a hostname create
 * whose provider ID was never recorded), and if so why it cannot run yet.
 */
export function domainRecovery(
  domain: Pick<HostingDomain, 'details'>,
  now = Date.now(),
): { applies: false } | { applies: true; blocker: string | null } {
  const { provider_id: providerId, create_started_at: started, verified_at: verified } = domain.details;
  if (providerId || !started) return { applies: false };
  if (!verified) return { applies: true, blocker: 'Hostname ownership is not verified yet.' };
  const ready = Date.parse(started) + DOMAIN_RECOVERY_DELAY_MS;
  if (ready > now) return { applies: true, blocker: `apid accepts a recovery from ${new Date(ready).toLocaleTimeString()}.` };
  return { applies: true, blocker: null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value.trim());

/**
 * A 409 means the site moved on since the page loaded (another promotion, a
 * domain step, a run that changed). Refresh, and say so in the error the
 * dialog shows; it stays an ApiError so the dialog treats it as refused.
 */
export async function refreshOnConflict<T>(write: () => Promise<T>, refresh: () => void): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      refresh();
      const detail = `${err.message} The page has been refreshed: review the current state before trying again.`;
      throw new ApiError(err.problem ? { ...err.problem, detail } : null, 409, detail);
    }
    throw err;
  }
}

type Tone = 'badge-success' | 'badge-warning' | 'badge-danger' | 'badge-neutral';

/** A diagnostic check, or a CI run's worst check. */
export function checkBadge(state: string): { label: string; tone: Tone } {
  switch (state) {
    case 'ok':
      return { label: 'OK', tone: 'badge-success' };
    case 'pending':
      return { label: 'Pending', tone: 'badge-warning' };
    case 'blocked':
      return { label: 'Blocked', tone: 'badge-danger' };
    case 'unknown':
      return { label: 'Unknown', tone: 'badge-warning' };
    case 'not_checked':
      return { label: 'Not checked', tone: 'badge-neutral' };
    case 'recorded':
      return { label: 'Recorded', tone: 'badge-neutral' };
    case 'canceled':
      return { label: 'Canceled', tone: 'badge-neutral' };
    default:
      return { label: state || 'Unknown', tone: 'badge-neutral' };
  }
}

export function releaseBadge(state: string): { label: string; tone: Tone } {
  switch (state) {
    case 'ready':
      return { label: 'Ready', tone: 'badge-success' };
    case 'pending':
      return { label: 'Uploading', tone: 'badge-warning' };
    case 'retiring':
      return { label: 'Retiring', tone: 'badge-neutral' };
    case 'deleted':
      return { label: 'Deleted', tone: 'badge-neutral' };
    default:
      return { label: state || 'Unknown', tone: 'badge-neutral' };
  }
}

export function domainBadge(state: string): { label: string; tone: Tone } {
  switch (state) {
    case 'active':
      return { label: 'Active', tone: 'badge-success' };
    case 'pending':
      return { label: 'Pending DNS', tone: 'badge-warning' };
    case 'deleting':
      return { label: 'Deleting', tone: 'badge-neutral' };
    case 'failed':
      return { label: 'Failed', tone: 'badge-danger' };
    default:
      return { label: state || 'Unknown', tone: 'badge-neutral' };
  }
}

/** Whether the edge has the site's latest routing, in one line. */
export function publicationSummary(publication: HostingPublicationStatus): { label: string; tone: Tone; detail: string } {
  const { state, generation = 0, published_generation: published = 0, retry_count: retries, last_error_code: error } = publication;
  if (state === 'published') {
    return { label: 'Published', tone: 'badge-success', detail: `Generation ${generation} is published.` };
  }
  if (state === 'pending') {
    const behind = `Generation ${generation} is waiting to publish (${published ? `${published} is live` : 'nothing published yet'}).`;
    const retry = retries ? ` ${retries} ${retries === 1 ? 'retry' : 'retries'} so far${error ? `, last error ${error}` : ''}.` : '';
    return { label: 'Publishing', tone: error ? 'badge-danger' : 'badge-warning', detail: behind + retry };
  }
  if (state === 'untracked') {
    return { label: 'Not tracked', tone: 'badge-neutral', detail: 'The site has no durable routing, so publication is not tracked.' };
  }
  return { label: state || 'Unknown', tone: 'badge-neutral', detail: '' };
}

/** What apid advises after diagnosing. */
export const RETRY_ADVICE: Record<string, string> = {
  none: 'Nothing needs retrying.',
  retry_same_run: 'Resume the same CI run with unchanged files; do not start a new one.',
  inspect_before_retry: 'Inspect the blocked or unknown checks before retrying anything.',
};

/** "gregale/website@main · a1b2c3d", or null without labels. */
export function provenanceLine(provenance?: HostingReleaseProvenance): string | null {
  if (!provenance) return null;
  const where = [provenance.repository, provenance.branch].filter(Boolean).join('@');
  const parts = [where, provenance.commit_sha?.slice(0, 7)].filter(Boolean);
  return parts.length ? parts.join(' · ') : (provenance.description ?? null);
}

/** A preview URL's state: revoked and expired win over publication. */
export function previewBadge(preview: Pick<HostingPreview, 'revoked' | 'expires_at' | 'generation' | 'published_generation' | 'last_error_code'>, now = Date.now()): { label: string; tone: Tone } {
  if (preview.revoked) return { label: 'Revoked', tone: 'badge-neutral' };
  if (Date.parse(preview.expires_at) <= now) return { label: 'Expired', tone: 'badge-neutral' };
  if (preview.published_generation < preview.generation) {
    return { label: 'Publishing', tone: preview.last_error_code ? 'badge-danger' : 'badge-warning' };
  }
  return { label: 'Live', tone: 'badge-success' };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/* ─────────────────────────── Traffic and usage ────────────────────────── */

/** Share of cacheable requests served from cache, or null when none were cacheable. */
export function cacheHitRate(counters: Pick<HostingTrafficCounters, 'cache_hits' | 'cache_misses'>): number | null {
  const cacheable = counters.cache_hits + counters.cache_misses;
  return cacheable ? counters.cache_hits / cacheable : null;
}

/** "42%", "0.4%" or "—". */
export function percentText(share: number | null): string {
  if (share === null || !Number.isFinite(share)) return '—';
  const pct = share * 100;
  return `${pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/** "09:00": the local hour a traffic bucket starts. */
export const hourLabel = (iso: string) => `${String(new Date(iso).getHours()).padStart(2, '0')}:00`;

/** Hourly request counts for a bar chart, labelled with the local hour. */
export function trafficPoints(buckets: Pick<HostingTrafficBucket, 'start' | 'requests'>[]): { date: Date; label: string; value: number }[] {
  return buckets.map((bucket) => ({ date: new Date(bucket.start), label: hourLabel(bucket.start), value: bucket.requests }));
}

/** What an edge code in the failures table means (pkg/hosting trafficCodeStatus). */
export const TRAFFIC_CODES: Record<string, string> = {
  method_not_allowed: 'A method other than GET or HEAD',
  hosting_file_not_found: 'No such file in the live release',
  hosting_route_unavailable: 'The edge had no route for the site',
  hosting_unavailable: 'Hosting was unavailable at the edge',
  hosting_artifact_unavailable: 'The release files could not be read',
};

/** How full a limit is, 0–1; a missing limit reads as empty. */
export const shareOf = (used: number, limit: number) => (limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0);

/** What this control plane has on, with the per-site limit where one applies. */
export function hostingFeatures(caps: HostingCapabilities): { label: string; on: boolean; detail?: string }[] {
  const perSite = (n: number) => (n > 0 ? `${n} per site` : undefined);
  return [
    { label: 'Automation credentials', on: caps.automation_enabled, detail: perSite(caps.automation_credentials_per_site) },
    { label: 'GitHub OIDC', on: caps.oidc_enabled },
    { label: 'CI setup', on: caps.ci_setup_enabled },
    { label: 'CI activity', on: caps.activity_enabled, detail: caps.ci_runs_per_site > 0 ? `${caps.ci_runs_per_site} runs kept per site` : undefined },
    { label: 'Run cancellation', on: caps.cancellation_enabled },
    { label: 'Diagnostics', on: caps.diagnostics_enabled },
    { label: 'Promotion history', on: caps.history_enabled, detail: caps.history_per_site > 0 ? `last ${caps.history_per_site} per site` : undefined },
    { label: 'Preview URLs', on: caps.previews_enabled, detail: perSite(caps.previews_per_site) },
    { label: 'Preview reservations', on: caps.preview_reservations_enabled },
    { label: 'Custom domains', on: caps.domains_enabled, detail: perSite(caps.domains_per_site) },
    { label: 'Redirects and headers', on: caps.config_enabled },
    { label: 'Traffic analytics', on: caps.analytics_enabled },
    { label: 'Release retention', on: caps.retention_enabled },
  ];
}

/* ──────────────────────────────── Retention ───────────────────────────── */

/** Bounds apid enforces on both ages (api.HostingRetentionAgeMin / Max), in hours. */
export const RETENTION_HOURS_MIN = 1;
export const RETENTION_HOURS_MAX = 30 * 24;

/** "1 hour", "36 hours", "7 days". */
export function durationText(seconds: number): string {
  const hours = seconds / 3600;
  if (hours >= 48 && Number.isInteger(hours / 24)) return `${hours / 24} days`;
  if (hours === 24) return '1 day';
  if (Number.isInteger(hours)) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${Math.round(seconds / 60)} minutes`;
}

/** Why apid would refuse this age in hours, or null. */
export function retentionHoursError(value: string): string | null {
  const hours = Number(value);
  if (!value.trim() || !Number.isInteger(hours)) return 'Whole hours.';
  if (hours < RETENTION_HOURS_MIN || hours > RETENTION_HOURS_MAX) return `Between ${RETENTION_HOURS_MIN} and ${RETENTION_HOURS_MAX} hours (30 days).`;
  return null;
}

/** Why apid keeps or retires a release (pkg/hosting cleanupEntry). */
export const CLEANUP_REASONS: Record<string, string> = {
  site_ineligible: 'The site is not active with durable routing, so retention leaves it alone.',
  awaiting_retirement_publication: 'Retiring: waiting for routing without it to publish.',
  retirement_grace_period: 'Retiring: in the grace period before its files are deleted.',
  awaiting_artifact_cleanup: 'Retiring: waiting for its files to be deleted.',
  active_release: 'Live in production.',
  previously_published: 'Was live before, so it is kept for rollback.',
  active_preview: 'A live preview serves it.',
  preview_cleanup_pending: 'An expired or revoked preview still references it.',
  ci_retry_window: 'Its CI run can still be retried.',
  manual_staging: 'Staged without a CI run, so retention never removes it.',
  activity_unknown: 'Its last activity is unknown, so it is kept.',
  recent_activity: 'Recently active.',
  abandoned_upload: 'An upload that was never finished.',
  expired_ci_release: 'A CI release that was never put live, past its retry window.',
};

/** A cleanup verdict for a badge: retiring, eligible (only acted on while the policy is on), or kept. */
export function cleanupBadge(entry: Pick<HostingCleanupEntry, 'eligible' | 'state'>, enabled: boolean): { label: string; tone: Tone } {
  if (entry.state === 'retiring') return { label: 'Retiring', tone: 'badge-neutral' };
  if (entry.eligible) return enabled ? { label: 'Will retire', tone: 'badge-warning' } : { label: 'Eligible', tone: 'badge-warning' };
  return { label: 'Kept', tone: 'badge-success' };
}

/* ─────────────────────────────────── Sites ────────────────────────────── */

/** Site status for a badge; a suspended site serves nothing whatever its status. */
export function siteStatus(site: Pick<HostingSite, 'status' | 'suspended'>): {
  label: string;
  tone: 'badge-success' | 'badge-warning' | 'badge-danger' | 'badge-neutral';
} {
  if (site.suspended) return { label: 'Suspended', tone: 'badge-warning' };
  switch (site.status) {
    case 'active':
      return { label: 'Active', tone: 'badge-success' };
    case 'failed':
      return { label: 'Failed', tone: 'badge-danger' };
    case 'deleting':
      return { label: 'Deleting', tone: 'badge-neutral' };
    default:
      return { label: site.status || 'Unknown', tone: 'badge-neutral' };
  }
}

/**
 * Why this site's credentials cannot deploy right now, or null. apid only
 * authenticates a credential for an active site with durable routing
 * (HostingCredentialAuthenticate), so issuing one elsewhere is pointless.
 */
export function credentialBlocker(site: Pick<HostingSite, 'status' | 'durable_routing'>): string | null {
  if (site.status !== 'active') return `The site is ${site.status || 'not active'}, so no credential can deploy to it.`;
  if (!site.durable_routing) return 'The site has no durable routing yet, so credentials will not authenticate until it does.';
  return null;
}

/* ──────────────────────────── Automation credentials ──────────────────── */

/** What a credential may do (artifacts.ValidHostingAutomationOperations). */
export const HOSTING_OPERATIONS = [
  { value: 'stage', label: 'Stage releases', hint: 'Upload and finalize a release; it does not go live until promoted.' },
  { value: 'preview', label: 'Publish previews', hint: 'Serve a staged release on a temporary preview URL.' },
] as const;
export type HostingOperation = (typeof HOSTING_OPERATIONS)[number]['value'];

/** Lifetimes offered; apid accepts 5 minutes to 30 days and defaults to 24 hours. */
export const CREDENTIAL_LIFETIMES = [
  { seconds: 60 * 60, label: '1 hour' },
  { seconds: 24 * 60 * 60, label: '24 hours' },
  { seconds: 7 * 24 * 60 * 60, label: '7 days' },
  { seconds: 30 * 24 * 60 * 60, label: '30 days' },
] as const;
export const DEFAULT_CREDENTIAL_LIFETIME = 24 * 60 * 60;

const LABEL_MAX_BYTES = 64;

/** Why apid would refuse this label (artifacts.ValidHostingAutomationLabel), or null. Callers send it trimmed. */
export function credentialLabelError(label: string): string | null {
  const value = label.trim();
  if (!value) return 'Name the credential after where it will be used, e.g. "github-actions main".';
  if (new TextEncoder().encode(value).length > LABEL_MAX_BYTES) return `Keep the label within ${LABEL_MAX_BYTES} bytes.`;
  if (/[\p{Cc}\p{Cf}]/u.test(value)) {
    return 'The label cannot contain control or invisible characters.';
  }
  return null;
}

/** "in 3 days" / "2 hours ago"; for credential expiry, which is usually ahead. */
export function untilText(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const diff = then - now;
  const abs = Math.abs(diff);
  const unit =
    abs < 60_000
      ? `${Math.max(1, Math.round(abs / 1000))}s`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

/** apid keeps expired credentials listed until revoked; they no longer authenticate. */
export const isExpired = (credential: Pick<HostingAutomationCredential, 'expires_at'>, now = Date.now()) =>
  Date.parse(credential.expires_at) <= now;

/**
 * In the last quarter of its lifetime and under a day left: worth rotating
 * before a deploy fails on it. Relative to the lifetime, so a credential
 * issued for 24 hours is not flagged the moment it is created.
 */
export const expiresSoon = (credential: Pick<HostingAutomationCredential, 'created_at' | 'expires_at'>, now = Date.now()) => {
  const expires = Date.parse(credential.expires_at);
  const left = expires - now;
  const lifetime = expires - Date.parse(credential.created_at);
  return left > 0 && left < Math.min(24 * 60 * 60 * 1000, lifetime / 4);
};

/* ──────────────────────────────── OIDC trusts ─────────────────────────── */

/** What the operator types; trustRules() turns it into the exact claims apid matches. */
export interface TrustDraft {
  repository: string;
  repositoryOwnerId: string;
  repositoryId: string;
  branch: string;
  workflowFile: string;
  eventName: string;
  environment: string;
}

export const EMPTY_TRUST_DRAFT: TrustDraft = {
  repository: '',
  repositoryOwnerId: '',
  repositoryId: '',
  branch: 'main',
  workflowFile: '',
  eventName: 'push',
  environment: '',
};

export const TRUST_EVENTS = [
  { value: 'push', label: 'push' },
  { value: 'workflow_dispatch', label: 'workflow_dispatch (manual run)' },
  { value: 'schedule', label: 'schedule' },
] as const;

const GITHUB_ID = /^[1-9][0-9]{0,19}$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_FILE = /^[A-Za-z0-9_.-]+\.ya?ml$/;

/** "deploy.yml" from ".github/workflows/deploy.yml" or a pasted workflow URL. */
const workflowFileName = (value: string) => value.trim().split(/[/\\]/).pop() ?? '';

/** "owner/name" from itself or a pasted https://github.com/owner/name(.git) URL. */
const repositoryName = (value: string) =>
  value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');

/** "main" from itself or a pasted "refs/heads/main". */
const branchName = (value: string) => value.trim().replace(/^refs\/heads\//, '');

export function trustRules(draft: TrustDraft): HostingOIDCTrustRules {
  const repository = repositoryName(draft.repository);
  const ref = `refs/heads/${branchName(draft.branch)}`;
  const environment = draft.environment.trim();
  return {
    repository_owner_id: draft.repositoryOwnerId.trim(),
    repository_id: draft.repositoryId.trim(),
    repository,
    ref,
    workflow_ref: `${repository}/.github/workflows/${workflowFileName(draft.workflowFile)}@${ref}`,
    event_name: draft.eventName,
    ...(environment ? { environment } : {}),
  };
}

/** Field problems apid would refuse (hosting.ValidHostingOIDCTrust), keyed by draft field. */
export function trustDraftErrors(draft: TrustDraft): Partial<Record<keyof TrustDraft, string>> {
  const errors: Partial<Record<keyof TrustDraft, string>> = {};
  const repository = repositoryName(draft.repository);
  if (!GITHUB_REPOSITORY.test(repository) || repository.length > 200) errors.repository = 'Use owner/name, e.g. gregale/website.';
  if (!GITHUB_ID.test(draft.repositoryOwnerId.trim())) errors.repositoryOwnerId = "The owner's numeric GitHub ID.";
  if (!GITHUB_ID.test(draft.repositoryId.trim())) errors.repositoryId = "The repository's numeric GitHub ID.";
  const branch = branchName(draft.branch);
  if (
    !branch ||
    `refs/heads/${branch}`.length > 255 ||
     
    /[\u0000- \u007f~^:?*[\\]/.test(branch) ||
    branch.includes('..') ||
    branch.includes('@{') ||
    branch.includes('//') ||
    branch.endsWith('/')
  ) {
    errors.branch = 'A branch name such as main.';
  }
  const rules = trustRules(draft);
  if (!WORKFLOW_FILE.test(workflowFileName(draft.workflowFile)) || rules.workflow_ref.length > 512) {
    errors.workflowFile = 'The workflow file name, e.g. deploy.yml.';
  }
  if (!TRUST_EVENTS.some((event) => event.value === draft.eventName)) errors.eventName = 'Choose an event.';
  const environment = draft.environment.trim();
   
  if (environment.length > 255 || /[\u0000\r\n]/.test(environment)) errors.environment = 'At most 255 characters on one line.';
  return errors;
}

/** "main" from "refs/heads/main". */
export const branchOf = (ref: string) => ref.replace(/^refs\/heads\//, '');

/** "deploy.yml" from "owner/repo/.github/workflows/deploy.yml@refs/heads/main". */
export const workflowFileOf = (workflowRef: string) => workflowRef.split('@')[0].split('/').pop() ?? workflowRef;

/** The audience a workflow requests its GitHub ID token for (api.HostingOIDCAudience). */
export const oidcAudience = (site: string) => `gregale:hosting:${site}`;

/* ──────────────────────────────── Availability ────────────────────────── */

/**
 * apid answers 503 with these codes when a hosting feature is switched off
 * on this control plane. That is configuration, not an outage, so pages say
 * so plainly instead of showing an error.
 */
const FEATURE_OFF: Record<string, string> = {
  frontend_hosting_disabled: 'Static hosting is turned off on this control plane.',
  frontend_hosting_unconfigured: 'Static hosting is on but its storage or domain is not configured.',
  frontend_hosting_automation_disabled: 'Site automation is turned off, so no automation credentials can be issued.',
  frontend_hosting_automation_unconfigured: 'Site automation is waiting for every API writer to be upgraded before it can be enabled.',
  frontend_hosting_oidc_disabled: 'GitHub OIDC for hosting is turned off or not configured on this control plane.',
  frontend_hosting_activity_disabled: 'CI activity is turned off on this control plane.',
  frontend_hosting_history_disabled: 'Promotion history is turned off on this control plane.',
  frontend_hosting_history_unconfigured: 'Promotion history is not configured on this control plane.',
  frontend_hosting_diagnostics_disabled: 'Deployment diagnostics are turned off or not configured on this control plane.',
  frontend_hosting_domains_disabled: 'Custom domains are turned off on this control plane.',
  frontend_hosting_domains_unconfigured: 'Custom domains are on but their DNS provider is not configured.',
  frontend_hosting_previews_disabled: 'Preview URLs are turned off on this control plane.',
  frontend_hosting_cancellation_disabled: 'CI run cancellation is turned off on this control plane.',
  frontend_hosting_analytics_disabled: 'Traffic analytics are turned off on this control plane.',
  frontend_hosting_analytics_unconfigured: 'Traffic analytics are on but their Analytics Engine reader is not configured.',
  frontend_hosting_retention_disabled: 'Release retention is turned off on this control plane.',
  frontend_hosting_retention_unconfigured: 'Release retention is waiting for every API writer to be upgraded before it can be enabled.',
  frontend_hosting_preview_reservations_disabled: 'Preview reservations, or the automation, preview and durable routing they need, are turned off.',
};

/** A sentence when `err` means the feature is switched off, else null. */
export function hostingFeatureOff(err: unknown): string | null {
  return err instanceof ApiError && err.status === 503 ? (FEATURE_OFF[err.code] ?? null) : null;
}
