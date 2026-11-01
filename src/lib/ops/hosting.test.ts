import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  branchOf,
  credentialBlocker,
  credentialLabelError,
  EMPTY_TRUST_DRAFT,
  expiresSoon,
  hostingFeatureOff,
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
    expect(hostingFeatureOff(problem(503, 'frontend_hosting_unavailable'))).toBeNull();
    expect(hostingFeatureOff(problem(404, 'not_found'))).toBeNull();
    expect(hostingFeatureOff(new Error('boom'))).toBeNull();
  });
});
