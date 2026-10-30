import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyManagedPostgresReconciliation,
  applyManagedPostgresUsageImport,
  egressQueryError,
  formatMillicents,
  getManagedPostgresAccounting,
  getManagedPostgresUsage,
  isImportText,
  isIpOrCidr,
  listEgressFlows,
  newRequestId,
  objectStoragePeriodStart,
  objectStorageReportError,
  parseCount,
  parseRfc3339Micros,
  parseUsageImportWindows,
  previewManagedPostgresReconciliation,
  previewManagedPostgresUsageImport,
  reconciliationFieldError,
  recordObjectStorageUsageReport,
  usageImportFieldError,
  usageImportTemplate,
  type ManagedPostgresReconciliationRequest,
  type ManagedPostgresUsageImportRequest,
  type ObjectStorageUsageReport,
} from './metering';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[];
let responses: Response[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ACCOUNT = '0b6f7a52-3c1d-4e8f-9a2b-5c6d7e8f9a0b';
const DB = '7d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6';
const SHA = 'a'.repeat(64);
const NOW = Date.parse('2026-10-30T12:00:00Z');

describe('egress flows', () => {
  it('sends only the filters that are set', async () => {
    responses.push(json(200, { flows: [], truncated: false }), json(200, { flows: [], truncated: true }));
    await listEgressFlows();
    await listEgressFlows({
      remote: ' 203.0.113.7 ',
      account_id: ACCOUNT,
      from: '2026-10-29T00:00:00Z',
      to: '2026-10-30T00:00:00Z',
      limit: 500,
    });
    expect(calls[0].url).toBe('/v1/admin/egress-flows');
    expect(calls[1].url).toBe(
      `/v1/admin/egress-flows?remote=203.0.113.7&account_id=${ACCOUNT}&from=2026-10-29T00%3A00%3A00Z&to=2026-10-30T00%3A00%3A00Z&limit=500`,
    );
  });

  it('mirrors the server query validation', () => {
    expect(egressQueryError({}, NOW)).toBeNull();
    expect(egressQueryError({ remote: '10.0.0.0/8' }, NOW)).toBeNull();
    expect(egressQueryError({ remote: '2001:db8::/32' }, NOW)).toBeNull();
    expect(egressQueryError({ remote: 'example.com' }, NOW)).toMatch(/IP address or CIDR/);
    expect(egressQueryError({ remote: '10.0.0.0/33' }, NOW)).toMatch(/IP address or CIDR/);
    expect(egressQueryError({ account_id: 'nope' }, NOW)).toMatch(/UUID/);
    expect(egressQueryError({ from: '2026-10-30T12:00:00Z', to: '2026-10-30T11:00:00Z' }, NOW)).toMatch(/before/);
    expect(egressQueryError({ from: '2026-09-01T00:00:00Z', to: '2026-10-30T00:00:00Z' }, NOW)).toMatch(/30-day/);
    expect(egressQueryError({ limit: 1001 }, NOW)).toMatch(/between 1 and 1000/);
    expect(isIpOrCidr('256.1.1.1')).toBe(false);
  });
});

describe('managed postgres reads', () => {
  it('encodes the account and pages diagnostics by database cursor', async () => {
    responses.push(json(200, {}), json(200, {}));
    await getManagedPostgresUsage(ACCOUNT);
    await getManagedPostgresAccounting(ACCOUNT, DB, 25);
    expect(calls[0].url).toBe(`/v1/admin/managed-postgres/usage/${ACCOUNT}`);
    expect(calls[1].url).toBe(`/v1/admin/managed-postgres/accounting/${ACCOUNT}?limit=25&after=${DB}`);
  });
});

const importBody: ManagedPostgresUsageImportRequest = {
  import_id: '11111111-2222-4333-8444-555555555555',
  database_id: DB,
  evidence_reference: 'provider-export-2026-10',
  evidence_sha256: SHA,
  reason: 'Provider export recovered missing October usage (SUP-88)',
  windows: [
    {
      from: '2026-10-30T10:00:00Z',
      to: '2026-10-30T11:00:00Z',
      observed_at: '2026-10-30T11:00:05Z',
      readings: [{ meter: 'compute_unit_seconds', quantity: 120 }],
    },
  ],
};

describe('managed postgres usage import', () => {
  it('previews without expected_revision and applies the identical body with it', async () => {
    responses.push(json(200, { revision: SHA, applied: false }), json(200, { revision: SHA, applied: true }));
    const preview = await previewManagedPostgresUsageImport(ACCOUNT, importBody);
    await applyManagedPostgresUsageImport(ACCOUNT, importBody, preview.revision, { idempotencyKey: 'k-9' });

    expect(calls[0]).toMatchObject({
      url: `/v1/admin/managed-postgres/accounting/${ACCOUNT}/usage-imports/preview`,
      method: 'POST',
      body: importBody,
    });
    expect(calls[0].body).not.toHaveProperty('expected_revision');
    expect(calls[1]).toMatchObject({
      url: `/v1/admin/managed-postgres/accounting/${ACCOUNT}/usage-imports`,
      method: 'POST',
      body: { ...importBody, expected_revision: SHA },
    });
    expect(calls[1].headers['Idempotency-Key']).toBe('k-9');
  });

  it('parses and validates the windows JSON like the server', () => {
    const ok = parseUsageImportWindows(JSON.stringify(importBody.windows), { now: NOW, windowSeconds: 3600 });
    expect(ok).toEqual({ windows: importBody.windows });

    const err = (windows: unknown, windowSeconds?: number) => {
      const res = parseUsageImportWindows(JSON.stringify(windows), { now: NOW, windowSeconds });
      return 'error' in res ? res.error : null;
    };
    const w = importBody.windows[0];
    expect(parseUsageImportWindows('{', { now: NOW })).toHaveProperty('error');
    expect(err([])).toMatch(/non-empty/);
    expect(err([{ ...w, extra: 1 }])).toMatch(/unknown field/);
    expect(err([{ ...w, to: w.from }])).toMatch(/after from/);
    expect(err([w], 300)).toMatch(/policy window/);
    expect(err([{ ...w, observed_at: '2026-10-30T10:59:59Z' }])).toMatch(/not be before to/);
    expect(err([{ ...w, observed_at: '2026-10-31T00:00:00Z' }])).toMatch(/future/);
    expect(err([{ ...w, from: '2026-10-30T10:00:00.0000001Z' }])).toMatch(/microsecond/);
    expect(err([w, { ...w, from: '2026-10-30T11:30:00Z', to: '2026-10-30T11:45:00Z', observed_at: '2026-10-30T11:50:00Z' }])).toMatch(/previous window ended/);
    expect(err([{ ...w, readings: [{ meter: 'cpu', quantity: 1 }] }])).toMatch(/unknown meter/);
    expect(err([{ ...w, readings: [{ meter: 'egress_bytes', quantity: -1 }] }])).toMatch(/non-negative/);
    expect(
      err([{ ...w, readings: [{ meter: 'egress_bytes', quantity: 1 }, { meter: 'egress_bytes', quantity: 2 }] }]),
    ).toMatch(/twice/);
  });

  it('accepts microsecond precision and offsets', () => {
    expect(parseRfc3339Micros('2026-10-30T10:00:00.123456Z')).toBe(Date.parse('2026-10-30T10:00:00Z') * 1000 + 123456);
    expect(parseRfc3339Micros('2026-10-30T12:00:00+02:00')).toBe(Date.parse('2026-10-30T10:00:00Z') * 1000);
    expect(parseRfc3339Micros('2026-10-30T10:00:00.123456000Z')).not.toBeNull();
    expect(parseRfc3339Micros('2026-10-30 10:00:00')).toBeNull();
  });

  it('builds a template aligned to the policy window', () => {
    const [w] = usageImportTemplate(3600, Date.parse('2026-10-30T12:34:56Z'));
    expect(w).toMatchObject({ from: '2026-10-30T11:00:00Z', to: '2026-10-30T12:00:00Z', observed_at: '2026-10-30T12:00:00Z' });
  });

  it('checks the request fields', () => {
    const fields = {
      import_id: importBody.import_id,
      database_id: importBody.database_id,
      evidence_reference: importBody.evidence_reference,
      evidence_sha256: importBody.evidence_sha256,
      reason: importBody.reason,
    };
    expect(usageImportFieldError(fields)).toBeNull();
    expect(usageImportFieldError({ ...fields, evidence_sha256: SHA.toUpperCase() })).toMatch(/lowercase/);
    expect(usageImportFieldError({ ...fields, reason: ' padded ' })).toMatch(/Reason/);
    expect(usageImportFieldError({ ...fields, import_id: 'x' })).toMatch(/Import ID/);
    expect(isImportText('line\nbreak', 100)).toBe(false);
  });
});

const reconcileBody: ManagedPostgresReconciliationRequest = {
  reconciliation_id: '99999999-8888-4777-8666-555555555555',
  database_id: DB,
  backend_id: 'neon-eu',
  backend_fingerprint: SHA,
  provider_resource_id: 'projects/p-1/branches/b-2',
  shutdown_at: '2026-10-20T08:00:00Z',
  observed_at: '2026-10-20T08:05:00Z',
  evidence_reference: 'provider-ticket-4411',
  evidence_sha256: SHA,
  reason: 'Provider confirmed shutdown; ledger never recorded it',
};

describe('managed postgres reconciliation', () => {
  it('previews then applies with the preview revision', async () => {
    responses.push(json(200, { revision: SHA, applied: false }), json(200, { revision: SHA, applied: true }));
    await previewManagedPostgresReconciliation(ACCOUNT, reconcileBody);
    await applyManagedPostgresReconciliation(ACCOUNT, reconcileBody, SHA, { idempotencyKey: 'k-r' });
    expect(calls[0].url).toBe(`/v1/admin/managed-postgres/accounting/${ACCOUNT}/reconciliations/preview`);
    expect(calls[0].body).toEqual(reconcileBody);
    expect(calls[1].url).toBe(`/v1/admin/managed-postgres/accounting/${ACCOUNT}/reconciliations`);
    expect(calls[1].body).toEqual({ ...reconcileBody, expected_revision: SHA });
    expect(calls[1].headers['Idempotency-Key']).toBe('k-r');
  });

  it('mirrors validateAccountingReconciliation', () => {
    expect(reconciliationFieldError(reconcileBody, NOW)).toBeNull();
    expect(reconciliationFieldError({ ...reconcileBody, observed_at: '2026-10-20T07:00:00Z' }, NOW)).toMatch(/before the shutdown/);
    expect(reconciliationFieldError({ ...reconcileBody, observed_at: '2026-11-01T00:00:00Z' }, NOW)).toMatch(/future/);
    expect(reconciliationFieldError({ ...reconcileBody, backend_fingerprint: 'abc' }, NOW)).toMatch(/fingerprint/);
  });
});

describe('object storage usage report', () => {
  const report: ObjectStorageUsageReport = {
    account_id: ACCOUNT,
    backend_id: 'r2-eu',
    backend_fingerprint: SHA,
    source: 'r2-billing-export',
    period_start: '2026-10-01T00:00:00Z',
    observed_at: '2026-10-30T11:00:00Z',
    stored_byte_hours: 0,
    request_count: 12,
    egress_bytes: 0,
    cost_millicents: 0,
  };

  it('posts every field, including explicit zeros, and expects no body', async () => {
    responses.push(new Response(null, { status: 204 }));
    await expect(recordObjectStorageUsageReport(report, { idempotencyKey: 'k-o' })).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ url: '/v1/admin/object-storage/usage-reports', method: 'POST', body: report });
    expect(Object.keys(calls[0].body as object)).toHaveLength(10);
    expect(calls[0].headers['Idempotency-Key']).toBe('k-o');
  });

  it('derives the UTC month and validates like the store', () => {
    expect(objectStoragePeriodStart('2026-11-01T00:30:00+02:00')).toBe('2026-10-01T00:00:00Z');
    expect(objectStorageReportError(report, NOW)).toBeNull();
    expect(objectStorageReportError({ ...report, period_start: '2026-09-01T00:00:00Z' }, NOW)).toMatch(/Period start/);
    expect(objectStorageReportError({ ...report, egress_bytes: -1 }, NOW)).toMatch(/non-negative/);
    expect(objectStorageReportError({ ...report, backend_id: 'x'.repeat(64) }, NOW)).toMatch(/63/);
  });
});

describe('helpers', () => {
  it('formats millicents without inventing a currency', () => {
    expect(formatMillicents(123_456)).toBe('1.23456');
    expect(formatMillicents(100_000)).toBe('1.00');
    expect(formatMillicents(-50_000)).toBe('-0.50');
    expect(formatMillicents(100_000, 'usd')).toMatch(/1\.00/);
  });

  it('parses counts and mints UUIDs', () => {
    expect(parseCount('42')).toBe(42);
    expect(parseCount('4.2')).toBeNull();
    expect(parseCount('99999999999999999999')).toBeNull();
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
