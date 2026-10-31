import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_ENROLLMENT,
  deleteRetiredComputeNode,
  enrollComputeNode,
  enrollmentChanges,
  enrollmentLifecycleEffect,
  draftFromNode,
  tcpTargetError,
  validateEnrollment,
  type ComputeNode,
} from './nodes';

const valid = {
  ...EMPTY_ENROLLMENT,
  name: 'node-d',
  target_url: 'tcp://10.8.0.5:7001',
  gateway_target_url: 'tcp://10.8.0.5:9100',
  vpcpus: '16',
  mem_mb: '65536',
  max_concurrency: '200',
  admission_ceiling_mb: '55705',
};

describe('tcpTargetError (apid parseGatewayTargetURL)', () => {
  it.each(['tcp://10.8.0.5:9100', 'tcp://node-d.internal:443', 'tcp://[fd00::5]:9100'])('accepts %s', (raw) => {
    expect(tcpTargetError(raw)).toBeNull();
  });

  it.each([
    ['http://10.0.0.1:9100', /tcp:\/\/host:port/],
    ['tcp://10.0.0.1', /port between/],
    ['tcp://10.0.0.1:70000', /./],
    ['tcp://10.0.0.1:9100/metrics', /nothing after the port|tcp:\/\/host:port/],
    ['tcp://localhost:9100', /Loopback hostnames/],
    ['tcp://127.0.0.1:9100', /Loopback and wildcard/],
    ['tcp://0.0.0.0:9100', /Loopback and wildcard/],
    ['tcp://user:pw@10.0.0.1:9100', /tcp:\/\/host:port/],
  ])('rejects %s', (raw, message) => {
    expect(tcpTargetError(raw)).toMatch(message);
  });
});

describe('validateEnrollment', () => {
  it('builds the request body, omitting empty optional fields', () => {
    const result = validateEnrollment(valid);
    expect(result.errors).toEqual({});
    expect(result.body).toEqual({
      name: 'node-d',
      target_url: 'tcp://10.8.0.5:7001',
      gateway_target_url: 'tcp://10.8.0.5:9100',
      vpcpus: 16,
      mem_mb: 65536,
      max_concurrency: 200,
      admission_ceiling_mb: 55705,
      defer_activation: true,
    });
  });

  it('applies apid’s required-field and capacity rules', () => {
    const result = validateEnrollment({ ...EMPTY_ENROLLMENT, vpcpus: '0', mem_mb: '1.5', admission_ceiling_mb: '-1' });
    expect(result.body).toBeNull();
    expect(Object.keys(result.errors).sort()).toEqual(
      ['admission_ceiling_mb', 'max_concurrency', 'mem_mb', 'name', 'target_url', 'vpcpus'].sort(),
    );
  });

  it('rejects a ceiling above memory and a bad scrape target', () => {
    const result = validateEnrollment({ ...valid, admission_ceiling_mb: '70000', gateway_target_url: 'tcp://localhost:9100' });
    expect(result.errors.admission_ceiling_mb).toMatch(/exceed/);
    expect(result.errors.gateway_target_url).toMatch(/Loopback/);
  });
});

describe('enrollmentChanges', () => {
  it('lists what a re-enrollment changes', () => {
    const node = { name: 'node-d', lifecycle: 'unavailable', target_url: 'tcp://10.8.0.5:7001', vpcpus: 8, mem_mb: 65536, max_concurrency: 200, admission_ceiling_mb: 55705 } as ComputeNode;
    const body = validateEnrollment(valid).body!;
    expect(enrollmentChanges(node, body)).toEqual(['gateway target: — → tcp://10.8.0.5:9100', 'vCPUs: 8 → 16']);
    expect(enrollmentChanges({ ...node, lifecycle: 'maintenance' }, body)).toContain('lifecycle: maintenance → unavailable');
  });
});

describe('re-enrollment and lifecycle (apid overwrites it on upsert)', () => {
  it('keeps an out-of-placement node out by default', () => {
    expect(draftFromNode({ lifecycle: 'maintenance' } as ComputeNode).defer_activation).toBe(true);
    expect(draftFromNode({ lifecycle: 'active' } as ComputeNode).defer_activation).toBe(false);
  });

  it('blocks edits while a drain is running or after retirement', () => {
    expect(enrollmentLifecycleEffect({ lifecycle: 'draining' }, true).blocked).toMatch(/draining/);
    expect(enrollmentLifecycleEffect({ lifecycle: 'force_draining' }, false).blocked).toMatch(/draining/);
    expect(enrollmentLifecycleEffect({ lifecycle: 'retired' }, true).blocked).toMatch(/Retired/);
  });

  it('reports when an edit would put a node back into placement', () => {
    expect(enrollmentLifecycleEffect({ lifecycle: 'unavailable' }, false)).toEqual({ after: 'active', changes: true, blocked: null });
    expect(enrollmentLifecycleEffect({ lifecycle: 'active' }, false)).toEqual({ after: 'active', changes: false, blocked: null });
  });
});

describe('requests', () => {
  let calls: { url: string; init: RequestInit }[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return init.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ name: 'node-d' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('enrolls with the reason in the query and a stable idempotency key', async () => {
    await enrollComputeNode(validateEnrollment(valid).body!, 'new_capacity', { idempotencyKey: 'k-1' });
    expect(calls[0].url).toBe('/v1/compute-nodes?reason=new_capacity');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('k-1');
  });

  it('always sends a key, even without one from the dialog', async () => {
    await enrollComputeNode(validateEnrollment(valid).body!, 'new_capacity');
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/.+/);
  });

  it('hard-deletes with explicit confirmation', async () => {
    await deleteRetiredComputeNode('node d', 'mistaken_enrollment', { idempotencyKey: 'k-2' });
    expect(calls[0].url).toBe('/v1/compute-nodes/node%20d?hard=1&confirm=true&reason=mistaken_enrollment');
    expect(calls[0].init.method).toBe('DELETE');
  });
});
