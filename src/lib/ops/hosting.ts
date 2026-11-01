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
   ========================================================================== */

import { ApiError, request } from '@/lib/api';

/** @go api.HostingSite */
export interface HostingSite {
  id: string;
  project_id: string;
  environment: string;
  name: string;
  hostname: string;
  status: string;
  active_release_id: string;
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
};

/** A sentence when `err` means the feature is switched off, else null. */
export function hostingFeatureOff(err: unknown): string | null {
  return err instanceof ApiError && err.status === 503 ? (FEATURE_OFF[err.code] ?? null) : null;
}
