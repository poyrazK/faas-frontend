// A local stand-in for apid, so the console can be driven end to end without
// a control plane or credentials. Fixtures follow the console's wire types;
// any route without one answers 503 mock_unavailable, so error states render.
//
// Behaviour that matters to the tests mirrors apid:
//   - admin writes, and hosting credential and OIDC trust writes, need a step-up
//     younger than five minutes (403 step_up_required),
//     and an operator with no authenticator gets 403 mfa_required "must enroll";
//   - TOTP 123456 passes /v1/account/mfa/verify and /confirm; every CSRF token is "csrf-mock".
//
// Test hooks (not part of apid):
//   POST /__mock/reset              fresh state, timestamps relative to now
//   POST /__mock/state {...}        flip switches: {"enrolled": false}, {"expired": true}, {"oidc": false},
//                                   {"hostingEnabled": false}, {"analytics": false}, {"retention": false}, {"siteRevision": 9}, {"retentionRevision": 4}
//   GET  /__mock/requests           every request since the last reset, oldest first
//
// MOCK_APID_PORT sets the port (3199); MOCK_APID_LOG=1 logs each request.

import http from 'node:http';

const PORT = Number(process.env.MOCK_APID_PORT || 3199);
const LOG = process.env.MOCK_APID_LOG === '1';
const TOTP = '123456';
const PASSWORD = 'correct horse';
const CSRF = 'csrf-mock';
const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const ACCOUNT2 = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const APP_ID = 'b0000000-0000-4000-8000-000000000001';
const DEPLOYMENT = '7a1b2c3d-0000-4000-8000-000000000001';
const TICKET_OPEN = 'a1000000-0000-4000-8000-000000000001';
const TICKET_STAFF = 'a1000000-0000-4000-8000-000000000042';
const RELEASE_NEW = 'a3f9c2d1e8b74c6f9d0e1a2b3c4d5e6f7a8b9c0d';
const RELEASE_OLD = '9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d';
const SITE_ID = 'd0000000-0000-4000-8000-000000000001';
const SITE_RELEASE_LIVE = 'f1a00000-0000-4000-8000-000000000001';
const SITE_RELEASE_STAGED = 'f2b00000-0000-4000-8000-000000000002';
const SITE_RELEASE_OLD = 'f3c00000-0000-4000-8000-000000000003';
const SITE_RELEASE_ABANDONED = 'f4d00000-0000-4000-8000-000000000004';
const RUN_OK = 'b1a00000-0000-4000-8000-000000000001';
const RUN_EXPIRED = 'b2b00000-0000-4000-8000-000000000002';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const now = () => new Date().toISOString();
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const problem = (status, code, title, detail) => ({ status, body: { type: '', title, status, code, detail } });

function freshState() {
  return {
    enrolled: true,
    pendingSession: false,
    expired: false,
    steppedUpAt: 0,
    configVersion: 3,
    suspended: false,
    oidc: true,
    signals: [attentionSignal(1, ACCOUNT, 'app_oom', 'checkout-api', 'open'), attentionSignal(2, ACCOUNT2, 'deploy_failing', 'billing-api', 'open'),
      attentionSignal(3, ACCOUNT2, 'refused_burst', 'api_key_revoked', 'dismissed'),
      { ...attentionSignal(4, ACCOUNT, 'deploy_failing', 'checkout-api', 'dismissed'), outcome: 'contacted', dismissed_by: 'op-1', ticket_id: TICKET_STAFF },
      { ...attentionSignal(5, ACCOUNT, 'domain_not_serving', 'shop.example', 'resolved'), resolved_at: ago(600) }],
    tickets: supportTickets(),
    messages: supportMessages(),
    unread: 2,
    hostingEnabled: true,
    analytics: true,
    retention: true,
    tokens: 0,
    hosting: freshHosting(),
    intents: new Map(),
    requests: [],
    nodes: new Map([
      ['node-a', { id: 'n1', name: 'node-a', target_url: 'tcp://10.8.0.2:7001', gateway_target_url: 'tcp://10.8.0.2:9100', vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, active: true, lifecycle: 'active', role: 'compute', region: 'eu-central', zone: 'fsn1', release_id: RELEASE_NEW, manifest_hash: 'sha256:9f2c4d10aa', cert_fingerprint: 'SHA256:ab12cd34ef56', generation: 4, last_heartbeat_at: ago(0.1), created_at: ago(60 * 24 * 90) }],
      ['node-b', { id: 'n2', name: 'node-b', target_url: 'tcp://10.8.0.3:7001', vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, active: true, lifecycle: 'active', release_id: RELEASE_OLD, generation: 3, last_heartbeat_at: ago(0.2), created_at: ago(60 * 24 * 60) }],
      ['node-c', { id: 'n3', name: 'node-c', target_url: 'tcp://10.8.0.4:7001', vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, active: false, lifecycle: 'maintenance', generation: 2, created_at: ago(60 * 24 * 20) }],
    ]),
    credentials: [
      { id: 'c1000000-0000-4000-8000-000000000001', account_id: 'op-1', site_id: SITE_ID, label: 'github-actions main', operations: ['stage', 'preview'], created_at: ago(60 * 24 * 2), expires_at: ago(-60 * 24 * 5) },
      { id: 'c1000000-0000-4000-8000-000000000002', account_id: 'op-1', site_id: SITE_ID, label: 'old-ci', operations: ['stage'], created_at: ago(60 * 24 * 40), expires_at: ago(60 * 24 * 10) },
    ],
    trusts: [
      { id: 'e1000000-0000-4000-8000-000000000001', account_id: 'op-1', site_id: SITE_ID, repository_owner_id: '1234567', repository_id: '89012345', repository: 'gregale/website', ref: 'refs/heads/main', workflow_ref: 'gregale/website/.github/workflows/deploy.yml@refs/heads/main', event_name: 'push', created_at: ago(60 * 24 * 3) },
    ],
    sessions: [
      { id: 's0000000-0000-4000-8000-000000000001', issued_ip: '203.0.113.7', issued_ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', issued_at: ago(60 * 3), last_seen_at: ago(0.1), current_session: true },
      { id: 's0000000-0000-4000-8000-000000000002', issued_ip: '198.51.100.20', issued_ua: 'gregalectl/1.42 (darwin/arm64)', issued_at: ago(60 * 24 * 2), last_seen_at: ago(60 * 5), current_session: false },
      { id: 's0000000-0000-4000-8000-000000000003', issued_ip: '192.0.2.44', issued_ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0', issued_at: ago(60 * 24 * 6), last_seen_at: '', current_session: false },
    ],
  };
}

let state = freshState();


function episode(extra = {}) {
  return { id: 'e1', started_at: ago(120), plan: 'pro', priority: 'high', category: 'deployment',
  first_response_due: ago(-45), resolution_due: ago(-60 * 24), resolution_breached: false, remaining_us: 0, paused_us: 0,
  next_reply_completed: 0, next_reply_met: 0, policy: {}, ...extra };
}

function supportTickets() {
  return [
    { ticket: { id: TICKET_OPEN, subject: 'Deploys fail with npm ci', category: 'deployment', status: 'open', revision: 3,
      context: { deployment_id: DEPLOYMENT, request_id: 'req_7f3a' }, created_at: ago(120), updated_at: ago(20), can_reopen: false, unread_count: 2 },
    priority: 'high', episode: episode(), required_skills: ['node'], customer_reopens: 0 },
    { ticket: { id: TICKET_STAFF, subject: 'Your app checkout-api keeps running out of memory', category: 'deployment', status: 'pending', revision: 2,
      context: {}, created_at: ago(60 * 26), updated_at: ago(60 * 25), can_reopen: false },
    priority: 'normal', assignee_id: 'op-1', episode: episode({ priority: 'normal', first_response_at: ago(60 * 26), wait_since: ago(60 * 25) }),
    required_skills: [], customer_reopens: 0 },
  ];
}

function supportMessages() {
  return {
    [TICKET_OPEN]: [
      { id: 'm1', sequence: 1, author: 'customer', body: 'Every deploy of checkout-api fails at npm ci since this morning.', redacted: false, created_at: ago(120) },
      { id: 'm2', sequence: 2, author: 'note', body: 'Lockfile was generated with npm 11; see the deployment error.', redacted: false, created_at: ago(30) },
    ],
    [TICKET_STAFF]: [
      { id: 'm3', sequence: 1, author: 'staff', body: 'We noticed checkout-api was stopped for exceeding its memory limit.', redacted: false, created_at: ago(60 * 26) },
    ],
  };
}

function attentionSignal(id, accountId, kind, subject, state) {
  return { id, account_id: accountId, kind, subject, state, observed: 3, detail: kind === 'app_oom' ? 'OOM-killed 3 times; peak 512 MB of a 512 MB plan' : '',
    first_seen_at: ago(90), last_seen_at: ago(5), ...(state === 'dismissed' ? { dismissed_at: ago(10), outcome: 'false_positive' } : {}) };
}

const tenantRow = (id, email, plan, status, apps) => ({
  account_id: id, plan, status, is_personal: true, created_at: ago(60 * 24 * 40), mfa_enrolled: plan !== 'free',
  apps_count: apps, deployments_live_count: Math.max(0, apps - 1), email,
});

const deployment = (id, status, extra = {}) => ({
  id, app_id: APP_ID, app_slug: 'checkout-api', app_status: 'active', account_id: ACCOUNT, kind: 'git', status,
  source_bytes: 1048576, priority: 0, created_at: ago(14), ...extra,
});

const DISK_FULL = (available) => `vm spawn: builderd: create drive1: builderd: insufficient host free space for build drive: available=${available} bytes, required=21474836480 bytes`;
const NO_NODE_FITS = 'snapshot prime failed: sched: prime: create instance: capacity_unavailable: placement: no active compute_node fits 2056 MB billable across 2 candidates';

/** A crash log as apid records it: the guest's whole startup output, many lines long. */
const NGINX_CRASH = 'snapshot prime failed: sched: prime: cold boot: app_startup_crash: workload stopped during startup (guest e4946ae2-94a3-4d05-b841-623b672546ba exited before becoming ready): '
  + Array.from({ length: 3 }, (_, i) => `2026/10/25 08:03:1${i} [emerg] 67${i}#67${i}: mkdir() "/var/cache/nginx/client_temp" failed (30: Read-only file system) nginx: [emerg] mkdir() "/var/cache/nginx/client_temp" failed (30: Read-only file system) guest-init: sidecar web crashed (restart ${i + 1}/3): run sidecar web: exit status 1`).join(' ')
  + ' guest-init: app crash-looped after 3 restart(s): run sidecar web: exit status 1';

/** Failed deployments as production shows them: a few causes, repeated with only numbers changed. */
const failedDeployments = () => {
  const failed = (n, slug, minutesAgo, extra) =>
    deployment(`fa11ed${String(n).padStart(2, '0')}-0000-4000-8000-000000000000`, 'failed', { app_id: `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, app_slug: slug, kind: 'tarball', rollout_state: 'aborted', created_at: ago(minutesAgo), ...extra });
  return [
    failed(1, 'h14-fn', 60 * 30, { error: DISK_FULL(21436325888) }),
    failed(2, 'h14-py', 60 * 50, { error: DISK_FULL(19063808000) }),
    failed(3, 'my-first-api', 60 * 70, { error: DISK_FULL(20703383552), account_id: ACCOUNT2 }),
    failed(4, 'bazaar-grpc', 60 * 5, { error_code: 'capacity_unavailable', error: NO_NODE_FITS }),
    failed(5, 'h14-py', 60 * 80, { error_code: 'capacity_unavailable', error: NO_NODE_FITS }),
    failed(6, 'h14-fn', 60 * 90, { error: 'build exited 1' }),
    failed(7, 'h14-grpc', 60 * 95, { error: 'build exited 1' }),
    failed(8, 'h14-py', 60 * 40, { error: 'vm wait: builderd: destroy: rpc error: code = PermissionDenied desc = only schedd may call instance destruction' }),
    failed(9, 'h14-grpc', 60 * 100, { error_code: 'validation_failed', error: 'snapshot prime failed: sched: prime: cold boot: validation_failed: healthcheck_path and healthcheck_grpc are mutually exclusive' }),
    failed(10, 'h14-py', 60 * 110, { error_code: 'app_startup_crash', error: NGINX_CRASH }),
  ];
};

/** apid's status filter: omitted means in flight + failed, "all" means every status. */
function deploymentsFor(query) {
  const rows = [
    deployment('7a1b2c3d-0000-4000-8000-000000000001', 'building', { created_at: ago(180) }),
    deployment('7a1b2c3d-0000-4000-8000-000000000002', 'imaging', { created_at: ago(200) }),
    ...failedDeployments(),
  ];
  const status = query.get('status');
  const wanted = !status ? ['pending', 'building', 'imaging', 'snapshotting', 'failed'] : status === 'all' ? null : status.split(',');
  return wanted ? rows.filter((d) => wanted.includes(d.status)) : rows;
}

const depIncident = () => ({
  id: 'deployment/7a1b2c3d-0000-4000-8000-000000000001', type: 'deployment', severity: 'error', status: 'failed',
  summary: 'checkout-api deployment failed: build_failed', account_id: ACCOUNT, app_id: APP_ID,
  resource_id: '7a1b2c3d-0000-4000-8000-000000000001', resource_name: 'checkout-api', observed_at: ago(14),
  dedupe_key: 'deployment/dep-1', audit_path: `/v1/admin/obs/audit-log/search?kind_prefix=deployment.&target_account_id=${ACCOUNT}`,
});

const site = () => ({
  id: SITE_ID, account_id: 'op-1', project_id: 'gregale', environment: 'production', name: 'website', hostname: 'website.gregale.site',
  origin_id: 'origin-1', status: 'active', active_release_id: state.hosting.active, revision: state.hosting.revision, durable_routing: true,
  suspended: state.hosting.suspended, created_at: ago(60 * 24 * 30),
});

function siteRelease(id, releaseState, minutesAgo, extra = {}) {
  return {
    id, site_id: SITE_ID, state: releaseState, manifest: { files: [{ path: 'index.html' }, { path: 'app.js' }, { path: 'app.css' }], spa_fallback: true },
    artifact_bytes: 2_621_440, created_at: ago(minutesAgo), last_activity_at: ago(minutesAgo), ...extra,
  };
}

/** The hosted site's mutable state: writes change it, reads report it. */
function freshHosting() {
  return {
    revision: 7,
    active: SITE_RELEASE_LIVE,
    suspended: false,
    releases: [
      siteRelease(SITE_RELEASE_OLD, 'ready', 60 * 24 * 4, { first_promoted_at: ago(60 * 24 * 4), provenance: { repository: 'gregale/website', branch: 'main', commit_sha: '0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6' } }),
      siteRelease(SITE_RELEASE_LIVE, 'ready', 70, { first_promoted_at: ago(60), provenance: { repository: 'gregale/website', branch: 'main', commit_sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' } }),
      siteRelease(SITE_RELEASE_STAGED, 'pending', 30, { provenance: { repository: 'gregale/website', branch: 'redesign', commit_sha: 'c0ffee1234567890abcdef1234567890abcdef12' } }),
      // An upload abandoned two days ago: retention's first candidate.
      siteRelease(SITE_RELEASE_ABANDONED, 'pending', 60 * 48, { artifact_bytes: 1_048_576 }),
    ],
    // No stored policy yet: revision 0, off, the default 24-hour ages.
    retention: { revision: 0, enabled: false, pending_age_seconds: 86_400, staged_age_seconds: 86_400 },
    history: [
      { site_id: SITE_ID, revision: 7, previous_revision: 6, release_id: SITE_RELEASE_LIVE, previous_release_id: SITE_RELEASE_OLD, actor: { account_id: 'op-1' }, accepted_at: ago(60), provenance: { repository: 'gregale/website', branch: 'main', commit_sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' } },
      { site_id: SITE_ID, revision: 6, previous_revision: 5, release_id: SITE_RELEASE_OLD, actor: { account_id: 'op-1', key_id: 'k0000000-0000-4000-8000-000000000001' }, accepted_at: ago(60 * 24 * 4) },
    ],
    runs: [
      { run_id: RUN_OK, release_id: SITE_RELEASE_STAGED, preview_id: 'a7a00000-0000-4000-8000-000000000001', created_at: ago(30), preview_expires_at: ago(-60 * 23), can_cancel: true, state: 'pending', provenance: { repository: 'gregale/website', branch: 'redesign', commit_sha: 'c0ffee1234567890abcdef1234567890abcdef12' }, checks: [] },
      { run_id: RUN_EXPIRED, release_id: SITE_RELEASE_OLD, preview_id: 'a7b00000-0000-4000-8000-000000000002', created_at: ago(60 * 24 * 4), preview_expires_at: ago(60 * 24 * 3), state: 'blocked', checks: [] },
    ],
    previews: [
      { id: 'a7b00000-0000-4000-8000-000000000002', account_id: 'op-1', site_id: SITE_ID, release_id: SITE_RELEASE_OLD, hostname: 'main-b2b00000.preview.gregale.site', origin_id: 'origin-1', expires_at: ago(60 * 24 * 3), revoked: false, generation: 1, published_generation: 1, next_attempt_at: ago(60 * 24 * 4), created_at: ago(60 * 24 * 4) },
      { id: 'a7a00000-0000-4000-8000-000000000001', account_id: 'op-1', site_id: SITE_ID, release_id: SITE_RELEASE_STAGED, hostname: 'redesign-b1a00000.preview.gregale.site', origin_id: 'origin-1', expires_at: ago(-60 * 23), revoked: false, generation: 1, published_generation: 1, next_attempt_at: ago(29), created_at: ago(29) },
    ],
    domains: [
      { id: 'dd000000-0000-4000-8000-000000000001', account_id: 'op-1', site_id: SITE_ID, hostname: 'www.gregale.dev', provider_origin_id: 'po-1', challenge: '', state: 'active', revision: 2, generation: 2, published_generation: 2, published_at: ago(60 * 24 * 19), details: { tls_status: 'active', records: [], provider_id: '5b0c2a5e-0000-4000-8000-000000000001', create_started_at: ago(60 * 24 * 20), verified_at: ago(60 * 24 * 20) }, next_attempt_at: ago(60 * 24 * 19), attempts: 1, created_at: ago(60 * 24 * 20) },
      { id: 'dd000000-0000-4000-8000-000000000002', account_id: 'op-1', site_id: SITE_ID, hostname: 'docs.gregale.dev', provider_origin_id: 'po-1', challenge: 'a1b2c3', state: 'pending', revision: 1, generation: 1, published_generation: 0, details: { tls_status: 'pending_validation', records: [{ type: 'CNAME', name: 'docs.gregale.dev', value: 'website.gregale.site' }, { type: 'TXT', name: '_gregale-challenge.docs.gregale.dev', value: 'a1b2c3' }] }, next_attempt_at: ago(-10), attempts: 4, last_error_code: 'dns_not_found', created_at: ago(60 * 5) },
      // A hostname create whose response was lost: no provider ID, so it needs operator recovery.
      { id: 'dd000000-0000-4000-8000-000000000003', account_id: 'op-1', site_id: SITE_ID, hostname: 'shop.gregale.dev', provider_origin_id: 'po-1', challenge: 'd4e5f6', state: 'pending', revision: 3, generation: 1, published_generation: 0, details: { tls_status: '', records: [], create_started_at: ago(10), verified_at: ago(9) }, next_attempt_at: ago(-1), attempts: 1, last_error_code: 'provider_conflict', created_at: ago(11) },
    ],
  };
}

const MANIFEST_MAX_BYTES = 1_048_576;
const RETENTION_MIN = 3600;
const RETENTION_MAX = 30 * 86_400;
const reservedBytes = (release) => 2 * release.artifact_bytes + MANIFEST_MAX_BYTES;

const retentionPolicy = () => {
  const { revision, enabled, pending_age_seconds, staged_age_seconds, updated_at } = state.hosting.retention;
  return { site_id: SITE_ID, revision, enabled, pending_age_seconds, staged_age_seconds, ...(updated_at ? { updated_at } : {}) };
};

/** pkg/hosting cleanupEntry, for the mock's releases, previews and runs. */
function cleanupEntry(release, rules) {
  const entry = { release_id: release.id, state: release.state, eligible: false, reason: '', reserved_bytes: reservedBytes(release) };
  const at = Date.now();
  if (release.state === 'retiring') return { ...entry, reason: 'retirement_grace_period' };
  if (release.id === state.hosting.active) return { ...entry, reason: 'active_release' };
  if (release.first_promoted_at) return { ...entry, reason: 'previously_published' };
  const previews = state.hosting.previews.filter((p) => p.release_id === release.id);
  if (previews.some((p) => !p.revoked && Date.parse(p.expires_at) > at)) return { ...entry, reason: 'active_preview' };
  if (previews.length) return { ...entry, reason: 'preview_cleanup_pending' };
  const run = state.hosting.runs.find((r) => r.release_id === release.id && !r.canceled);
  if (run && Date.parse(run.preview_expires_at) > at) return { ...entry, reason: 'ci_retry_window' };
  if (release.state !== 'pending' && (release.state !== 'ready' || !run)) return { ...entry, reason: 'manual_staging' };
  const age = release.state === 'ready' ? rules.staged_age_seconds : rules.pending_age_seconds;
  const eligibleAt = new Date(Date.parse(release.last_activity_at) + age * 1000).toISOString();
  if (Date.parse(eligibleAt) > at) return { ...entry, reason: 'recent_activity', eligible_at: eligibleAt };
  return { ...entry, eligible: true, eligible_at: eligibleAt, reason: release.state === 'ready' ? 'expired_ci_release' : 'abandoned_upload' };
}

function cleanupPlan(override) {
  const policy = retentionPolicy();
  const rules = override ?? { pending_age_seconds: policy.pending_age_seconds, staged_age_seconds: policy.staged_age_seconds };
  const entries = state.hosting.releases.map((release) => cleanupEntry(release, rules));
  return {
    policy, rules, evaluated_at: now(), entries,
    proposed: rules.pending_age_seconds !== policy.pending_age_seconds || rules.staged_age_seconds !== policy.staged_age_seconds,
    reclaimable_reserved_bytes: entries.filter((e) => e.eligible).reduce((sum, e) => sum + e.reserved_bytes, 0),
    retiring_reserved_bytes: entries.filter((e) => e.state === 'retiring').reduce((sum, e) => sum + e.reserved_bytes, 0),
  };
}

/** The last 24 hours in hourly buckets: a daytime curve, a few 404s and one 503 spike. */
function siteTraffic() {
  const end = new Date();
  end.setUTCMinutes(0, 0, 0);
  const buckets = [];
  const failures = [];
  for (let i = 23; i >= 0; i--) {
    const start = new Date(end.getTime() - i * 3_600_000).toISOString();
    const requests = 400 + ((i * 37) % 11) * 60;
    const notFound = i % 6 === 0 ? 12 : 0;
    const unavailable = i === 3 ? 30 : 0;
    const hits = Math.round((requests - notFound - unavailable) * 0.8);
    buckets.push({ start, requests, payload_bytes: (requests - notFound - unavailable) * 24_576, cache_hits: hits, cache_misses: requests - notFound - unavailable - hits, client_errors: notFound, server_errors: unavailable });
    if (notFound) failures.push({ start, status: 404, code: 'hosting_file_not_found', requests: notFound });
    if (unavailable) failures.push({ start, status: 503, code: 'hosting_artifact_unavailable', requests: unavailable });
  }
  const total = (field) => buckets.reduce((sum, b) => sum + b[field], 0);
  return {
    site_id: SITE_ID, source: 'cloudflare_analytics_engine', approximate: true, period_start: buckets[0].start, period_end: end.toISOString(), observed_at: now(), max_sample_interval: 4,
    requests: total('requests'), payload_bytes: total('payload_bytes'), cache_hits: total('cache_hits'), cache_misses: total('cache_misses'), client_errors: total('client_errors'), server_errors: total('server_errors'),
    buckets, failures: failures.sort((a, b) => Date.parse(b.start) - Date.parse(a.start)),
  };
}

function hostingUsage() {
  const live = state.hosting.releases.filter((r) => r.state !== 'deleted');
  const sum = (rows, f) => rows.reduce((total, r) => total + f(r), 0);
  return {
    account_id: 'op-1', reserved_bytes: sum(live, reservedBytes), storage_limit_bytes: 64 * 1_048_576,
    payload_bytes: sum(live, (r) => r.artifact_bytes), ready_payload_bytes: sum(live.filter((r) => r.state === 'ready'), (r) => r.artifact_bytes),
    retiring_reserved_bytes: sum(live.filter((r) => r.state === 'retiring'), reservedBytes),
    pending_uploads: live.filter((r) => r.state === 'pending').length, pending_uploads_limit: 20, releases: live.length, observed_at: now(),
  };
}

const hostingCapabilities = () => ({
  staged_releases_supported: true, config_enabled: true, upload_base_url: 'https://uploads.mock.test',
  automation_enabled: true, automation_credentials_per_site: 5, ci_runs_per_site: 100, oidc_enabled: state.oidc, ci_setup_enabled: state.oidc,
  activity_enabled: true, activity_page_size: 50, cancellation_enabled: true, diagnostics_enabled: true,
  history_enabled: true, history_per_site: 50, history_page_size: 25,
  previews_enabled: true, previews_per_site: 10, preview_reservations_enabled: true,
  domains_enabled: true, domains_per_site: 5, domain_cname_target: 'edge.gregale.site',
  analytics_enabled: state.analytics, retention_enabled: state.retention,
  retention_age_default_seconds: 86_400, retention_age_min_seconds: RETENTION_MIN, retention_age_max_seconds: RETENTION_MAX,
  sites_per_account: 10, releases_per_site: 50, account_storage_max_bytes: 64 * 1_048_576, account_pending_uploads_max: 20,
});

const releaseConflict = () => problem(409, 'hosting_release_conflict', 'Hosting state changed', 'refresh the site revision; only ready releases can be promoted and active or preview-referenced releases cannot be retired');
const domainConflict = () => problem(409, 'hosting_domain_conflict', 'Domain state changed', 'refresh the domain; hostname reservations, current revisions, and an active durable site are required');
const check = (step, state, code, summary, action) => ({ step, state, code, summary, action });
const SERVING_NOT_CHECKED = check('serving', 'not_checked', 'serving_not_checked', 'Serving health, DNS, TLS and Access sign-in were not tested.', 'After publication, allow edge refresh and check the URL through the normal Access flow.');

function siteDiagnostics(runId) {
  const base = { site_id: SITE_ID, started_at: now(), observed_at: now(), serving_health: 'not_checked' };
  const site = check('site', 'ok', 'site_active', 'Site intent is active.', 'This does not establish that traffic is being served.');
  const publication = check('publication', 'pending', 'publication_pending', 'Generation 8 is not yet published.', 'Wait for the next attempt; do not change routing meanwhile.');
  if (!runId) {
    return { ...base, release_id: SITE_RELEASE_LIVE, retry_advice: 'none', checks: [site, check('release', 'ok', 'release_ready', 'The release is verified.', 'A verified release can remain staged; production promotion is a separate operator action.'), publication, SERVING_NOT_CHECKED] };
  }
  if (runId === RUN_EXPIRED) {
    return { ...base, run_id: runId, release_id: SITE_RELEASE_OLD, retry_advice: 'inspect_before_retry', checks: [site, check('run', 'blocked', 'run_expired', 'The original CI preview window has expired.', 'This run cannot extend or recreate its preview. Review retained resources before explicitly starting a new intent.'), publication, SERVING_NOT_CHECKED] };
  }
  if (runId === RUN_OK) {
    return { ...base, run_id: runId, release_id: SITE_RELEASE_STAGED, preview_id: 'a7a00000-0000-4000-8000-000000000001', retry_advice: 'none', checks: [site, check('run', 'ok', 'run_retained', 'The original CI intent is retained.', 'Keep this run ID, its unchanged files, source labels and original preview TTL.'), publication, SERVING_NOT_CHECKED] };
  }
  return { ...base, run_id: runId, retry_advice: 'inspect_before_retry', checks: [site, check('run', 'unknown', 'run_not_found', 'No retained intent was found for this site and run ID.', 'Confirm the exact site and run IDs from CI output before retrying or creating an intent.'), publication, SERVING_NOT_CHECKED] };
}

/** apid decodes these bodies with DisallowUnknownFields: an unexpected key is a 400. */
const unknownKeys = (body, allowed) => Object.keys(body || {}).filter((k) => !allowed.includes(k));

const queueIntent = (kind) => {
  const id = `intent-${Date.now()}-${state.intents.size}`;
  state.intents.set(id, { created: Date.now(), kind });
  return id;
};

function route(method, path, query, body) {
  const key = `${method} ${path}`;
  // requireAdminCredentialMutation: the same step-up policy as admin writes.
  const adminWrite =
    (path.startsWith('/v1/admin/') || /^\/v1\/internal\/hosting\/sites\/[^/]+\/(automation-credentials|oidc-trusts)/.test(path)) &&
    method !== 'GET' &&
    // Marking support notifications read needs only the trusted origin, not step-up.
    !/^\/v1\/admin\/support\/tickets\/[^/]+\/read$/.test(path);

  if (key === 'POST /__mock/reset') {
    state = freshState();
    return { status: 200, body: { ok: true } };
  }
  if (key === 'POST /__mock/state') {
    for (const name of ['enrolled', 'pendingSession', 'expired', 'oidc', 'hostingEnabled', 'analytics', 'retention']) if (name in (body || {})) state[name] = Boolean(body[name]);
    // Another operator changed the site, or its retention policy, after the page loaded.
    if ('siteRevision' in (body || {})) state.hosting.revision = Number(body.siteRevision);
    if ('retentionRevision' in (body || {})) state.hosting.retention.revision = Number(body.retentionRevision);
    return { status: 200, body: { enrolled: state.enrolled, expired: state.expired, oidc: state.oidc, siteRevision: state.hosting.revision } };
  }
  if (key === 'GET /__mock/requests') return { status: 200, body: state.requests };
  if (key === 'GET /healthz') return { status: 200, text: 'ok' };

  // hosting.HideDisabled: before authentication, every hosting route is "no such API route" while hosting is off.
  if (!state.hostingEnabled && /^\/v1\/internal\/hosting(\/|$)/.test(path)) return problem(404, 'not_found', 'Not found', 'no such API route');
  if (state.expired) return problem(401, 'session_expired', 'Session expired', 'the session is no longer valid');
  if (adminWrite && !state.enrolled) {
    // A fresh sign-in is mfa_pending: RequireMFA answers before the operator
    // enrollment gate and does not say "must enroll".
    if (state.pendingSession) return problem(403, 'mfa_required', 'MFA required', 'complete /v1/account/mfa/enroll or /v1/account/mfa/verify to access this route');
    return problem(403, 'mfa_required', 'MFA required', 'platform operators must enroll an authenticator: complete /v1/account/mfa/enroll and /v1/account/mfa/confirm');
  }
  if (key === 'POST /v1/account/mfa/verify' && !state.enrolled) {
    return problem(409, 'mfa_required', 'MFA setup incomplete', 'finish /v1/account/mfa/confirm before verifying or using recovery codes');
  }
  if (key === 'POST /v1/account/mfa/enroll') {
    if (state.enrolled) return problem(409, 'conflict', 'Already enrolled', 'an authenticator is already enrolled');
    return { status: 200, body: { otpauth_url: 'otpauth://totp/Gregale:operator@ops.test?secret=JBSWY3DPEHPK3PXP', secret: 'JBSWY3DPEHPK3PXP', qr_code_png_base64: PNG_1PX, recovery_codes: ['7KQ2-M9XP', 'R4TD-2WLN', 'H8VC-6QJZ', 'P3NB-K7FY'] } };
  }
  if (key === 'POST /v1/account/mfa/confirm') {
    // apid checks the current password before the code (confirmMFAFirstFactor).
    if (body?.current_password !== PASSWORD) return problem(401, 'invalid_credentials', 'Invalid credentials', 'invalid email or password');
    if (body?.totp !== TOTP || body?.csrf_token !== CSRF) return problem(401, 'mfa_invalid_code', 'Invalid code', 'the TOTP code did not match');
    state.enrolled = true;
    state.steppedUpAt = Date.now();
    return { status: 200, body: {} };
  }
  if (adminWrite && Date.now() - state.steppedUpAt > 5 * 60_000) {
    return problem(403, 'step_up_required', 'Step-up required', 'step-up MFA required for this action: complete /v1/account/mfa/verify to refresh');
  }

  switch (true) {
    /* ── Session ── */
    case key === 'GET /v1/account':
      return { status: 200, body: { id: 'op-1', email: 'operator@ops.test', plan: 'scale', status: 'active', limits: { plan: 'scale', ram_mb: 1024, max_concurrency: 20, deployed_apps: 100, included_gb_hours: 1500, app_layer_max_mb: 512 }, usage_gb_hours: 0, app_count: 0, github_install_id: null } };
    case key === 'GET /v1/auth/csrf':
      return { status: 200, body: { csrf_token: CSRF } };
    case key === 'POST /v1/auth/logout':
      return { status: 204 };
    case key === 'POST /v1/account/mfa/verify':
      if (body?.totp !== TOTP) return problem(401, 'mfa_invalid_code', 'Invalid code', 'the TOTP code did not match');
      state.steppedUpAt = Date.now();
      return { status: 200, body: {} };
    case key === 'GET /v1/auth/sessions':
      return { status: 200, body: { sessions: state.sessions } };
    case /^DELETE \/v1\/auth\/sessions\/[^/]+$/.test(key): {
      if (body?.csrf_token !== CSRF) return problem(400, 'csrf_mismatch', 'CSRF', 'csrf token mismatch');
      const id = path.split('/').pop();
      if (!state.sessions.some((s) => s.id === id)) return problem(404, 'not_found', 'Session not found', 'no session with that id for this account');
      state.sessions = state.sessions.filter((s) => s.id !== id);
      return { status: 204 };
    }
    case key === 'POST /v1/auth/sessions/revoke_all': {
      if (body?.csrf_token !== CSRF) return problem(400, 'csrf_mismatch', 'CSRF', 'csrf token mismatch');
      const revoked = state.sessions.filter((s) => !s.current_session).length;
      state.sessions = state.sessions.filter((s) => s.current_session);
      return { status: 200, body: { revoked } };
    }

    /* ── Fleet overview and health ── */
    case key === 'GET /v1/admin/obs/overview':
      return { status: 200, body: { generated_at: now(), totals: { accounts_active: 128, accounts_past_due: 3, accounts_suspended: 1, orgs_total: 40, apps_total: 312, instances_live: 57, instances_waking: 2, nodes_active: 2, nodes_inactive: 1, audit_events_24h: 4210 },
        top_rate_limited_accounts_24h: [{ account_id: ACCOUNT2, hits: 812 }], node_health: [{ name: 'node-a', active: true, last_heartbeat_at: ago(0.2), stale: false }, { name: 'node-c', active: false, last_heartbeat_at: ago(90), stale: true }], recent_failures_1h: [{ kind: 'deploy.failed', count: 4 }] } };
    case key === 'GET /v1/admin/obs/health':
      return { status: 200, body: { generated_at: now(), audit_log_write_total_5m: 120, audit_log_write_failures_5m: 0, alerts_firing: 1,
        signals: { audit_log_write_total_5m: { state: 'healthy', observed_at: now() }, audit_log_write_failures_5m: { state: 'healthy', observed_at: now() }, alerts_firing: { state: 'unavailable' } },
        alert_history: { state: 'current', collection_state: 'collected', diagnostics_path: '/v1/admin/obs/rule-health' },
        alert_retention: { state: 'current', expired_episodes: 0 } } };
    case key === 'GET /v1/admin/obs/rule-health':
      return { status: 200, body: { generated_at: now(), scope: 'loaded_rules', state: 'healthy', max_age_seconds: 300, clock_skew_tolerance_seconds: 30,
        totals: { rules: 12, groups: 3, healthy: 12, failed: 0, stale: 0, unavailable: 0, invalid: 0, invalid_groups: 0, invalid_clock: 0 },
        items: [], total_items: 0, limit: 200, truncated: false, limitations: [] } };
    case key === 'GET /v1/admin/obs/incidents/platform_alert/summary':
      return { status: 200, body: { as_of: now(), scope: 'retained_platform_alert_episodes', age_basis: 'episode_started_at',
        collection: { state: 'current', collection_state: 'collected', last_attempt_at: ago(1), last_success_at: ago(1) },
        retention: { state: 'current', as_of: now(), cutoff: ago(60 * 24 * 30), last_pruned_episodes: 0, expired_episodes: 0 },
        counts: { total: 3, firing: 1, unknown: 0, resolved: 1, needs_attention: 2 }, groups: [],
        oldest_unacknowledged: { incident_id: `platform_alert/${'a'.repeat(64)}`, status: 'firing', severity: 'critical', started_at: ago(42), age_seconds: 2520, evidence_path: '' },
        oldest_unowned: null } };

    /* ── Operator access probe (the console reads /v1/admin/config to confirm operator rights) ── */
    case key === 'GET /v1/admin/config':
      return { status: 200, body: { generated_at: now(), items: [] } };

    /* ── Tenants ── */
    case key === 'GET /v1/admin/obs/tenants':
      return { status: 200, body: { limit: Number(query.get('limit') || 100), next_cursor: '', items: [
        tenantRow(ACCOUNT, query.get('include_pii') ? 'ada@customer.test' : undefined, 'pro', state.suspended ? 'suspended' : 'active', 4),
        // Every account owns a personal org whose slug apid derives from the account ID.
        { ...tenantRow(ACCOUNT2, query.get('include_pii') ? 'grace@customer.test' : undefined, 'hobby', 'past_due', 2), org_slug: 'u-0123456789ab' },
      ].filter((t) => (!query.get('plan') || t.plan === query.get('plan')) && (!query.get('status') || t.status === query.get('status'))) } };
    case /^GET \/v1\/admin\/obs\/tenants\/[^/]+\/activity$/.test(key):
      return { status: 200, body: { account_id: ACCOUNT, generated_at: now(), limit: 50,
        invocations: [{ id: 'inv-1', app_id: 'app-1', app_slug: 'checkout-api', state: 'failed', source: 'http', method: 'POST', path: '/orders', outcome: 'error_5xx', attempts: 1, last_error: 'upstream timeout', created_at: ago(3) }],
        audit_events: [{ id: 'ev-1', at: ago(12), kind: 'deploy.succeeded', actor: 'ada@customer.test' }] } };
    case /^GET \/v1\/admin\/obs\/tenants\/[^/]+(\/360)?$/.test(key): {
      const detail = { account: tenantRow(ACCOUNT, query.get('include_pii') ? 'ada@customer.test' : undefined, 'pro', state.suspended ? 'suspended' : 'active', 2),
        apps: [{ id: 'app-1', slug: 'checkout-api', status: 'active', deployments: 18 }, { id: 'app-2', slug: 'nightly-report', status: 'evicted_cold', deployments: 3 }],
        orgs: [{ id: 'org-0', slug: 'u-1a2b3c4d5e6f', role: 'owner' }, { id: 'org-1', slug: 'ada-labs', role: 'owner' }], api_keys: { active: 2, revoked: 1 }, sessions: { active: 1, revoked: 4 } };
      if (!path.endsWith('/360')) return { status: 200, body: detail };
      return { status: 200, body: { ...detail,
        usage: { month: '2026-10', used_gb_hours: 212.5, included_gb_hours: 250, overage_gb_hours: 0, overage_cents: 0, used_cpu_hours: 40, used_egress_gb: 3.2, used_ingress_gb: 1.1, cold_boots: 37, requests: 1840221,
          apps: [{ app_id: 'app-1', app_slug: 'checkout-api', mb_seconds: 720000000, cpu_usec: 1, requests: 1800000, tx_bytes: 2e9, net_tx_bytes: 1e9, net_rx_bytes: 1e9, cold_boots: 30 }] },
        billing: { current_month_overage_cents: 0, active_credits_cents: 2500, invoices: [{ id: 'in_123', provider: 'polar', number: 'INV-0042', status: 'paid', currency: 'eur', period_start: ago(60 * 24 * 31), period_end: ago(60 * 24), total_cents: 2900, amount_paid_cents: 2900 }] },
        diagnosis: { generated_at: now(), healthy_domains: 1, enabled_flags: [],
          restrictions: [{ kind: 'account_past_due', since: ago(60 * 24) }],
          failed_deployments: [{ deployment_id: 'dep-9', app_id: 'app-1', app_slug: 'checkout-api', status: 'failed', error_code: 'build_failed', error: 'npm ci exited 1', hint: 'Pin the Node version in package.json', created_at: ago(40) }],
          domain_issues: [{ domain: 'shop.customer.test', app_slug: 'checkout-api', problem: 'certificate issuance failed', cert_status: 'failed', cert_last_error: 'CAA record forbids issuance' }],
          customer_errors: { window_hours: 24, total: 3, by_code: [{ code: 'api_key_revoked', count: 3, last_at: ago(5) }],
            recent: [{ occurred_at: ago(5), route: 'GET /v1/apps', code: 'api_key_revoked', request_id: 'req-123', trace_id: '4bf92f3577b34da6a3ce929d0e0e4736' }] },
          attention_signals: state.signals.filter((sig) => sig.account_id === ACCOUNT && sig.state === 'open') } } };
    }
    /* ── Support inbox ── */
    case key === 'GET /v1/admin/support/tickets': {
      const status = query.get('status');
      const search = (query.get('search') || '').toLowerCase();
      const assignee = query.get('assignee_id');
      const items = state.tickets.filter((t) => (!status || t.ticket.status === status) && (!assignee || t.assignee_id === assignee)
        && (!search || t.ticket.subject.toLowerCase().includes(search) || (state.messages[t.ticket.id] || []).some((m) => m.body.toLowerCase().includes(search))));
      return { status: 200, body: { items } };
    }
    case key === 'GET /v1/admin/support/notifications':
      return { status: 200, body: { items: state.unread ? [{ id: 'n1', sequence: 7, ticket_id: TICKET_OPEN, kind: 'customer_reply', created_at: ago(20) }] : [], unread_count: state.unread } };
    case /^POST \/v1\/admin\/support\/tickets\/[^/]+\/read$/.test(key): {
      const t = state.tickets.find((x) => x.ticket.id === path.split('/')[5]);
      if (t) t.ticket.unread_count = 0;
      state.unread = 0;
      return { status: 202, body: { ticket_id: path.split('/')[5], unread_count: 0, unread_total: 0 } };
    }
    case /^GET \/v1\/admin\/support\/tickets\/[^/]+(\/messages|\/customer)?$/.test(key): {
      const id = path.split('/')[5];
      const t = state.tickets.find((x) => x.ticket.id === id);
      if (!t) return problem(404, 'support_not_found', 'Support resource not found', 'The ticket does not exist or is not visible.');
      if (path.endsWith('/messages')) return { status: 200, body: { items: state.messages[id] || [] } };
      if (path.endsWith('/customer')) {
        return { status: 200, body: { ticket_id: id, account_id: ACCOUNT, plan: 'pro', status: 'past_due', apps: 3, added: ['email_unverified'],
          diagnosis: { generated_at: now(), restrictions: [{ kind: 'account_past_due', reason: 'invoice unpaid' }, { kind: 'email_unverified' }],
            failed_deployments: [{ deployment_id: DEPLOYMENT, app_id: APP_ID, app_slug: 'checkout-api', status: 'failed', error_code: 'build_failed', error: 'npm ci exited 1', created_at: ago(40) }],
            domain_issues: [], healthy_domains: 1, enabled_flags: [], customer_errors: { window_hours: 24, total: 0, by_code: [], recent: [] }, attention_signals: [] },
          ...(id === TICKET_OPEN ? { snapshot: { captured_at: ago(120), plan: 'pro', status: 'past_due', request_id: 'req_7f3a',
            request: { occurred_at: ago(125), route: 'POST /v1/apps/{app}/deployments', code: 'deploy_failed', trace_id: '4bf92f3577b34da6a3ce929d0e0e4736' },
            health: { generated_at: ago(120), attention: 1, restrictions: [{ kind: 'account_past_due', title: 'A payment failed', detail: 'Update your payment method.' }], signals: [] } } } : {}) } };
      }
      return { status: 200, body: t };
    }
    case /^POST \/v1\/admin\/support\/tickets\/[^/]+\/(messages|notes|close|reopen|pause|resume|triage)$/.test(key): {
      const id = path.split('/')[5];
      const op = path.split('/')[6];
      const t = state.tickets.find((x) => x.ticket.id === id);
      if (!t) return problem(404, 'support_not_found', 'Support resource not found', 'The ticket does not exist or is not visible.');
      if (body?.expected_revision !== t.ticket.revision) return problem(409, 'support_conflict', 'Support conflict', 'ticket revision changed; reload before applying this action');
      const msgs = (state.messages[id] = state.messages[id] || []);
      const add = (author) => msgs.push({ id: `m${msgs.length + 10}`, sequence: msgs.length + 1, author, body: body.body, redacted: false, created_at: now() });
      if ((op === 'messages' || op === 'notes' || op === 'reopen') && !body?.body) return problem(400, 'support_invalid', 'Invalid support request', 'body is required');
      if (op === 'messages') { add('staff'); t.episode.first_response_at = t.episode.first_response_at || now(); }
      if (op === 'notes') add('note');
      if (op === 'close') { t.ticket.status = 'resolved'; t.ticket.resolved_at = now(); }
      if (op === 'reopen') { add('staff'); t.ticket.status = 'open'; }
      if (op === 'pause') { t.ticket.status = 'pending'; t.episode.wait_since = now(); }
      if (op === 'resume') { t.ticket.status = 'open'; delete t.episode.wait_since; }
      if (op === 'triage') {
        if (!body?.reason) return problem(400, 'support_invalid', 'Invalid support request', 'handoff requires a reason, priority and valid skills');
        t.priority = body.priority;
        if (body.assignee_id) t.assignee_id = body.assignee_id; else delete t.assignee_id;
        t.required_skills = body.required_skills || [];
      }
      t.ticket.revision += 1;
      t.ticket.updated_at = now();
      return { status: 202, body: { ticket_id: id, submission_id: `s${t.ticket.revision}`, revision: t.ticket.revision } };
    }
    case key === 'GET /v1/admin/obs/attention/summary':
      return { status: 200, body: { window_days: 30, items: [
        { kind: 'deploy_failing', total: 12, open: 3, contacted: 5, false_positive: 1, other_dismissed: 2, resolved_on_own: 1, false_positive_percent: 12, median_act_seconds: 5400 },
        { kind: 'app_oom', total: 4, open: 4, contacted: 0, false_positive: 0, other_dismissed: 0, resolved_on_own: 0, false_positive_percent: -1 },
        { kind: 'crons_failing', total: 3, open: 0, contacted: 0, false_positive: 0, other_dismissed: 0, resolved_on_own: 1, no_outcome: 2, false_positive_percent: -1 },
      ] } };
    case /^GET \/v1\/admin\/obs\/attention\/\d+\/contact-draft$/.test(key): {
      const sig = state.signals.find((x) => String(x.id) === path.split('/')[5]);
      if (!sig) return problem(404, 'not_found', 'Signal not found', 'no attention signal has this id');
      if (sig.state !== 'open') return problem(409, 'conflict', 'Signal not open', 'This signal was already handled or resolved.');
      return { status: 200, body: { subject: `Your app ${sig.subject} keeps running out of memory`, category: 'deployment',
        body: `We noticed ${sig.subject} was stopped for exceeding its memory limit. Reply here and we will help.`,
        categories: ['deployment', 'billing', 'account', 'incident', 'other'], subject_max: 200, body_max: 10000 } };
    }
    case /^POST \/v1\/admin\/obs\/attention\/\d+\/(dismiss|contact)$/.test(key): {
      const sig = state.signals.find((x) => String(x.id) === path.split('/')[5]);
      if (!sig) return problem(404, 'not_found', 'Signal not found', 'no attention signal has this id');
      if (sig.state !== 'open') return problem(409, 'conflict', 'Signal not open', 'This signal was already handled or resolved.');
      const contact = path.endsWith('/contact');
      if (!contact && !['platform_issue', 'already_in_touch', 'not_needed', 'false_positive'].includes(body?.outcome)) {
        return problem(400, 'validation_failed', 'Invalid input', 'Pick an outcome.');
      }
      Object.assign(sig, { state: 'dismissed', dismissed_at: now(), outcome: contact ? 'contacted' : body.outcome,
        dismiss_reason: contact ? '' : (body.note || ''), ...(contact ? { ticket_id: 't0000000-0000-4000-8000-000000000042' } : {}) });
      return { status: 200, body: { signal: sig, ...(contact ? { ticket_id: sig.ticket_id } : {}) } };
    }
    case /^GET \/v1\/admin\/obs\/tenants\/[^/]+\/health$/.test(key):
      return { status: 200, body: { generated_at: now(), attention: 2,
        restrictions: [{ kind: 'account_past_due', title: 'A payment failed', detail: 'Update your payment method before the grace period ends to keep your apps running.', action: 'Update payment method', action_url: '/dashboard/billing' }],
        signals: state.signals.filter((sig) => sig.account_id === ACCOUNT && sig.state === 'open' && sig.kind === 'app_oom')
          .map((sig) => ({ kind: sig.kind, subject: sig.subject, title: `${sig.subject} keeps running out of memory`, detail: 'It was stopped for exceeding its memory limit 3 times in the last 24 hours.', action: 'Compare plans', action_url: '/dashboard/billing', since: sig.first_seen_at })),
        failed_deployments: [], domain_issues: [], refused_requests: { window_hours: 24, total: 0, by_code: [], recent: [] } } };
    case key === 'GET /v1/admin/obs/lookup': {
      const q = (query.get('q') || '').trim();
      const matches = q === 'ada@customer.test' ? [{ kind: 'account', account_id: ACCOUNT, detail: 'email' }]
        : q === 'checkout-api' ? [{ kind: 'app', account_id: ACCOUNT, app_id: 'app-1', app_slug: 'checkout-api', detail: 'app slug' }]
        : [];
      return { status: 200, body: { query: q, matches } };
    }
    case key === 'GET /v1/admin/obs/attention': {
      const all = state.signals;
      const st = query.get('state');
      const items = all.filter((s) => (!query.get('kind') || s.kind === query.get('kind'))
        && (!st ? s.state !== 'resolved' : s.state === st) && (!query.get('account_id') || s.account_id === query.get('account_id')));
      return { status: 200, body: { items, limit: Number(query.get('limit') || 200) } };
    }
    case /^GET \/v1\/admin\/obs\/apps\/[^/]+$/.test(key):
      return { status: 200, body: { app: { id: path.split('/').pop(), account_id: ACCOUNT, slug: 'checkout-api', type: 'service', runtime: 'node22', status: 'active', max_concurrency: 10, min_instances: 0 },
        deployments: [], invocations: [
          { id: 'inv-1', app_id: 'app-1', app_slug: 'checkout-api', state: 'completed', source: 'queue', method: 'POST', path: '/jobs/resize', outcome: 'succeeded', attempts: 1, created_at: ago(3), instance_id: 'c0ffee00-0000-4000-8000-000000000001' },
          { id: 'inv-2', app_id: 'app-1', app_slug: 'checkout-api', state: 'completed', source: 'queue', method: 'POST', path: '/jobs/other', outcome: 'succeeded', attempts: 1, created_at: ago(4), instance_id: 'c0ffee00-0000-4000-8000-000000000002' },
        ],
        instances: [
          { id: 'c0ffee00-0000-4000-8000-000000000001', app_id: 'app-1', app_slug: 'checkout-api', deployment_id: 'dep-1', node_name: 'node-a', state: 'running', ram_mb: 256, started_at: ago(30), last_request_at: ago(1) },
          { id: 'c0ffee00-0000-4000-8000-000000000002', app_id: 'app-1', app_slug: 'checkout-api', deployment_id: 'dep-1', node_name: 'node-b', state: 'waking', ram_mb: 256, started_at: ago(1), last_request_at: ago(1) },
          { id: 'c0ffee00-0000-4000-8000-000000000003', app_id: 'app-1', app_slug: 'checkout-api', deployment_id: 'dep-1', node_name: 'node-a', state: 'parked', ram_mb: 0, started_at: ago(300), last_request_at: ago(240) },
        ],
        health: { metrics: { range: '1h', request_count: 1840, latency_p95_ms: 212, error_rate_pct: 0.4, queue_depth: 0, source: 'prometheus' }, errors: [] } } };
    case /^POST \/v1\/admin\/ops\/accounts\/[^/]+\/(suspend|restore|revoke-sessions)$/.test(key): {
      const action = path.split('/').pop();
      if (action === 'suspend') state.suspended = true;
      if (action === 'restore') state.suspended = false;
      return { status: 200, body: { account: tenantRow(ACCOUNT, undefined, 'pro', state.suspended ? 'suspended' : 'active', 2), action, revoked_sessions: action === 'restore' ? 0 : 1 } };
    }

    /* ── Compute nodes ── */
    case key === 'GET /v1/admin/obs/nodes':
      return { status: 200, body: { limit: 50, next_cursor: '', items: [
        { id: 'n1', name: 'node-a', active: true, vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, instances_live: 41, instances_running: 30, instances_waking: 1, instances_cold_booting: 0, ram_used_mb: 30210, admission_margin_mb: 25495, cpu_pct_60s: 37.5, overlay_ip: '10.8.0.2', last_heartbeat_at: ago(0.1), created_at: ago(60 * 24 * 90) },
        { id: 'n2', name: 'node-b', active: true, vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, instances_live: 12, instances_running: 10, instances_waking: 0, instances_cold_booting: 0, ram_used_mb: 9100, admission_margin_mb: 46605, cpu_pct_60s: 12.1, overlay_ip: '10.8.0.3', last_heartbeat_at: ago(0.2), created_at: ago(60 * 24 * 60) },
        { id: 'n3', name: 'node-c', active: false, vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, instances_live: 0, instances_running: 0, instances_waking: 0, instances_cold_booting: 0, ram_used_mb: 0, admission_margin_mb: 55705, last_heartbeat_at: '0001-01-01T00:00:00Z', created_at: ago(60 * 24 * 20) },
      ] } };
    /* ── Fleet instances (ADR-20261121161842) ── */
    case key === 'GET /v1/admin/obs/instances': {
      const fleet = [
        { id: 'c0ffee00-0000-4000-8000-000000000001', app_id: 'app-1', app_slug: 'checkout-api', account_id: ACCOUNT, deployment_id: DEPLOYMENT, node_id: 'n1', node_name: 'node-a', state: 'running', ram_mb: 256, started_at: ago(30), last_request_at: ago(1), wake_id: 'wake-0001-checkout' },
        { id: 'c0ffee00-0000-4000-8000-000000000004', app_id: 'app-9', app_slug: 'blog', account_id: ACCOUNT2, deployment_id: 'dep-9', node_id: 'n2', node_name: 'node-b', state: 'running', ram_mb: 512, started_at: ago(90), last_request_at: ago(20) },
        { id: 'c0ffee00-0000-4000-8000-000000000005', app_id: 'app-9', app_slug: 'blog', account_id: ACCOUNT2, deployment_id: 'dep-9', node_id: 'n2', node_name: 'node-b', state: 'frozen', ram_mb: 512, started_at: ago(200), last_request_at: ago(150) },
      ];
      const items = fleet.filter((i) => (query.get('state') === 'resident' || i.state === 'running')
        && (!query.get('node') || i.node_name === query.get('node')) && (!query.get('account_id') || i.account_id === query.get('account_id'))
        && (!query.get('app_id') || i.app_id === query.get('app_id')));
      return { status: 200, body: { items, limit: 200, truncated: false } };
    }
    case /^GET \/v1\/admin\/obs\/instances\/[^/]+$/.test(key): {
      const id = path.split('/').pop();
      if (id !== 'c0ffee00-0000-4000-8000-000000000001') return problem(404, 'not_found', 'Instance not found', 'no instance has this id');
      return { status: 200, body: { id, app_id: 'app-1', app_slug: 'checkout-api', account_id: ACCOUNT, deployment_id: DEPLOYMENT, node_id: 'n1', node_name: 'node-a', state: 'running', ram_mb: 256, started_at: ago(30), last_request_at: ago(1), wake_id: 'wake-0001-checkout' } };
    }
    case key === 'GET /v1/admin/obs/wakes/wake-0001-checkout':
      return { status: 200, body: { wake_id: 'wake-0001-checkout', subject: 'checkout-api', truncated: false, events: [
        { at: new Date(Date.now() - 30 * 60_000).toISOString(), kind: 'wake.requested' },
        { at: new Date(Date.now() - 30 * 60_000 + 40).toISOString(), kind: 'wake.snapshot_restore_started' },
        { at: new Date(Date.now() - 30 * 60_000 + 212).toISOString(), kind: 'wake.ready' },
      ] } };
    /* ── Disk pressure (ADR-20261124150000) ── */
    case key === 'GET /v1/admin/obs/disk-pressure': {
      const GB = 1024 ** 3;
      const fs = (node, role, mountpoint, size, avail, extra = {}) => ({ node, role, mountpoint, device: '/dev/nvme0n1p2', fstype: 'ext4',
        size_bytes: size * GB, avail_bytes: avail * GB, free_percent: Math.round((avail / size) * 1000) / 10, state: 'ok', ...extra });
      return { status: 200, body: {
        as_of: ago(0), source: 'observed', failed_queries: [], critical_free_percent: 5, low_free_percent: 15, filling_free_percent: 25,
        filling_horizon_hours: 4, inodes_low_free_percent: 10, growth_window_seconds: 21600, truncated: false,
        totals: { nodes: 4, nodes_critical: 0, nodes_filling: 1, nodes_low: 1, nodes_inodes_low: 0, nodes_unknown: 1, filesystems: 4,
          jail_tmpfs_used_bytes: 2 * GB, guests_near_full: 2, guests_full: 1 },
        nodes: [
          { node: 'fsn-2', role: 'compute', state: 'filling', filesystems: 2, worst_mountpoint: '/srv/fc', worst_free_percent: 20,
            jail_tmpfs_used_bytes: 0, journal_bytes: 3 * GB, guests_near_full: 2, guests_full: 1 },
          { node: 'control-plane', role: 'control_plane', state: 'low', filesystems: 1, worst_mountpoint: '/', worst_free_percent: 10,
            jail_tmpfs_used_bytes: 0, guests_near_full: 0, guests_full: 0 },
          { node: 'fsn-3', role: 'compute', state: 'ok', filesystems: 1, worst_mountpoint: '/', worst_free_percent: 60,
            jail_tmpfs_used_bytes: 2 * GB, journal_bytes: 1 * GB, guests_near_full: 0, guests_full: 0 },
          { node: 'db-1', role: 'database', state: 'unknown', filesystems: 0, worst_free_percent: 0,
            jail_tmpfs_used_bytes: 0, journal_bytes: 1 * GB, guests_near_full: 0, guests_full: 0 },
        ],
        filesystems: [
          fs('fsn-2', 'compute', '/srv/fc', 400, 80, { fstype: 'xfs', state: 'filling', hours_to_full: 2.5, inodes_free_percent: 92 }),
          fs('control-plane', 'control_plane', '/', 50, 5, { state: 'low', inodes_free_percent: 70 }),
          fs('fsn-2', 'compute', '/', 100, 60, { inodes_free_percent: 90 }),
          fs('fsn-3', 'compute', '/', 100, 60, { inodes_free_percent: 80, hours_to_full: 100 }),
          fs('fsn-3', 'compute', '/srv/fc/jail', 8, 6, { fstype: 'tmpfs', device: 'tmpfs', jail_tmpfs: true, state: 'ram' }),
          { node: 'fsn-4', role: 'compute', mountpoint: '/', device: '/dev/sda1', fstype: 'ext4', size_bytes: 100 * GB, state: 'unknown' },
        ],
        guests: [
          { instance_id: 'ins-disk-1', app_id: 'app-blog', app_slug: 'blog', account_id: ACCOUNT, node: 'fsn-2',
            used_bytes: 1.94 * GB, capacity_bytes: 2 * GB, used_percent: 97 },
          { instance_id: 'ins-disk-2', node: 'fsn-2', used_bytes: 0, capacity_bytes: 0, used_percent: 88 },
        ],
      } };
    }
    /* ── Control-plane health (ADR-20261126120000) ── */
    case key === 'GET /v1/admin/obs/control-plane': {
      const check = (key, group, label, state, detail, extra = {}) => ({ key, group, label, state, detail, unit: 'seconds', ...extra });
      return { status: 200, body: {
        as_of: ago(0), source: 'observed', failed_queries: [], window_seconds: 3600, state: 'critical',
        totals: { checks: 8, critical: 1, warning: 2, unknown: 0 },
        checks: [
          check('activity_collector', 'postgres', 'Postgres stats collector', 'ok', 'ran 40 s ago', { warn_at: 300 }),
          check('connections', 'postgres', 'Postgres connections', 'warning', '150 of 185', { unit: 'percent', value: 81.1, warn_at: 75, critical_at: 90, alert: 'FaasPostgresConnectionsHigh' }),
          check('oldest_transaction', 'postgres', 'Oldest open transaction', 'ok', '0 s', { warn_at: 600 }),
          check('base_backup', 'backups', 'Postgres base backup pushed', 'ok', '7.0 h ago', { warn_at: 93600, at: ago(7 * 3600_000) }),
          check('wal_archive', 'backups', 'Postgres WAL archived', 'warning', '20 min ago', { warn_at: 600, alert: 'PgWalArchiveStalled' }),
          check('notification_outbox', 'delivery', 'Oldest undelivered notification', 'ok', '0 undelivered', { warn_at: 900 }),
          check('db_pools', 'daemons', 'Daemon database pools', 'critical', 'acquires canceled: schedd@fsn-2', { unit: 'count', warn_at: 90, alert: 'FaasDBPoolStarved' }),
          check('targets', 'daemons', 'Control-plane daemons scraped', 'ok', '12 of 12 up', { unit: 'count' }),
        ],
        postgres: { client_connections: 150, connection_capacity: 185, database_size_bytes: 3934272535, longest_query_seconds: 2,
          oldest_transaction_seconds: 0, idle_in_transaction_max_seconds: 0, cache_hit_percent: 99.6, commits_per_second: 304.2,
          rollback_percent: 3.5, temp_bytes: 7458264, collector_age_seconds: 40 },
        backends: [{ application: 'faas-apid', state: 'idle', count: 10 }, { application: 'faas-meterd', state: 'idle', count: 5 }],
        statements: [
          { query_id: '813', query: 'with tracking as (select tracked_from from usage_month_totals_tracking) select $1', exec_seconds: 9.9, calls: 1371, mean_ms: 7.25 },
          { query_id: '396', query: 'select count(*) from snapshots where app_id = $1', exec_seconds: 3.9 },
        ],
        pools: [
          { pool: 'schedd', job: 'schedd', node: 'fsn-2', acquired: 16, idle: 0, max: 16, utilization_percent: 100, canceled_acquires: 4, mean_acquire_wait_ms: 12.5, state: 'critical' },
          { pool: 'apid', job: 'apid', acquired: 1, idle: 11, max: 12, utilization_percent: 8.3, canceled_acquires: 0, mean_acquire_wait_ms: 0, state: 'ok' },
        ],
        notify_hubs: [
          { hub: 'apid', job: 'apid', conns: 1, subscribers: 11, reconnects: 0, state: 'ok' },
          { hub: 'schedd', job: 'schedd', node: 'fsn-3', conns: 0, subscribers: 6, reconnects: 3, state: 'warning' },
        ],
        targets: [{ job: 'apid', instance: '127.0.0.1:9091', up: true }],
        host: { cpus: 12, load1: 0.44, mem_total_bytes: 33534414848, mem_available_bytes: 28269838336 },
      } };
    }
    /* ── Egress denials (ADR-20261127100000) ── */
    case key === 'GET /v1/admin/obs/egress': {
      return { status: 200, body: {
        as_of: ago(0), window_seconds: 86400, source: 'partial', failed_queries: ['dns_blocked'],
        totals: { denied: 6143, denied_last_hour: 12, apps_denied: 13, new_destinations: 1913, abuse_recycles: 2, abuse_holds: 1,
          cpu_abuse_signals: 3, dns_blocked: 0, scan_blocked: 1, scan_flagged: 0, flow_log_rows: 7398 },
        classes: [{ key: 'unresolved', count: 3877 }, { key: 'rfc1918', count: 2226 }, { key: 'smtp', count: 40 }],
        nodes: [{ key: 'bhs-3.faas', count: 5060 }, { key: 'bhs-2.faas', count: 1083 }],
        apps: [
          { app_id: 'app-miner', app_slug: 'miner-app', account_id: ACCOUNT2, denied: 40, classes: [{ key: 'smtp', count: 40 }], new_destinations: 380, abuse_recycles: 2 },
          { app_id: 'app-blog', app_slug: 'blog', account_id: ACCOUNT, denied: 3779, classes: [{ key: 'unresolved', count: 3779 }], new_destinations: 0, abuse_recycles: 0 },
        ],
        recycles: [{ app_id: 'app-miner', app_slug: 'miner-app', account_id: ACCOUNT2, reason: 'fanout', count: 2 }],
        holds: [{ key: 'egress_abuse', count: 1 }],
        cpu_signals: [{ plan: 'free', action: 'throttle', count: 3 }],
        dns_blocked: [],
        scan_findings: [{ category: 'miner', action: 'block', count: 1 }],
        denylist: [{ source: 'firewall', cidr: '203.0.113.0/24', count: 5 }],
      } };
    }
    /* ── Gateway traffic (ADR-20261124093000) ── */
    case key === 'GET /v1/admin/obs/gateway-traffic': {
      return { status: 200, body: {
        as_of: ago(0), window_seconds: 3600, source: 'partial', failed_queries: ['overload_by_node'],
        totals: { nodes: 2, requests: 12840, status_2xx: 12100, status_3xx: 40, status_4xx: 520, status_5xx: 180, status_429: 90,
          status_502: 20, status_503: 150, status_504: 10, error_rate_percent: 1.4, platform_errors: 160, platform_error_rate_percent: 1.25,
          capacity_refusals: 60, wakes_admitted: 400, wake_app_queue_full: 12, wake_gateway_queue_full: 0, wake_queue_timeouts: 3,
          held_now: 7, admission_leaders_now: 1 },
        nodes: [
          { node: 'fsn-2', requests: 9000, status_5xx: 170, error_rate_percent: 1.89, platform_errors: 155, capacity_refusals: 60, held_now: 7 },
          { node: 'fsn-3', requests: 3840, status_5xx: 10, error_rate_percent: 0.26, platform_errors: 5, capacity_refusals: 0, held_now: 0 },
        ],
        statuses: [{ code: '200', count: 12100 }, { code: '304', count: 40 }, { code: '404', count: 430 }, { code: '429', count: 90 }, { code: '502', count: 20 }, { code: '503', count: 150 }, { code: '504', count: 10 }],
        wake_admission: [
          { plan: 'hobby', outcome: 'admitted', count: 400 },
          { plan: 'hobby', outcome: 'app_queue_full', count: 12 },
          { plan: 'free', outcome: 'queue_timeout', count: 3 },
        ],
        edge_rejections: [{ kind: 'limit', status: '429', count: 30 }, { kind: 'waf', status: '403', count: 4 }],
        edge_refusals: [{ reason: 'request_rate', count: 8 }],
        retry_exhausted: [],
        apps: [
          { app_id: 'app-blog', app_slug: 'blog', account_id: ACCOUNT, plan: 'hobby', requests: 1200, status_5xx: 150, status_502: 0, status_503: 150, status_504: 0,
            error_rate_percent: 12.5, platform_errors: 150, capacity_refusals: 0, held_now: 7 },
          { app_id: '-', unknown_host: true, requests: 0, status_5xx: 0, status_502: 0, status_503: 0, status_504: 0, error_rate_percent: 0,
            platform_errors: 0, capacity_refusals: 0, held_now: 0 },
          { app_id: 'app-api', app_slug: 'api', account_id: ACCOUNT2, plan: 'pro', requests: 900, status_5xx: 0, status_502: 0, status_503: 0, status_504: 0,
            error_rate_percent: 0, platform_errors: 0, capacity_refusals: 60, held_now: 0 },
        ],
      } };
    }
    /* ── Memory pressure (ADR-20261123190507) ── */
    case key === 'GET /v1/admin/obs/memory-pressure': {
      const n = (id, name, state, measured, booked, extra = {}) => ({ node_id: id, name, active: true, state, mem_mb: 65536, ceiling_mb: 47600,
        booked_mb: booked, booked_limit_mb: 119000, measured_mb: measured - 2000, used_mb: measured, measured_at: ago(2), measurement_age_seconds: 2,
        running: 9, waking: 0, cold_booting: 0, frozen: 4, evictions: 0, frozen_parks: 0, oom_kills: 0, ...extra });
      return { status: 200, body: {
        as_of: ago(0), window_seconds: 86400, overcommit_percent: 250, eviction_target_percent: 90, measurement_stale_seconds: 30, truncated: false,
        totals: { nodes: 3, nodes_over: 1, nodes_near: 0, nodes_stale: 1, ceiling_mb: 142800, measured_mb: 64000, used_mb: 68000, booked_mb: 150000,
          running: 18, frozen: 8, evictions: 3, frozen_parks: 2, oom_kills: 4, apps_affected: 3 },
        nodes: [
          n('n2', 'fsn-2', 'over', 48100, 98000, { evictions: 3, frozen_parks: 2, oom_kills: 1 }),
          n('n4', 'fsn-4', 'stale', 30000, 40000, { measured_at: ago(300), measurement_age_seconds: 300 }),
          n('n3', 'fsn-3', 'ok', 19900, 12000, { oom_kills: 3 }),
        ],
        reasons: [{ kind: 'oom_kill', reason: '', count: 4 }, { kind: 'eviction', reason: 'measured_memory', count: 3 }, { kind: 'frozen_park', reason: 'memory_pressure', count: 2 }],
        apps: [
          { app_id: 'app-big', app_slug: 'big-node', account_id: ACCOUNT2, plan: 'hobby', evictions: 0, frozen_parks: 0, oom_kills: 3, max_peak_mb: 640, plan_mb: 512, last_at: ago(120) },
          { app_id: 'app-blog', app_slug: 'blog', account_id: ACCOUNT, plan: 'pro', evictions: 2, frozen_parks: 1, oom_kills: 0, last_at: ago(600) },
        ],
        events: [
          { at: ago(120), kind: 'oom_kill', instance_id: 'ins-oom-1', app_id: 'app-big', app_slug: 'big-node', account_id: ACCOUNT2, plan: 'hobby', node_id: 'n3', node_name: 'fsn-3', ram_mb: 512, peak_mb: 640, plan_mb: 512, deployment_failed: true },
          { at: ago(600), kind: 'eviction', reason: 'measured_memory', instance_id: 'ins-ev-1', app_id: 'app-blog', app_slug: 'blog', account_id: ACCOUNT, plan: 'pro', node_id: 'n2', node_name: 'fsn-2', ram_mb: 1024 },
        ],
      } };
    }
    /* ── Build queue (ADR-20261123163340) ── */
    case key === 'GET /v1/admin/obs/build-queue': {
      const b = (id, slug, account, kind, status, extra = {}) => ({ id, deployment_id: `dep-${id}`, app_id: `app-${id}`, app_slug: slug, account_id: account,
        kind, status, source_bytes: 3 * 1024 * 1024, preemptions: 0, coalesced: false, enqueued_at: ago(60 * 20), wait_seconds: 0, duration_seconds: 0, ...extra });
      return { status: 200, body: {
        as_of: ago(0), window_seconds: 86400, build_timeout_seconds: 900, wait_warn_seconds: 300,
        active_truncated: false, finished_truncated: false, slots_state: 'observed',
        totals: { queued: 3, deferred: 1, held: 1, running: 2, oldest_wait_seconds: 1260, waiting_over_warn: 1, running_over_timeout: 1,
          finished: 40, succeeded: 34, failed: 5, cancelled: 1, duration_p50_seconds: 95, duration_p95_seconds: 610,
          wait_p50_seconds: 4, wait_p95_seconds: 140, cache_hits: 20, cache_misses: 15, cache_invalidated: 5, preempted: 2 },
        kinds: [{ kind: 'railpack', queued: 1, running: 1, finished: 30, failed: 4, duration_p95_seconds: 640 }, { kind: 'dockerfile', queued: 1, running: 1, finished: 10, failed: 1, duration_p95_seconds: 300 }],
        failures: [{ class: 'oom', count: 3 }, { class: 'timeout', count: 1 }, { class: 'unclassified', count: 1 }],
        nodes: [
          { node: 'fsn-2', running_builds: 2, observed: true, conflicting: false, limit: 3, reserved: 1, in_use: 3, active_reserved: 2, opportunistic: 1, active_borrowed: 1 },
          { node: 'fsn-3', running_builds: 0, observed: true, conflicting: false, limit: 2, reserved: 1, in_use: 0, active_reserved: 0, opportunistic: 0, active_borrowed: 0 },
          { node: 'fsn-4', running_builds: 0, observed: false, conflicting: true, limit: 0, reserved: 0, in_use: 0, active_reserved: 0, opportunistic: 0, active_borrowed: 0 },
        ],
        queued: [b('q1', 'stuck-api', ACCOUNT, 'railpack', 'queued', { wait_seconds: 1260 }), b('q2', 'blog', ACCOUNT2, 'dockerfile', 'queued', { wait_seconds: 30 }), b('q3', 'twin-api', ACCOUNT2, 'railpack', 'queued', { wait_seconds: 900, coalesced: true })],
        running: [
          b('r1', 'monorepo', ACCOUNT, 'railpack', 'running', { node: 'fsn-2', started_at: ago(1000), wait_seconds: 12, duration_seconds: 1000, preemptions: 1 }),
          b('r2', 'docs', ACCOUNT2, 'dockerfile', 'running', { node: 'fsn-2', started_at: ago(60), wait_seconds: 3, duration_seconds: 60 }),
        ],
        slowest: [b('f1', 'ml-worker', ACCOUNT, 'railpack', 'failed', { failure_class: 'timeout', cache_status: 'miss', started_at: ago(4000), finished_at: ago(3100), wait_seconds: 5, duration_seconds: 900 })],
        recent_failures: [
          b('f2', 'big-node', ACCOUNT2, 'railpack', 'failed', { failure_class: 'oom', started_at: ago(700), finished_at: ago(400), wait_seconds: 2, duration_seconds: 300 }),
          b('f1', 'ml-worker', ACCOUNT, 'railpack', 'failed', { failure_class: 'timeout', started_at: ago(4000), finished_at: ago(3100), wait_seconds: 5, duration_seconds: 900 }),
        ],
      } };
    }
    /* ── Fleet snapshot health (ADR-20261122135018) ── */
    case key === 'GET /v1/admin/obs/snapshot-health': {
      const MB = 1024 * 1024;
      const snap = (id, slug, account, snapMB, layerMB, extra = {}) => ({ id, deployment_id: `dep-${id}`, deployment_status: 'live', app_id: `app-${id}`, app_slug: slug, account_id: account,
        tier: 'init', fc_version: '1.12.0', cpu_template: 'T2CL', cpu_model: 'icelake', stale: false, delete_pending: false,
        snapshot_bytes: snapMB * MB, layer_bytes: layerMB * MB, footprint_bytes: (snapMB + layerMB) * MB, created_at: ago(60 * 5), ...extra });
      return { status: 200, body: {
        as_of: ago(0), target_mb: 130, warn_mb: 160, page_mb: 200, truncated: false,
        totals: { live: 3, stale: 1, delete_pending: 0, live_bytes: 420 * MB, avg_bytes: 140 * MB, p95_bytes: 230 * MB, over_warn: 1, unsnapshotted: 2, not_cold_bootable: 1 },
        tiers: [{ key: 'init', live: 2, stale: 1, avg_bytes: 160 * MB }, { key: 'warm', live: 1, stale: 0, avg_bytes: 100 * MB }],
        fc_versions: [{ key: '1.12.0', live: 3, stale: 0, avg_bytes: 140 * MB }, { key: '1.11.0', live: 0, stale: 1, avg_bytes: 0 }],
        cpu_templates: [{ key: 'T2CL/icelake', live: 3, stale: 1, avg_bytes: 140 * MB }],
        largest: [snap('s1', 'checkout-api', ACCOUNT, 200, 30), snap('s2', 'blog', ACCOUNT2, 90, 0, { tier: 'warm' }), snap('s3', 'docs', ACCOUNT, 80, 20)],
        recently_stale: [snap('s4', 'legacy-api', ACCOUNT2, 120, 0, { stale: true, fc_version: '1.11.0', stale_at: ago(90) })],
        unsnapshotted: [
          { deployment_id: 'dep-broken', app_id: 'app-broken', app_slug: 'broken-app', account_id: ACCOUNT2, cold_bootable: false, created_at: ago(30) },
          { deployment_id: 'dep-legacy', app_id: 'app-s4', app_slug: 'legacy-api', account_id: ACCOUNT2, cold_bootable: true, created_at: ago(600), last_stale_at: ago(90) },
        ],
        unsnapshotted_truncated: false,
      } };
    }
    /* ── Fleet wake latency (ADR-20261121200409) ── */
    case key === 'GET /v1/admin/obs/wake-latency': {
      const window = query.get('window') || '1h';
      if (!/^\d+[mh]$/.test(window)) return problem(400, 'validation', 'Bad window', 'window must be a duration from 1m to 24h, such as 1h');
      const node = query.get('node') || '';
      if (node && !['node-a', 'node-b', 'node-c'].includes(node)) return problem(404, 'not_found', 'Node not found', 'no compute node has this name');
      const appOnly = query.get('app_id') || '';
      const slow = [
        { wake_id: 'wake-0009-blog-cold', instance_id: 'i-9', app_id: 'app-9', app_slug: 'blog', account_id: ACCOUNT2, node_id: 'n2', node_name: 'node-b', method: 'cold_boot', tier: 'cold_boot_fallback', cold_reason: 'no_snapshot', duration_ms: 2410, completed_at: ago(12), slow_phase: 'cold_boot/wait_ready', slow_phase_ms: 2100 },
        { wake_id: 'wake-0001-checkout', instance_id: 'i-1', app_id: 'app-1', app_slug: 'checkout-api', account_id: ACCOUNT, node_id: 'n1', node_name: 'node-a', method: 'restore', tier: 'warm', duration_ms: 512, completed_at: ago(30), slow_phase: 'restore/load_snapshot', slow_phase_ms: 330 },
        { wake_id: 'wake-0002-checkout', instance_id: 'i-2', app_id: 'app-1', app_slug: 'checkout-api', account_id: ACCOUNT, node_id: 'n1', node_name: 'node-a', method: 'restore', tier: 'warm', duration_ms: 140, completed_at: ago(40) },
      ].filter((w) => (!node || w.node_name === node) && (!appOnly || w.app_id === appOnly));
      const restores = slow.filter((w) => w.method === 'restore');
      const colds = slow.filter((w) => w.method === 'cold_boot');
      return { status: 200, body: {
        window, since: ago(60), as_of: ago(0), target_ms: 350,
        totals: { wakes: slow.length, restores: restores.length, cold_boots: colds.length, thaws: 0, failures: node === 'node-b' || !node ? 1 : 0, fallbacks: 0, restores_over_target: restores.filter((w) => w.duration_ms > 350).length, platform_refreshes: 2 },
        methods: [
          ...(restores.length ? [{ method: 'restore', count: restores.length, p50_ms: 140, p95_ms: 512, p99_ms: 512, max_ms: 512, over_target: 1 }] : []),
          ...(colds.length ? [{ method: 'cold_boot', count: colds.length, p50_ms: 2410, p95_ms: 2410, p99_ms: 2410, max_ms: 2410, over_target: 0 }] : []),
        ],
        nodes: [
          ...(restores.length ? [{ node_id: 'n1', node_name: 'node-a', restores: restores.length, cold_boots: 0, thaws: 0, failures: 0, fallbacks: 0, restore_p50_ms: 140, restore_p95_ms: 512, restores_over_target: 1 }] : []),
          ...(colds.length ? [{ node_id: 'n2', node_name: 'node-b', restores: 0, cold_boots: colds.length, thaws: 0, failures: 1, fallbacks: 0, restore_p50_ms: 0, restore_p95_ms: 0, restores_over_target: 0 }] : []),
        ],
        phases: slow.length ? [
          { method: 'cold_boot', phase: 'wait_ready', samples: 1, p50_ms: 2100, p95_ms: 2100, max_ms: 2100 },
          { method: 'restore', phase: 'load_snapshot', samples: 2, p50_ms: 80, p95_ms: 330, max_ms: 330 },
          { method: 'schedd', phase: 'post_rpc_publish', samples: 3, p50_ms: 6, p95_ms: 14, max_ms: 14 },
        ] : [],
        cold_reasons: colds.length ? [{ reason: 'no_snapshot', count: colds.length }] : [],
        failure_reasons: node === 'node-a' || appOnly ? [] : [{ reason: 'vmm_start_failed', count: 1 }],
        slowest: slow,
        cold_boot_apps: colds.length ? [{ app_id: 'app-9', app_slug: 'blog', account_id: ACCOUNT2, wakes: 1, restores: 0, cold_boots: 1, fallbacks: 0, top_cold_reason: 'no_snapshot', p95_ms: 2410 }] : [],
      } };
    }
    case key === 'GET /v1/admin/obs/nodes/wake-latency':
      return { status: 200, body: { window: '5m', as_of: now(), prometheus_available: true, fleet_p95_ms: 410, quantiles: [{ node_id: 'n1', node_name: 'node-a', p50_ms: 212, p95_ms: 410, p99_ms: 690, sample_count: 1240 }] } };
    case /^GET \/v1\/admin\/obs\/nodes\/[^/]+\/detail$/.test(key): {
      const name = path.split('/')[5];
      return { status: 200, body: { node: { id: 'n1', name, active: name !== 'node-c', vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, instances_live: 2, instances_running: 2, instances_waking: 0, instances_cold_booting: 0, ram_used_mb: 512, admission_margin_mb: 55193, created_at: ago(1000) },
        apps: [
          { id: 'app-1', slug: 'checkout-api', account_id: ACCOUNT, status: 'active', instances_live: 2, instances_running: 2, instances_waking: 0, instances_cold_booting: 0, ram_used_mb: 512, last_request_at: ago(1) },
          { id: 'app-2', slug: 'billing-cron', account_id: ACCOUNT, status: 'active', instances_live: 1, instances_running: 0, instances_waking: 0, instances_cold_booting: 0, ram_used_mb: 256, last_request_at: ago(60) },
          { id: 'app-3', slug: 'parked-site', account_id: ACCOUNT, status: 'active', instances_live: 0, instances_running: 0, instances_waking: 0, instances_cold_booting: 0, ram_used_mb: 0, last_request_at: '0001-01-01T00:00:00Z' },
        ],
        instances: [
          { id: 'c0ffee00-0000-4000-8000-000000000001', app_id: 'app-1', app_slug: 'checkout-api', account_id: ACCOUNT, deployment_id: 'dep-1', state: 'running', ram_mb: 256, started_at: ago(30), last_request_at: ago(1) },
          { id: 'c0ffee00-0000-4000-8000-000000000002', app_id: 'app-1', app_slug: 'checkout-api', account_id: ACCOUNT, deployment_id: 'dep-1', state: 'running', ram_mb: 256, started_at: ago(20), last_request_at: '0001-01-01T00:00:00Z' },
          { id: 'c0ffee00-0000-4000-8000-000000000003', app_id: 'app-2', app_slug: 'billing-cron', account_id: ACCOUNT, deployment_id: 'dep-2', state: 'frozen', ram_mb: 256, started_at: ago(90), last_request_at: ago(60) },
        ],
        drain: { total_instances: 3, live_instances: 2, running_instances: 2, waking_instances: 0, cold_booting_instances: 0, drain_safe: false, observed_at: now() } } };
    }
    case /^POST \/v1\/admin\/ops\/nodes\/[^/]+\/(drain|force-drain|activate|retire)$/.test(key):
      return { status: 202, body: { ok: true, intent_id: queueIntent(`node_${path.split('/').pop()}`), status_url: '', expires_at: ago(-60), kind: 'node_drain', node: path.split('/')[5], previous_active: true, active: false, previous_lifecycle: 'active', requested_lifecycle: 'draining', live_instances: 2, forced: false, reason: query.get('reason'), preflight: { affected_apps: 1, affected_tenants: 1, total_instances: 2, live_instances: 2, live_ram_mb: 512, capacity_change_mb: -55705, reversible: true, disruption_warning: false } } };
    case key === 'GET /v1/compute-nodes':
      return { status: 200, body: [...state.nodes.values()].filter((n) => query.get('include_inactive') === '1' || n.active) };
    case /^GET \/v1\/compute-nodes\/[^/]+$/.test(key): {
      const node = state.nodes.get(decodeURIComponent(path.split('/').pop()));
      return node ? { status: 200, body: { ...node, live_instance_count: node.name === 'node-a' ? 2 : 0 } } : problem(404, 'not_found', 'Not found', 'no such compute_node');
    }

    /* ── Recovery intents ── */
    case /^POST \/v1\/admin\/(instances\/[^/]+\/force-(park|restart)|apps\/[^/]+\/force-cold-boot)$/.test(key):
      return { status: 202, body: { ok: true, intent_id: queueIntent(path.split('/').pop()), status_url: '', expires_at: ago(-60) } };
    case /^GET \/v1\/admin\/operator-intents\/[^/]+$/.test(key): {
      const id = path.split('/').pop();
      const intent = state.intents.get(id);
      if (!intent) return problem(404, 'not_found', 'Not found', 'no such intent');
      const age = Date.now() - intent.created;
      return { status: 200, body: { intent_id: id, kind: intent.kind, status: age < 4000 ? 'pending' : age < 8000 ? 'running' : 'succeeded', target_id: 'x', actor_id: 'op-1', reason: 'mock', requested_at: new Date(intent.created).toISOString() } };
    }

    /* ── Deployments and job runs ── */
    case key === 'GET /v1/admin/ops/deployments':
      return { status: 200, body: { limit: Number(query.get('limit')) || 50, offset: 0, next_offset: -1, account_id: query.get('account_id') || undefined, deployments: deploymentsFor(query) } };
    case /^GET \/v1\/admin\/ops\/deployments\/[^/]+$/.test(key): {
      const id = path.split('/').pop();
      // The second deployment's build is still running: stale repair must skip it.
      return { status: 200, body: { deployment: deployment(id, 'building', { error_code: 'build_failed' }),
        ...(id.endsWith('0002') ? { build: { id: 'build-77', status: 'running', enqueued_at: ago(200) } } : {}) } };
    }
    case /^POST \/v1\/admin\/ops\/deployments\/[^/]+\/cancel$/.test(key):
      return { status: 200, body: { action: 'cancel', deployment: deployment(path.split('/')[5], 'cancelled', { cancel_reason: query.get('reason') }) } };
    case key === 'GET /v1/admin/ops/jobs/runs':
      return { status: 200, body: { account_id: query.get('account_id') || undefined, limit: 50, offset: 0, next_offset: -1, runs: [
        { job_id: 'job-1', job_name: 'nightly-report', run_id: '9b8c7d6e-0000-4000-8000-000000000001', account_id: ACCOUNT, aggregate_status: 'running', tasks: 4, tasks_running: 1, tasks_succeeded: 2, tasks_failed: 1, tasks_cancelled: 0, ram_mb: 256, created_at: ago(20), started_at: ago(19) },
      ] } };
    case /^GET \/v1\/admin\/ops\/jobs\/runs\/[^/]+$/.test(key):
      return { status: 200, body: { run: { job_id: 'job-1', job_name: 'nightly-report', run_id: path.split('/').pop(), account_id: ACCOUNT, aggregate_status: 'running', tasks: 4, tasks_running: 1, tasks_succeeded: 2, tasks_failed: 1, tasks_cancelled: 0, ram_mb: 256, created_at: ago(20), started_at: ago(19) }, tasks: [], task_limit: 50, task_offset: 0, next_task_offset: -1 } };

    /* ── Incidents and audit ── */
    case key === 'GET /v1/admin/obs/incidents':
      return { status: 200, body: { unavailable_sources: [], generated_at: now(), limit: 200, since: ago(60 * 24 * 7), since_clamped: false, next_cursor: '', items: [
        depIncident(),
        { id: 'compute_node/aaaaaaaa-0000-4000-8000-000000000003', type: 'compute_node', severity: 'warning', status: 'stale', summary: 'node-c heartbeat stale', resource_id: 'aaaaaaaa-0000-4000-8000-000000000003', resource_name: 'node-c', observed_at: ago(90), dedupe_key: 'compute_node/n3' },
      ].filter((item) => !query.get('type') || item.type === query.get('type')) } };
    case /^GET \/v1\/admin\/obs\/incidents\/deployment\/[^/]+\/evidence$/.test(key):
      return { status: 200, body: { generated_at: now(), incident: depIncident(), error_code: 'build_failed', since: ago(60 * 24), limit: Number(query.get('limit')) || 50, truncated: false, unavailable_sources: [],
        history: [{ id: 'ev-1', source: 'audit', kind: 'deployment.failed', status: 'failed', at: ago(14), trace_id: '4bf92f3577b34da6a3ce929d0e0e4736' }] } };
    case /^GET \/v1\/admin\/obs\/incidents\/deployment\/[^/]+\/context$/.test(key):
      return { status: 200, body: { as_of: now(), incident_id: depIncident().id, incident_status: 'failed', incident_observed_at: ago(14), evidence_path: '', scope: { state: 'known' }, counts: null,
        resources: [{ kind: 'app', id: APP_ID, status: 'active', relationship: 'deployment_app', account_id: ACCOUNT, confirmed_failure: false }],
        limit: Number(query.get('limit')) || 25, next_cursor: '', since: ago(60 * 24), until: now(), timeline: [], timeline_scope: 'incident_scope_and_returned_resources',
        timeline_limit: Number(query.get('history_limit')) || 25, timeline_truncated: false, unavailable_sources: [] } };
    case key === 'GET /v1/admin/obs/audit-log/search':
      return { status: 200, body: { generated_at: now(), limit: 200, include_anonymous: false, window_hours: 0, items: [
        // Operators' audited reads of lists, as apid records them since faas ADR-20261102071817.
        ...['deployments.active', 'obs.incidents', 'jobs.active'].map((endpoint, i) => ({
          id: `au-view-${i}`, kind: 'operator.action.view', account_id: 'op-1', actor: 'op-1', received_at: ago(2 + i), is_operator_action: true,
          data: { endpoint, target_account_id: ACCOUNT },
        })),
        { id: 'au-1', kind: 'operator.action.account.credit', account_id: ACCOUNT, actor: 'operator@ops.test', received_at: ago(60 * 26), is_operator_action: true },
        { id: 'au-2', kind: 'operator.action.app.force_cold_boot', account_id: ACCOUNT, actor: 'operator@ops.test', received_at: ago(45), is_operator_action: true },
      ] } };

    /* ── Internal static hosting ── */
    case key === 'GET /v1/internal/hosting/sites':
      return { status: 200, body: [site()] };
    case key === 'GET /v1/internal/hosting/usage':
      return { status: 200, body: hostingUsage() };
    case key === 'GET /v1/internal/hosting/capabilities':
      return { status: 200, body: hostingCapabilities() };
    case /^\/v1\/internal\/hosting\/sites\/[^/]+/.test(path) && path.split('/')[5] !== SITE_ID:
      return problem(404, 'not_found', 'Not found', 'no such hosting resource');
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}`:
      return { status: 200, body: site() };
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/automation-credentials`:
      return { status: 200, body: state.credentials };
    case key === `POST /v1/internal/hosting/sites/${SITE_ID}/automation-credentials`: {
      const extra = unknownKeys(body, ['label', 'operations', 'ttl_seconds']);
      if (extra.length || !body?.label) return problem(400, 'validation', 'Invalid request', 'invalid label, operations or credential lifetime');
      state.tokens += 1;
      const ttl = body.ttl_seconds || 86400;
      const credential = { id: `c2000000-0000-4000-8000-00000000000${state.tokens}`, account_id: 'op-1', site_id: SITE_ID, label: body.label,
        operations: body.operations?.length ? body.operations : ['stage', 'preview'], created_at: now(), expires_at: new Date(Date.now() + ttl * 1000).toISOString() };
      state.credentials.push(credential);
      return { status: 201, body: { credential, token: `fp_host_mock${state.tokens}${'x'.repeat(40)}` } };
    }
    case /^DELETE \/v1\/internal\/hosting\/sites\/[^/]+\/automation-credentials\/[^/]+$/.test(key): {
      const id = path.split('/').pop();
      if (!state.credentials.some((c) => c.id === id)) return problem(404, 'not_found', 'Not found', 'no such hosting resource');
      state.credentials = state.credentials.filter((c) => c.id !== id);
      return { status: 204 };
    }
    case /^(GET|POST|DELETE) \/v1\/internal\/hosting\/sites\/[^/]+\/oidc-trusts/.test(key) && !state.oidc:
      return problem(503, 'frontend_hosting_oidc_disabled', 'GitHub site identity unavailable', 'internal hosting OIDC is disabled or unconfigured');
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/oidc-trusts`:
      return { status: 200, body: state.trusts };
    case key === `POST /v1/internal/hosting/sites/${SITE_ID}/oidc-trusts`: {
      const extra = unknownKeys(body, ['repository_owner_id', 'repository_id', 'repository', 'ref', 'workflow_ref', 'event_name', 'environment']);
      if (extra.length || !body?.repository) return problem(400, 'validation', 'Invalid request', 'exact GitHub repository IDs, repository, branch ref, workflow ref and push/workflow_dispatch/schedule event are required');
      const trust = { id: `e2000000-0000-4000-8000-00000000000${state.trusts.length + 1}`, account_id: 'op-1', site_id: SITE_ID, ...body, created_at: now() };
      state.trusts.push(trust);
      return { status: 201, body: trust };
    }
    case /^DELETE \/v1\/internal\/hosting\/sites\/[^/]+\/oidc-trusts\/[^/]+$/.test(key): {
      const id = path.split('/').pop();
      if (!state.trusts.some((t) => t.id === id)) return problem(404, 'not_found', 'Not found', 'no such hosting resource');
      state.trusts = state.trusts.filter((t) => t.id !== id);
      return { status: 204 };
    }
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/status`:
      return { status: 200, body: { site: site(), publication: { state: 'pending', generation: 8, published_generation: 7, published_at: ago(60), pending_since: ago(3), next_attempt_at: ago(-1), last_attempt_at: ago(1), retry_count: 2, last_error_code: 'provider_timeout' } } };
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/releases`:
      return { status: 200, body: state.hosting.releases };
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/history`:
      return { status: 200, body: { retention_limit: 50, events: state.hosting.history } };
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/runs`:
      return { status: 200, body: { site_id: SITE_ID, observed_at: now(), serving_health: 'not_checked', source_labels_included: true, entries: state.hosting.runs } };
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/diagnostics`:
      return { status: 200, body: siteDiagnostics(query.get('run_id')) };
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/domains`:
      return { status: 200, body: state.hosting.domains };
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/previews`:
      return { status: 200, body: state.hosting.previews };
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/preview-capacity`: {
      const live = state.hosting.previews.filter((p) => !p.revoked && Date.parse(p.expires_at) > Date.now()).length;
      return { status: 200, body: { site_id: SITE_ID, limit: 10, previews: live, reservations: 1, available: 10 - live - 1, observed_at: now() } };
    }
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/traffic`:
      if (!state.analytics) return problem(503, 'frontend_hosting_analytics_disabled', 'Traffic analytics unavailable', 'internal traffic analytics are disabled');
      return { status: 200, body: siteTraffic() };
    case /^(GET|PUT) \/v1\/internal\/hosting\/sites\/[^/]+\/(cleanup|retention)$/.test(key) && !state.retention:
      return problem(503, 'frontend_hosting_retention_disabled', 'Hosting retention unavailable', 'internal hosting retention is disabled');
    case key === `GET /v1/internal/hosting/sites/${SITE_ID}/cleanup`: {
      if (!query.has('pending_age_seconds') && !query.has('staged_age_seconds')) return { status: 200, body: cleanupPlan() };
      const rules = { pending_age_seconds: Number(query.get('pending_age_seconds')), staged_age_seconds: Number(query.get('staged_age_seconds')) };
      if (Object.values(rules).some((v) => !Number.isInteger(v) || v < RETENTION_MIN || v > RETENTION_MAX)) {
        return problem(400, 'validation_error', 'Validation failed', 'provide both bounded age values as whole seconds');
      }
      return { status: 200, body: cleanupPlan(rules) };
    }
    case key === `PUT /v1/internal/hosting/sites/${SITE_ID}/retention`: {
      const allowed = ['enabled', 'pending_age_seconds', 'staged_age_seconds', 'expected_revision'];
      const ages = [body?.pending_age_seconds, body?.staged_age_seconds];
      if (unknownKeys(body, allowed).length || typeof body.enabled !== 'boolean' || typeof body.expected_revision !== 'number' || ages.some((v) => !Number.isInteger(v) || v < RETENTION_MIN || v > RETENTION_MAX)) {
        return problem(400, 'validation_error', 'Validation failed', 'a policy revision, enabled value and bounded age rules are required');
      }
      if (body.expected_revision !== state.hosting.retention.revision) return releaseConflict();
      const { enabled, pending_age_seconds, staged_age_seconds } = body;
      state.hosting.retention = { revision: state.hosting.retention.revision + 1, enabled, pending_age_seconds, staged_age_seconds, updated_at: now() };
      return { status: 200, body: retentionPolicy() };
    }

    /* ── Hosting writes: revision-fenced like apid (409 when the operator saw an older state) ── */
    case key === `POST /v1/internal/hosting/sites/${SITE_ID}/promotions`: {
      if (unknownKeys(body, ['release_id', 'expected_revision']).length) return problem(400, 'validation', 'Invalid request', 'release_id and expected_revision are required');
      const release = state.hosting.releases.find((r) => r.id === body.release_id);
      if (!release) return problem(404, 'not_found', 'Not found', 'no such hosting resource');
      if (body.expected_revision !== state.hosting.revision || release.state !== 'ready') return releaseConflict();
      state.hosting.history.unshift({ site_id: SITE_ID, revision: state.hosting.revision + 1, previous_revision: state.hosting.revision, release_id: release.id, previous_release_id: state.hosting.active, actor: { account_id: 'op-1' }, accepted_at: now(), provenance: release.provenance });
      state.hosting.revision += 1;
      state.hosting.active = release.id;
      release.first_promoted_at ??= now();
      return { status: 202, body: site() };
    }
    case /^DELETE \/v1\/internal\/hosting\/sites\/[^/]+\/releases\/[^/]+$/.test(key): {
      const release = state.hosting.releases.find((r) => r.id === path.split('/').pop());
      if (!release) return problem(404, 'not_found', 'Not found', 'no such hosting resource');
      const previewed = state.hosting.previews.some((p) => p.release_id === release.id && !p.revoked && Date.parse(p.expires_at) > Date.now());
      if (release.id === state.hosting.active || previewed || !['ready', 'pending'].includes(release.state)) return releaseConflict();
      release.state = 'retiring';
      return { status: 202, body: release };
    }
    case key === `PUT /v1/internal/hosting/sites/${SITE_ID}/suspension`: {
      if (unknownKeys(body, ['suspended', 'expected_revision']).length || typeof body?.suspended !== 'boolean') return problem(400, 'validation', 'Invalid request', 'suspended and expected_revision are required');
      if (body.expected_revision !== state.hosting.revision) return releaseConflict();
      state.hosting.suspended = body.suspended;
      state.hosting.revision += 1;
      return { status: 202, body: site() };
    }
    case /^POST \/v1\/internal\/hosting\/sites\/[^/]+\/ci\/[^/]+\/cancel$/.test(key): {
      const run = state.hosting.runs.find((r) => r.run_id === path.split('/')[7]);
      if (!run) return problem(404, 'not_found', 'Not found', 'no such hosting resource');
      if (!run.can_cancel) return problem(409, 'hosting_ci_cancel_protected', 'CI run is protected', 'production releases, previously promoted releases and other preview references cannot be canceled; inspect the run and release before acting');
      Object.assign(run, { canceled: true, can_cancel: false, state: 'canceled' });
      const preview = state.hosting.previews.find((p) => p.id === run.preview_id);
      if (preview) Object.assign(preview, { revoked: true, generation: 2 });
      return { status: 200, body: { id: run.run_id, site_id: SITE_ID, release_id: run.release_id, preview_id: run.preview_id, canceled: true } };
    }
    case /^DELETE \/v1\/internal\/hosting\/sites\/[^/]+\/previews\/[^/]+$/.test(key): {
      if (unknownKeys(body, ['expected_generation']).length || body?.expected_generation !== 1) return problem(400, 'validation', 'Invalid request', 'preview and expected_generation=1 are required');
      const preview = state.hosting.previews.find((p) => p.id === path.split('/').pop());
      if (!preview) return problem(404, 'not_found', 'Not found', 'no such hosting resource');
      if (preview.generation !== 1) return releaseConflict();
      Object.assign(preview, { revoked: true, generation: 2 });
      return { status: 202, body: preview };
    }
    case /^DELETE \/v1\/internal\/hosting\/sites\/[^/]+\/domains\/[^/]+$/.test(key): {
      if (unknownKeys(body, ['expected_revision']).length) return problem(400, 'validation', 'Invalid request', 'domain and expected_revision are required');
      const domain = state.hosting.domains.find((d) => d.id === path.split('/').pop());
      if (!domain) return problem(404, 'not_found', 'Not found', 'no such hosting resource');
      if (body?.expected_revision !== domain.revision) return domainConflict();
      Object.assign(domain, { state: 'deleting', revision: domain.revision + 1 });
      return { status: 202, body: domain };
    }
    case /^POST \/v1\/internal\/hosting\/sites\/[^/]+\/domains\/[^/]+\/recover$/.test(key): {
      if (unknownKeys(body, ['expected_revision', 'provider_id', 'expected_hostname']).length) return problem(400, 'validation', 'Invalid request', 'provider_id, expected_hostname, and expected_revision are required');
      const domain = state.hosting.domains.find((d) => d.id === path.split('/')[7]);
      if (!domain || domain.details.provider_id || body?.expected_hostname !== domain.hostname || body?.expected_revision !== domain.revision) return domainConflict();
      domain.details.provider_id = body.provider_id;
      domain.revision += 1;
      return { status: 202, body: domain };
    }

    default:
      return problem(503, 'mock_unavailable', 'Not available in the local mock', `${method} ${path} has no fixture`);
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = undefined;
      }
      const out = route(req.method, url.pathname, url.searchParams, body);
      if (!url.pathname.startsWith('/__mock/')) {
        state.requests.push({ method: req.method, path: url.pathname, search: url.search, status: out.status, idempotencyKey: req.headers['idempotency-key'] ?? null });
      }
      if (LOG) console.log(req.method, url.pathname + url.search, '->', out.status);
      if (out.text) {
        res.writeHead(out.status, { 'content-type': 'text/plain' });
        return res.end(out.text);
      }
      if (!out.body) {
        res.writeHead(out.status);
        return res.end();
      }
      res.writeHead(out.status, { 'content-type': out.status >= 400 ? 'application/problem+json' : 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  })
  .listen(PORT, () => console.log(`mock apid listening on :${PORT}`));
