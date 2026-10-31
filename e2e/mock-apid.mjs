// A local stand-in for apid, so the console can be driven end to end without
// a control plane or credentials. Fixtures follow the console's wire types;
// any route without one answers 503 mock_unavailable, so error states render.
//
// Behaviour that matters to the tests mirrors apid:
//   - admin writes need a step-up younger than five minutes (403 step_up_required),
//     and an operator with no authenticator gets 403 mfa_required "must enroll";
//   - TOTP 123456 passes /v1/account/mfa/verify and /confirm; every CSRF token is "csrf-mock".
//
// Test hooks (not part of apid):
//   POST /__mock/reset              fresh state, timestamps relative to now
//   POST /__mock/state {...}        flip switches: {"enrolled": false}, {"expired": true}
//   GET  /__mock/requests           every request since the last reset, oldest first
//
// MOCK_APID_PORT sets the port (3199); MOCK_APID_LOG=1 logs each request.

import http from 'node:http';

const PORT = Number(process.env.MOCK_APID_PORT || 3199);
const LOG = process.env.MOCK_APID_LOG === '1';
const TOTP = '123456';
const CSRF = 'csrf-mock';
const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const ACCOUNT2 = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const APP_ID = 'b0000000-0000-4000-8000-000000000001';
const RELEASE_NEW = 'a3f9c2d1e8b74c6f9d0e1a2b3c4d5e6f7a8b9c0d';
const RELEASE_OLD = '9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const now = () => new Date().toISOString();
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const problem = (status, code, title, detail) => ({ status, body: { type: '', title, status, code, detail } });

function freshState() {
  return {
    enrolled: true,
    expired: false,
    steppedUpAt: 0,
    configVersion: 3,
    suspended: false,
    intents: new Map(),
    requests: [],
    nodes: new Map([
      ['node-a', { id: 'n1', name: 'node-a', target_url: 'tcp://10.8.0.2:7001', gateway_target_url: 'tcp://10.8.0.2:9100', vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, active: true, lifecycle: 'active', role: 'compute', region: 'eu-central', zone: 'fsn1', release_id: RELEASE_NEW, manifest_hash: 'sha256:9f2c4d10aa', cert_fingerprint: 'SHA256:ab12cd34ef56', generation: 4, last_heartbeat_at: ago(0.1), created_at: ago(60 * 24 * 90) }],
      ['node-b', { id: 'n2', name: 'node-b', target_url: 'tcp://10.8.0.3:7001', vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, active: true, lifecycle: 'active', release_id: RELEASE_OLD, generation: 3, last_heartbeat_at: ago(0.2), created_at: ago(60 * 24 * 60) }],
      ['node-c', { id: 'n3', name: 'node-c', target_url: 'tcp://10.8.0.4:7001', vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, active: false, lifecycle: 'maintenance', generation: 2, created_at: ago(60 * 24 * 20) }],
    ]),
    sessions: [
      { id: 's0000000-0000-4000-8000-000000000001', issued_ip: '203.0.113.7', issued_ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', issued_at: ago(60 * 3), last_seen_at: ago(0.1), current_session: true },
      { id: 's0000000-0000-4000-8000-000000000002', issued_ip: '198.51.100.20', issued_ua: 'gregalectl/1.42 (darwin/arm64)', issued_at: ago(60 * 24 * 2), last_seen_at: ago(60 * 5), current_session: false },
      { id: 's0000000-0000-4000-8000-000000000003', issued_ip: '192.0.2.44', issued_ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0', issued_at: ago(60 * 24 * 6), last_seen_at: '', current_session: false },
    ],
  };
}

let state = freshState();

const tenantRow = (id, email, plan, status, apps) => ({
  account_id: id, plan, status, is_personal: true, created_at: ago(60 * 24 * 40), mfa_enrolled: plan !== 'free',
  apps_count: apps, deployments_live_count: Math.max(0, apps - 1), email,
});

const deployment = (id, status, extra = {}) => ({
  id, app_id: APP_ID, app_slug: 'checkout-api', app_status: 'active', account_id: ACCOUNT, kind: 'git', status,
  source_bytes: 1048576, priority: 0, created_at: ago(14), ...extra,
});

const depIncident = () => ({
  id: 'deployment/7a1b2c3d-0000-4000-8000-000000000001', type: 'deployment', severity: 'error', status: 'failed',
  summary: 'checkout-api deployment failed: build_failed', account_id: ACCOUNT, app_id: APP_ID,
  resource_id: '7a1b2c3d-0000-4000-8000-000000000001', resource_name: 'checkout-api', observed_at: ago(14),
  dedupe_key: 'deployment/dep-1', audit_path: `/v1/admin/obs/audit-log/search?kind_prefix=deployment.&target_account_id=${ACCOUNT}`,
});

const queueIntent = (kind) => {
  const id = `intent-${Date.now()}-${state.intents.size}`;
  state.intents.set(id, { created: Date.now(), kind });
  return id;
};

function route(method, path, query, body) {
  const key = `${method} ${path}`;
  const adminWrite = path.startsWith('/v1/admin/') && method !== 'GET';

  if (key === 'POST /__mock/reset') {
    state = freshState();
    return { status: 200, body: { ok: true } };
  }
  if (key === 'POST /__mock/state') {
    for (const name of ['enrolled', 'expired']) if (name in (body || {})) state[name] = Boolean(body[name]);
    return { status: 200, body: { enrolled: state.enrolled, expired: state.expired } };
  }
  if (key === 'GET /__mock/requests') return { status: 200, body: state.requests };
  if (key === 'GET /healthz') return { status: 200, text: 'ok' };

  if (state.expired) return problem(401, 'session_expired', 'Session expired', 'the session is no longer valid');
  if (adminWrite && !state.enrolled) {
    return problem(403, 'mfa_required', 'MFA required', 'platform operators must enroll an authenticator: complete /v1/account/mfa/enroll and /v1/account/mfa/confirm');
  }
  if (key === 'POST /v1/account/mfa/enroll') {
    if (state.enrolled) return problem(409, 'conflict', 'Already enrolled', 'an authenticator is already enrolled');
    return { status: 200, body: { otpauth_url: 'otpauth://totp/Gregale:operator@ops.test?secret=JBSWY3DPEHPK3PXP', secret: 'JBSWY3DPEHPK3PXP', qr_code_png_base64: PNG_1PX, recovery_codes: ['7KQ2-M9XP', 'R4TD-2WLN', 'H8VC-6QJZ', 'P3NB-K7FY'] } };
  }
  if (key === 'POST /v1/account/mfa/confirm') {
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
      return { status: 200, body: { state: 'healthy', truncated: false, generated_at: now(), groups: [] } };

    /* ── Tenants ── */
    case key === 'GET /v1/admin/obs/tenants':
      return { status: 200, body: { limit: Number(query.get('limit') || 100), next_cursor: '', items: [
        tenantRow(ACCOUNT, query.get('include_pii') ? 'ada@customer.test' : undefined, 'pro', state.suspended ? 'suspended' : 'active', 4),
        tenantRow(ACCOUNT2, query.get('include_pii') ? 'grace@customer.test' : undefined, 'hobby', 'past_due', 2),
      ].filter((t) => (!query.get('plan') || t.plan === query.get('plan')) && (!query.get('status') || t.status === query.get('status'))) } };
    case /^GET \/v1\/admin\/obs\/tenants\/[^/]+\/activity$/.test(key):
      return { status: 200, body: { account_id: ACCOUNT, generated_at: now(), limit: 50,
        invocations: [{ id: 'inv-1', app_id: 'app-1', app_slug: 'checkout-api', state: 'failed', source: 'http', method: 'POST', path: '/orders', outcome: 'error_5xx', attempts: 1, last_error: 'upstream timeout', created_at: ago(3) }],
        audit_events: [{ id: 'ev-1', at: ago(12), kind: 'deploy.succeeded', actor: 'ada@customer.test' }] } };
    case /^GET \/v1\/admin\/obs\/tenants\/[^/]+(\/360)?$/.test(key): {
      const detail = { account: tenantRow(ACCOUNT, query.get('include_pii') ? 'ada@customer.test' : undefined, 'pro', state.suspended ? 'suspended' : 'active', 2),
        apps: [{ id: 'app-1', slug: 'checkout-api', status: 'active', deployments: 18 }, { id: 'app-2', slug: 'nightly-report', status: 'evicted_cold', deployments: 3 }],
        orgs: [{ id: 'org-1', slug: 'ada-labs', role: 'owner' }], api_keys: { active: 2, revoked: 1 }, sessions: { active: 1, revoked: 4 } };
      if (!path.endsWith('/360')) return { status: 200, body: detail };
      return { status: 200, body: { ...detail,
        usage: { month: '2026-10', used_gb_hours: 212.5, included_gb_hours: 250, overage_gb_hours: 0, overage_cents: 0, used_cpu_hours: 40, used_egress_gb: 3.2, used_ingress_gb: 1.1, cold_boots: 37, requests: 1840221,
          apps: [{ app_id: 'app-1', app_slug: 'checkout-api', mb_seconds: 720000000, cpu_usec: 1, requests: 1800000, tx_bytes: 2e9, net_tx_bytes: 1e9, net_rx_bytes: 1e9, cold_boots: 30 }] },
        billing: { current_month_overage_cents: 0, active_credits_cents: 2500, invoices: [{ id: 'in_123', provider: 'polar', number: 'INV-0042', status: 'paid', currency: 'eur', period_start: ago(60 * 24 * 31), period_end: ago(60 * 24), total_cents: 2900, amount_paid_cents: 2900 }] } } };
    }
    case /^GET \/v1\/admin\/obs\/apps\/[^/]+$/.test(key):
      return { status: 200, body: { app: { id: path.split('/').pop(), account_id: ACCOUNT, slug: 'checkout-api', type: 'service', runtime: 'node22', status: 'active', max_concurrency: 10, min_instances: 0 },
        deployments: [], invocations: [],
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
    case key === 'GET /v1/admin/obs/nodes/wake-latency':
      return { status: 200, body: { window: '5m', as_of: now(), prometheus_available: true, fleet_p95_ms: 410, quantiles: [{ node_id: 'n1', node_name: 'node-a', p50_ms: 212, p95_ms: 410, p99_ms: 690, sample_count: 1240 }] } };
    case /^GET \/v1\/admin\/obs\/nodes\/[^/]+\/detail$/.test(key): {
      const name = path.split('/')[5];
      return { status: 200, body: { node: { id: 'n1', name, active: name !== 'node-c', vpcpus: 16, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705, instances_live: 2, instances_running: 2, instances_waking: 0, instances_cold_booting: 0, ram_used_mb: 512, admission_margin_mb: 55193, created_at: ago(1000) },
        apps: [{ id: 'app-1', slug: 'checkout-api', account_id: ACCOUNT, status: 'active', instances_live: 2, instances_running: 2, instances_waking: 0, instances_cold_booting: 0, ram_used_mb: 512, last_request_at: ago(1) }],
        instances: [{ id: 'c0ffee00-0000-4000-8000-000000000001', app_id: 'app-1', app_slug: 'checkout-api', deployment_id: 'dep-1', state: 'running', ram_mb: 256, started_at: ago(30), last_request_at: ago(1) }],
        drain: { total_instances: 2, live_instances: 2, running_instances: 2, waking_instances: 0, cold_booting_instances: 0, drain_safe: false, observed_at: now() } } };
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
      return { status: 200, body: { limit: 50, offset: 0, next_offset: -1, account_id: query.get('account_id') || undefined, deployments: [
        deployment('7a1b2c3d-0000-4000-8000-000000000001', 'building', { created_at: ago(180) }),
        deployment('7a1b2c3d-0000-4000-8000-000000000002', 'imaging', { created_at: ago(200) }),
      ] } };
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
        { id: 'au-1', kind: 'operator.action.account.credit', account_id: ACCOUNT, actor: 'operator@ops.test', received_at: ago(60 * 26), is_operator_action: true },
        { id: 'au-2', kind: 'operator.action.app.force_cold_boot', account_id: ACCOUNT, actor: 'operator@ops.test', received_at: ago(45), is_operator_action: true },
      ] } };

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
