import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendAdminStatusUpdate,
  createAdminStatusEvent,
  editAdminStatusEventTitle,
  editAdminStatusUpdateMessage,
  getPublicStatusOverview,
  listAdminStatusEvents,
} from './status';

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

afterEach(() => vi.unstubAllGlobals());

const ID = '0b0e5c9e-6a4f-4d5e-9a7b-2d1f3c4b5a69';

describe('status reads', () => {
  it('lists with optional kind and active filters, and reads the public snapshot', async () => {
    responses.push(json(200, []), json(200, []), json(200, { components: [] }));
    await listAdminStatusEvents();
    await listAdminStatusEvents({ kind: 'maintenance', active: true });
    await getPublicStatusOverview();
    expect(calls.map((call) => call.url)).toEqual([
      '/v1/admin/status/incidents',
      '/v1/admin/status/incidents?kind=maintenance&active=true',
      '/v1/status',
    ]);
  });
});

describe('status writes', () => {
  it('creates with the exact body and the dialog idempotency key', async () => {
    responses.push(json(201, { id: ID }));
    const body = {
      kind: 'incident' as const,
      title: 'Elevated errors',
      impact: 'degraded' as const,
      components: ['deployments' as const],
      state: 'investigating' as const,
      message: 'Investigating.',
    };
    await createAdminStatusEvent(body, { idempotencyKey: 'key-1' });
    expect(calls[0]).toMatchObject({ url: '/v1/admin/status/incidents', method: 'POST', body });
    expect(calls[0].headers['Idempotency-Key']).toBe('key-1');
  });

  it('appends updates and corrects titles and messages without a reason field', async () => {
    responses.push(json(200, { id: ID }), json(200, { id: ID }), json(200, { id: ID }));
    await appendAdminStatusUpdate(ID, { state: 'resolved', message: 'All clear.' }, { idempotencyKey: 'k2' });
    await editAdminStatusEventTitle(ID, 'Better title', { idempotencyKey: 'k3' });
    await editAdminStatusUpdateMessage(ID, 'u/1', 'Fixed typo', { idempotencyKey: 'k4' });
    expect(calls.map((call) => [call.method, call.url, call.body, call.headers['Idempotency-Key']])).toEqual([
      ['POST', `/v1/admin/status/incidents/${ID}/updates`, { state: 'resolved', message: 'All clear.' }, 'k2'],
      ['PATCH', `/v1/admin/status/incidents/${ID}`, { title: 'Better title' }, 'k3'],
      ['PATCH', `/v1/admin/status/incidents/${ID}/updates/u%2F1`, { message: 'Fixed typo' }, 'k4'],
    ]);
  });

  it('surfaces a refused transition as a 409 with the publicstatus code', async () => {
    responses.push(json(409, { title: 'Status event rejected', status: 409, code: 'status_invalid_transition', detail: 'cannot move' }));
    await expect(appendAdminStatusUpdate(ID, { state: 'completed', message: 'x' })).rejects.toMatchObject({
      status: 409,
      code: 'status_invalid_transition',
    });
  });
});
