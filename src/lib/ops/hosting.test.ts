import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  branchOf,
  cacheHitRate,
  cleanupBadge,
  CLEANUP_REASONS,
  durationText,
  hostingFeatures,
  percentText,
  retentionHoursError,
  shareOf,
  trafficPoints,
  DOMAIN_RECOVERY_DELAY_MS,
  domainRecovery,
  isUuid,
  refreshOnConflict,
  releaseActions,
  checkBadge,
  domainBadge,
  formatBytes,
  previewBadge,
  provenanceLine,
  publicationSummary,
  releaseBadge,
  credentialBlocker,
  credentialLabelError,
  EMPTY_TRUST_DRAFT,
  expiresSoon,
  hostingFeatureOff,
  hostingSectionOff,
  isHiddenRoute,
  isExpired,
  siteStatus,
  trustDraftErrors,
  trustRules,
  untilText,
  workflowFileOf,
  type TrustDraft,
} from './hosting';

const NOW = Date.parse('2026-11-01T12:00:00Z');

describe('credentialLabelError', () => {
  it('accepts a short label and refuses what apid refuses', () => {
    expect(credentialLabelError('github-actions main')).toBeNull();
    expect(credentialLabelError('  ')).toMatch(/Name the credential/);
    expect(credentialLabelError('x'.repeat(65))).toMatch(/64 bytes/);
    expect(credentialLabelError('é'.repeat(33))).toMatch(/64 bytes/);
    expect(credentialLabelError('ci​bot')).toMatch(/invisible/);
    expect(credentialLabelError('ci\tbot')).toMatch(/control/);
  });
});

describe('credential expiry', () => {
  it('describes time either side of now', () => {
    expect(untilText('2026-11-04T12:00:00Z', NOW)).toBe('in 3d');
    expect(untilText('2026-11-01T10:00:00Z', NOW)).toBe('2h ago');
    expect(untilText('nope', NOW)).toBe('—');
  });

  it('flags expired and soon-to-expire credentials', () => {
    expect(isExpired({ expires_at: '2026-11-01T11:59:59Z' }, NOW)).toBe(true);
    expect(isExpired({ expires_at: '2026-11-01T12:00:01Z' }, NOW)).toBe(false);
    // A 30-day credential with 6 hours left; one with two days left.
    expect(expiresSoon({ created_at: '2026-10-02T18:00:00Z', expires_at: '2026-11-01T18:00:00Z' }, NOW)).toBe(true);
    expect(expiresSoon({ created_at: '2026-10-04T12:00:00Z', expires_at: '2026-11-03T12:00:00Z' }, NOW)).toBe(false);
    // A 24-hour credential just issued is not flagged; with 5 hours left it is.
    expect(expiresSoon({ created_at: '2026-11-01T12:00:00Z', expires_at: '2026-11-02T12:00:00Z' }, NOW)).toBe(false);
    expect(expiresSoon({ created_at: '2026-10-31T17:00:00Z', expires_at: '2026-11-01T17:00:00Z' }, NOW)).toBe(true);
    expect(expiresSoon({ created_at: '2026-10-31T11:00:00Z', expires_at: '2026-11-01T11:00:00Z' }, NOW)).toBe(false);
  });
});

describe('OIDC trust drafts', () => {
  const draft: TrustDraft = {
    ...EMPTY_TRUST_DRAFT,
    repository: 'gregale/website',
    repositoryOwnerId: '1234',
    repositoryId: '5678',
    branch: 'main',
    workflowFile: 'deploy.yml',
  };

  it('builds the exact claims apid matches', () => {
    expect(trustRules(draft)).toEqual({
      repository_owner_id: '1234',
      repository_id: '5678',
      repository: 'gregale/website',
      ref: 'refs/heads/main',
      workflow_ref: 'gregale/website/.github/workflows/deploy.yml@refs/heads/main',
      event_name: 'push',
    });
    expect(trustDraftErrors(draft)).toEqual({});
  });

  it('accepts what operators paste: repo URLs, full refs and workflow paths', () => {
    const pasted = {
      ...draft,
      repository: 'https://github.com/gregale/website.git',
      branch: 'refs/heads/release/v2',
      workflowFile: '.github/workflows/deploy.yaml',
      environment: ' production ',
    };
    expect(trustRules(pasted)).toMatchObject({
      repository: 'gregale/website',
      ref: 'refs/heads/release/v2',
      workflow_ref: 'gregale/website/.github/workflows/deploy.yaml@refs/heads/release/v2',
      environment: 'production',
    });
    expect(trustDraftErrors(pasted)).toEqual({});
  });

  it('names each field apid would refuse', () => {
    const errors = trustDraftErrors({
      ...draft,
      repository: 'website',
      repositoryOwnerId: 'gregale',
      repositoryId: '0123',
      branch: 'feature..x',
      workflowFile: 'deploy.sh',
      eventName: 'pull_request',
      environment: 'a\nb',
    });
    expect(Object.keys(errors).sort()).toEqual(
      ['branch', 'environment', 'eventName', 'repository', 'repositoryId', 'repositoryOwnerId', 'workflowFile'].sort(),
    );
    expect(trustDraftErrors({ ...draft, branch: 'main/' }).branch).toBeDefined();
    expect(trustDraftErrors({ ...draft, branch: 'my branch' }).branch).toBeDefined();
  });

  it('reads a trust back as branch and workflow file', () => {
    expect(branchOf('refs/heads/release/v2')).toBe('release/v2');
    expect(workflowFileOf('gregale/website/.github/workflows/deploy.yml@refs/heads/main')).toBe('deploy.yml');
  });
});

describe('sites', () => {
  it('badges suspension over status', () => {
    expect(siteStatus({ status: 'active', suspended: false })).toEqual({ label: 'Active', tone: 'badge-success' });
    expect(siteStatus({ status: 'active', suspended: true }).label).toBe('Suspended');
    expect(siteStatus({ status: 'failed', suspended: false }).tone).toBe('badge-danger');
  });

  it('says when credentials cannot deploy', () => {
    expect(credentialBlocker({ status: 'active', durable_routing: true })).toBeNull();
    expect(credentialBlocker({ status: 'active', durable_routing: false })).toMatch(/durable routing/);
    expect(credentialBlocker({ status: 'deleting', durable_routing: true })).toMatch(/deleting/);
  });
});

describe('hostingFeatureOff', () => {
  const problem = (status: number, code: string) => new ApiError({ title: 'x', status, code }, status, 'x');

  it('turns switched-off features into a sentence and leaves real failures alone', () => {
    expect(hostingFeatureOff(problem(503, 'frontend_hosting_disabled'))).toMatch(/turned off/);
    expect(hostingFeatureOff(problem(503, 'frontend_hosting_oidc_disabled'))).toMatch(/OIDC/);
    expect(hostingFeatureOff(problem(503, 'frontend_hosting_domains_unconfigured'))).toMatch(/DNS provider/);
    expect(hostingFeatureOff(problem(503, 'frontend_hosting_unavailable'))).toBeNull();
    expect(hostingFeatureOff(problem(404, 'not_found'))).toBeNull();
    expect(hostingFeatureOff(new Error('boom'))).toBeNull();
  });

  it('reads a hidden hosting route as hosting turned off, but not a missing site', () => {
    const hidden = new ApiError({ title: 'Not found', status: 404, code: 'not_found', detail: 'no such API route' }, 404, 'x');
    const missing = new ApiError({ title: 'Not found', status: 404, code: 'not_found', detail: 'no such hosting resource' }, 404, 'x');
    expect(isHiddenRoute(hidden)).toBe(true);
    expect(isHiddenRoute(missing)).toBe(false);
    expect(hostingFeatureOff(hidden)).toMatch(/frontend_hosting_enabled is off/);
    expect(hostingFeatureOff(missing)).toBeNull();
    // Inside a site that loaded, hosting is on: the route is what is missing.
    expect(hostingSectionOff(hidden)).toMatch(/does not serve this route/);
    expect(hostingSectionOff(missing)).toBeNull();
    expect(hostingSectionOff(problem(503, 'frontend_hosting_analytics_disabled'))).toMatch(/Traffic analytics/);
  });
});

describe('read models', () => {
  it('summarises publication, including a stuck generation', () => {
    expect(publicationSummary({ state: 'published', generation: 7, published_generation: 7, retry_count: 0 })).toMatchObject({
      label: 'Published',
      tone: 'badge-success',
    });
    const stuck = publicationSummary({ state: 'pending', generation: 8, published_generation: 7, retry_count: 3, last_error_code: 'provider_timeout' });
    expect(stuck.tone).toBe('badge-danger');
    expect(stuck.detail).toBe('Generation 8 is waiting to publish (7 is live). 3 retries so far, last error provider_timeout.');
    expect(publicationSummary({ state: 'untracked', retry_count: 0 }).label).toBe('Not tracked');
  });

  it('badges checks, releases and domains', () => {
    expect(checkBadge('blocked')).toEqual({ label: 'Blocked', tone: 'badge-danger' });
    expect(checkBadge('not_checked').label).toBe('Not checked');
    expect(releaseBadge('pending').label).toBe('Uploading');
    expect(domainBadge('pending').label).toBe('Pending DNS');
    expect(domainBadge('something_new')).toEqual({ label: 'something_new', tone: 'badge-neutral' });
  });

  it('reads source labels and preview state', () => {
    expect(provenanceLine({ repository: 'gregale/website', branch: 'main', commit_sha: 'a1b2c3d4e5f6' })).toBe('gregale/website@main · a1b2c3d');
    expect(provenanceLine({ description: 'manual upload' })).toBe('manual upload');
    expect(provenanceLine(undefined)).toBeNull();
    const preview = { revoked: false, expires_at: '2026-11-02T12:00:00Z', generation: 2, published_generation: 2 };
    expect(previewBadge(preview, NOW).label).toBe('Live');
    expect(previewBadge({ ...preview, published_generation: 1 }, NOW).label).toBe('Publishing');
    expect(previewBadge({ ...preview, expires_at: '2026-11-01T11:00:00Z' }, NOW).label).toBe('Expired');
    expect(previewBadge({ ...preview, revoked: true }, NOW).label).toBe('Revoked');
  });

  it('formats artifact sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2_621_440)).toBe('2.5 MB');
  });
});

describe('actions', () => {
  const site = { active_release_id: 'live', status: 'active', suspended: false };

  it('offers put live and retire only where apid would accept them', () => {
    expect(releaseActions({ id: 'live', state: 'ready' }, site)).toEqual({ promote: false, retire: false });
    expect(releaseActions({ id: 'old', state: 'ready' }, site)).toEqual({ promote: true, retire: true });
    expect(releaseActions({ id: 'new', state: 'pending' }, site)).toEqual({ promote: false, retire: true });
    expect(releaseActions({ id: 'gone', state: 'retiring' }, site)).toEqual({ promote: false, retire: false });
    expect(releaseActions({ id: 'old', state: 'ready' }, { ...site, status: 'deleting' }).promote).toBe(false);
  });

  it('offers domain recovery only for an unbound create, and says when it can run', () => {
    const started = '2026-11-01T11:59:00Z';
    const details = { tls_status: '', records: [], create_started_at: started, verified_at: started };
    expect(domainRecovery({ details: { ...details, provider_id: 'bound' } }, NOW)).toEqual({ applies: false });
    expect(domainRecovery({ details: { tls_status: '', records: [] } }, NOW)).toEqual({ applies: false });
    expect(domainRecovery({ details: { ...details, verified_at: undefined } }, NOW)).toEqual({ applies: true, blocker: 'Hostname ownership is not verified yet.' });
    const early = domainRecovery({ details }, NOW);
    expect(early.applies && early.blocker).toMatch(/accepts a recovery from/);
    expect(domainRecovery({ details }, Date.parse(started) + DOMAIN_RECOVERY_DELAY_MS)).toEqual({ applies: true, blocker: null });
  });

  it('checks a provider ID is a UUID', () => {
    expect(isUuid(' 0f8fad5b-d9cb-469f-a165-70867728950e ')).toBe(true);
    expect(isUuid('0f8fad5b')).toBe(false);
  });

  it('refreshes and explains on a conflict, and passes other errors through', async () => {
    let refreshed = 0;
    const refresh = () => (refreshed += 1);
    const conflict = new ApiError({ title: 'Hosting state changed', status: 409, code: 'hosting_release_conflict', detail: 'refresh the site revision' }, 409, 'x');
    const err = await refreshOnConflict(() => Promise.reject(conflict), refresh).catch((e) => e);
    expect(refreshed).toBe(1);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('refresh the site revision The page has been refreshed: review the current state before trying again.');

    const other = new ApiError({ title: 'x', status: 503, code: 'frontend_hosting_unavailable' }, 503, 'x');
    await expect(refreshOnConflict(() => Promise.reject(other), refresh)).rejects.toBe(other);
    expect(refreshed).toBe(1);
    await expect(refreshOnConflict(() => Promise.resolve('ok'), refresh)).resolves.toBe('ok');
  });
});

describe('traffic and usage', () => {
  it('reads a cache hit rate only when something was cacheable', () => {
    expect(cacheHitRate({ cache_hits: 90, cache_misses: 10 })).toBe(0.9);
    expect(cacheHitRate({ cache_hits: 0, cache_misses: 0 })).toBeNull();
    expect(percentText(0.9)).toBe('90%');
    expect(percentText(0.004)).toBe('0.4%');
    expect(percentText(null)).toBe('—');
  });

  it('labels hourly buckets with the local hour', () => {
    const start = new Date(2026, 10, 1, 9, 0, 0).toISOString();
    expect(trafficPoints([{ start, requests: 12 }])).toEqual([{ date: new Date(start), label: '09:00', value: 12 }]);
  });

  it('lists features with their per-site limits', () => {
    const caps = { automation_enabled: true, automation_credentials_per_site: 5, previews_enabled: false, previews_per_site: 0, history_enabled: true, history_per_site: 50 } as Parameters<typeof hostingFeatures>[0];
    const features = hostingFeatures(caps);
    expect(features.find((f) => f.label === 'Automation credentials')).toEqual({ label: 'Automation credentials', on: true, detail: '5 per site' });
    expect(features.find((f) => f.label === 'Preview URLs')).toMatchObject({ on: false, detail: undefined });
    expect(features.find((f) => f.label === 'Promotion history')?.detail).toBe('last 50 per site');
  });

  it('clamps how full a limit is', () => {
    expect(shareOf(25, 100)).toBe(0.25);
    expect(shareOf(150, 100)).toBe(1);
    expect(shareOf(5, 0)).toBe(0);
  });
});

describe('retention', () => {
  it('describes ages and refuses what apid refuses', () => {
    expect(durationText(3600)).toBe('1 hour');
    expect(durationText(36 * 3600)).toBe('36 hours');
    expect(durationText(86_400)).toBe('1 day');
    expect(durationText(30 * 86_400)).toBe('30 days');
    expect(retentionHoursError('24')).toBeNull();
    expect(retentionHoursError('720')).toBeNull();
    expect(retentionHoursError('0')).toMatch(/Between 1 and 720/);
    expect(retentionHoursError('721')).toMatch(/Between/);
    expect(retentionHoursError('1.5')).toMatch(/Whole hours/);
    expect(retentionHoursError(' ')).toMatch(/Whole hours/);
  });

  it('says whether an eligible release will actually be retired', () => {
    expect(cleanupBadge({ eligible: true, state: 'pending' }, true).label).toBe('Will retire');
    expect(cleanupBadge({ eligible: true, state: 'pending' }, false).label).toBe('Eligible');
    expect(cleanupBadge({ eligible: false, state: 'ready' }, true).label).toBe('Kept');
    expect(cleanupBadge({ eligible: false, state: 'retiring' }, true).label).toBe('Retiring');
  });

  it('explains every reason apid gives', () => {
    for (const reason of ['site_ineligible', 'awaiting_retirement_publication', 'retirement_grace_period', 'awaiting_artifact_cleanup', 'active_release', 'previously_published', 'active_preview', 'preview_cleanup_pending', 'ci_retry_window', 'manual_staging', 'activity_unknown', 'recent_activity', 'abandoned_upload', 'expired_ci_release']) {
      expect(CLEANUP_REASONS[reason]).toBeTruthy();
    }
  });
});
