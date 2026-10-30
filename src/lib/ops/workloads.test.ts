import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStepUpHandler } from '@/lib/api';
import {
  cancelOperatorDeployment,
  cancelOperatorJobRun,
  defaultRetryStage,
  formatAgeSeconds,
  formatDurationMs,
  getDataRepairHealth,
  getOperatorDeployment,
  getOperatorJobRun,
  isDeploymentCancellable,
  isDeploymentRetryable,
  isJobRunCancellable,
  isUuid,
  listOperatorDeployments,
  listOperatorJobRuns,
  operatorDeploymentsQuery,
  phaseIsOverdue,
  retryOperatorDeployment,
  safeHttpUrl,
  toRfc3339,
} from './workloads';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

let calls: Call[];
let responses: Response[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const APP = '66666666-7777-4888-9999-000000000000';
const DEPLOYMENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  });
});

afterEach(() => {
  setStepUpHandler(null);
  vi.unstubAllGlobals();
});

const params = (url: string) => new URL(url, 'https://ops.invalid').searchParams;

describe('deployment client', () => {
  it('sends no filters for the incident default', async () => {
    responses.push(json(200, { deployments: [], limit: 50, offset: 0, next_offset: -1 }));
    await listOperatorDeployments();
    expect(calls[0].url).toBe('/v1/admin/ops/deployments');
    expect(calls[0].method).toBe('GET');
  });

  it('encodes every supported filter', async () => {
    responses.push(json(200, { deployments: [], limit: 25, offset: 50, next_offset: -1 }));
    await listOperatorDeployments({
      accountId: ` ${ACCOUNT} `,
      appId: APP,
      statuses: ['failed', 'building'],
      includeDeleted: true,
      createdBefore: new Date(Date.UTC(2026, 9, 30, 12, 0, 0, 123)),
      limit: 25,
      offset: 50,
    });
    const q = params(calls[0].url);
    expect(calls[0].url.startsWith('/v1/admin/ops/deployments?')).toBe(true);
    expect(q.get('account_id')).toBe(ACCOUNT);
    expect(q.get('app_id')).toBe(APP);
    expect(q.get('status')).toBe('failed,building');
    expect(q.get('include_deleted')).toBe('true');
    expect(q.get('created_before')).toBe('2026-10-30T12:00:00Z');
    expect(q.get('limit')).toBe('25');
    expect(q.get('offset')).toBe('50');
  });

  it('passes status=all through and omits offset 0', () => {
    const q = params(operatorDeploymentsQuery({ statuses: 'all', offset: 0 }));
    expect(q.get('status')).toBe('all');
    expect(q.has('offset')).toBe(false);
  });

  it('encodes the deployment id on detail reads', async () => {
    responses.push(json(200, { deployment: { id: DEPLOYMENT } }));
    await getOperatorDeployment('a/b');
    expect(calls[0].url).toBe('/v1/admin/ops/deployments/a%2Fb');
  });

  it('cancels with confirm, a reason code and the dialog key', async () => {
    responses.push(json(200, { deployment: { id: DEPLOYMENT, status: 'cancelled' }, action: 'cancel', reason: 'stuck_deployment' }));
    const res = await cancelOperatorDeployment(DEPLOYMENT, 'stuck_deployment', { idempotencyKey: 'key-1' });
    expect(res.action).toBe('cancel');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.startsWith(`/v1/admin/ops/deployments/${DEPLOYMENT}/cancel?`)).toBe(true);
    const q = params(calls[0].url);
    expect(q.get('confirm')).toBe('true');
    expect(q.get('reason')).toBe('stuck_deployment');
    expect(calls[0].headers['Idempotency-Key']).toBe('key-1');
  });

  it('retries from an explicit stage and returns the new deployment', async () => {
    responses.push(
      json(202, { deployment: { id: 'new-deployment', status: 'pending' }, action: 'retry', reason: 'builder_crash' }),
    );
    const res = await retryOperatorDeployment(DEPLOYMENT, 'image_build', 'builder_crash', { idempotencyKey: 'key-2' });
    expect(res.deployment.id).toBe('new-deployment');
    const q = params(calls[0].url);
    expect(calls[0].url.startsWith(`/v1/admin/ops/deployments/${DEPLOYMENT}/retry?`)).toBe(true);
    expect(q.get('confirm')).toBe('true');
    expect(q.get('from_stage')).toBe('image_build');
    expect(q.get('reason')).toBe('builder_crash');
    expect(calls[0].headers['Idempotency-Key']).toBe('key-2');
  });

  it('surfaces a 409 as an ApiError with the backend detail', async () => {
    responses.push(
      json(409, { title: 'deployment is not failed', status: 409, code: 'conflict', detail: 'only failed deployments can be retried' }),
    );
    await expect(retryOperatorDeployment(DEPLOYMENT, 'readiness', 'customer_request')).rejects.toMatchObject({
      status: 409,
      message: 'only failed deployments can be retried',
    });
  });
});

describe('job run client', () => {
  it('lists active runs for one account with offset paging', async () => {
    responses.push(json(200, { runs: [], limit: 50, offset: 100, next_offset: -1 }));
    await listOperatorJobRuns({ accountId: ACCOUNT, limit: 50, offset: 100 });
    const q = params(calls[0].url);
    expect(calls[0].url.startsWith('/v1/admin/ops/jobs/runs?')).toBe(true);
    expect(q.get('account_id')).toBe(ACCOUNT);
    expect(q.get('limit')).toBe('50');
    expect(q.get('offset')).toBe('100');
  });

  it('lists fleet-wide without a query string', async () => {
    responses.push(json(200, { runs: [], limit: 50, offset: 0, next_offset: -1 }));
    await listOperatorJobRuns();
    expect(calls[0].url).toBe('/v1/admin/ops/jobs/runs');
  });

  it('pages the task list with task_limit and task_offset', async () => {
    responses.push(json(200, { run: {}, tasks: [], task_limit: 25, task_offset: 25, next_task_offset: -1 }));
    await getOperatorJobRun('run-1', { taskLimit: 25, taskOffset: 25 });
    const q = params(calls[0].url);
    expect(calls[0].url.startsWith('/v1/admin/ops/jobs/runs/run-1?')).toBe(true);
    expect(q.get('task_limit')).toBe('25');
    expect(q.get('task_offset')).toBe('25');
  });

  it('cancels a run with confirm and reason', async () => {
    responses.push(json(200, { run: { run_id: 'run-1', aggregate_status: 'cancelled' }, cancelled_at: '', reason: 'runaway_job' }));
    await cancelOperatorJobRun('run-1', 'runaway_job', { idempotencyKey: 'key-3' });
    const q = params(calls[0].url);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.startsWith('/v1/admin/ops/jobs/runs/run-1/cancel?')).toBe(true);
    expect(q.get('confirm')).toBe('true');
    expect(q.get('reason')).toBe('runaway_job');
    expect(calls[0].headers['Idempotency-Key']).toBe('key-3');
  });
});

describe('data repair client', () => {
  it('reads with limit and the opaque cursor', async () => {
    responses.push(json(200, { observed_at: '', phases: [], items: [], limit: 64 }));
    await getDataRepairHealth({ limit: 64, cursor: `t:${DEPLOYMENT}` });
    const q = params(calls[0].url);
    expect(calls[0].url.startsWith('/v1/admin/ops/data-repairs?')).toBe(true);
    expect(q.get('limit')).toBe('64');
    expect(q.get('cursor')).toBe(`t:${DEPLOYMENT}`);
  });

  it('flags an overdue phase only when it has a threshold and work', () => {
    expect(phaseIsOverdue({ phase: 'queued', count: 2, oldest_age_seconds: 300, warn_after_seconds: 120 })).toBe(true);
    expect(phaseIsOverdue({ phase: 'queued', count: 0, oldest_age_seconds: 300, warn_after_seconds: 120 })).toBe(false);
    expect(phaseIsOverdue({ phase: 'outcome_unknown', count: 1, oldest_age_seconds: 9999, warn_after_seconds: 0 })).toBe(false);
  });
});

describe('pure helpers', () => {
  it('validates UUID filters the way uuid.Parse needs them', () => {
    expect(isUuid(ACCOUNT)).toBe(true);
    expect(isUuid(` ${ACCOUNT.toUpperCase()} `)).toBe(true);
    expect(isUuid('acct-123')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it('formats RFC3339 timestamps without milliseconds', () => {
    expect(toRfc3339(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678)))).toBe('2026-01-02T03:04:05Z');
  });

  it('picks the most recent failed stage for a retry', () => {
    expect(
      defaultRetryStage({
        history: [
          { name: 'source_download', status: 'completed', duration_ms: 10 },
          { name: 'dependency_restore', status: 'failed', duration_ms: 10 },
          { name: 'source_download', status: 'completed', duration_ms: 10 },
          { name: 'image_build', status: 'failed', duration_ms: 10 },
        ],
      }),
    ).toBe('image_build');
    expect(defaultRetryStage({ current: 'security_scan', history: [] })).toBe('security_scan');
    expect(defaultRetryStage({ current: 'not_a_stage' })).toBe('source_download');
    expect(defaultRetryStage(undefined)).toBe('source_download');
  });

  it('gates actions on the statuses the handlers accept', () => {
    for (const status of ['pending', 'building', 'imaging', 'snapshotting']) expect(isDeploymentCancellable(status)).toBe(true);
    for (const status of ['live', 'failed', 'superseded', 'cancelled']) expect(isDeploymentCancellable(status)).toBe(false);
    expect(isDeploymentRetryable('failed')).toBe(true);
    expect(isDeploymentRetryable('cancelled')).toBe(false);
    expect(isJobRunCancellable('queued')).toBe(true);
    expect(isJobRunCancellable('running')).toBe(true);
    expect(isJobRunCancellable('succeeded')).toBe(false);
  });

  it('formats durations and ages', () => {
    expect(formatDurationMs(250)).toBe('250 ms');
    expect(formatDurationMs(1500)).toBe('1.5s');
    expect(formatDurationMs(75_000)).toBe('1m 15s');
    expect(formatAgeSeconds(7_260)).toBe('2h 1m');
    expect(formatAgeSeconds(90_000)).toBe('1d 1h');
    expect(formatAgeSeconds(-1)).toBe('—');
    expect(formatDurationMs(null)).toBe('—');
  });

  it('only renders http(s) links from API data', () => {
    expect(safeHttpUrl('https://github.com/x/y.md')).toBe('https://github.com/x/y.md');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
  });
});
