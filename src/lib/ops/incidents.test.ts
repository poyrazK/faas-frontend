import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  DEFAULT_INCIDENT_FILTERS,
  getAlertRecurrence,
  getAlertResponseTimes,
  getAlertTriageHistory,
  getAlertWorkloadSummary,
  getIncidentContext,
  getIncidentEvidence,
  auditTrailHref,
  incidentConsoleLinks,
  incidentFiltersFromSearch,
  incidentFiltersToSearch,
  incidentFiltersKey,
  incidentQueryString,
  listIncidents,
  loadIncidentInbox,
  mergeIncidentContext,
  mergeTriageHistory,
  normalizeIncidentFilters,
  parseIncidentId,
  runbookHref,
  snoozeUntil,
  triageAlert,
  triageOptions,
  type ObsAlertTriage,
  type ObsAlertTriageHistory,
  type ObsIncidentContextResponse,
} from './incidents';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  cache?: RequestCache;
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
      cache: init.cache,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ALERT_ID = 'a'.repeat(64);
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0, 123);

const emptyList = {
  unavailable_sources: [],
  generated_at: '2026-10-30T12:00:00Z',
  items: [],
  limit: 50,
  since: '2026-10-29T12:00:00Z',
  since_clamped: false,
  next_cursor: '',
};

describe('incident inbox query', () => {
  it('sends only the limit for the default view, leaving the window to the server', () => {
    expect(incidentQueryString(DEFAULT_INCIDENT_FILTERS, NOW)).toBe('limit=50');
  });

  it('sends triage and alert-status filters only with type=platform_alert', () => {
    const triage = { alertStatus: 'firing', acknowledgment: 'unacknowledged', ownership: 'mine', snooze: 'inactive' } as const;
    const alerts = new URLSearchParams(incidentQueryString({ ...DEFAULT_INCIDENT_FILTERS, type: 'platform_alert', ...triage }, NOW));
    expect(alerts.get('type')).toBe('platform_alert');
    expect(alerts.get('alert_status')).toBe('firing');
    expect(alerts.get('acknowledgment')).toBe('unacknowledged');
    expect(alerts.get('ownership')).toBe('mine');
    expect(alerts.get('snooze')).toBe('inactive');

    // The server answers 400 for these on any other type, so they are dropped.
    const deployments = new URLSearchParams(incidentQueryString({ ...DEFAULT_INCIDENT_FILTERS, type: 'deployment', ...triage }, NOW));
    expect([...deployments.keys()].sort()).toEqual(['limit', 'type']);
  });

  it('computes since as RFC 3339 without milliseconds and clamps long windows outside platform alerts', () => {
    const q = new URLSearchParams(incidentQueryString({ ...DEFAULT_INCIDENT_FILTERS, windowHours: 6, severity: 'critical' }, NOW));
    expect(q.get('since')).toBe('2026-10-30T06:00:00Z');
    expect(q.get('severity')).toBe('critical');

    expect(normalizeIncidentFilters({ ...DEFAULT_INCIDENT_FILTERS, windowHours: 720 }).windowHours).toBe(0);
    expect(normalizeIncidentFilters({ ...DEFAULT_INCIDENT_FILTERS, type: 'platform_alert', windowHours: 720 }).windowHours).toBe(720);
    expect(normalizeIncidentFilters({ ...DEFAULT_INCIDENT_FILTERS, limit: 5000 }).limit).toBe(200);
  });

  it('passes the cursor through and keys pages by every filter including the cursor', () => {
    const page2 = { ...DEFAULT_INCIDENT_FILTERS, cursor: 'opaque+/=' };
    expect(new URLSearchParams(incidentQueryString(page2, NOW)).get('cursor')).toBe('opaque+/=');
    expect(incidentFiltersKey(page2)).not.toBe(incidentFiltersKey(DEFAULT_INCIDENT_FILTERS));
    expect(incidentFiltersKey({ ...DEFAULT_INCIDENT_FILTERS, type: 'job_run', snooze: 'active' })).toBe(
      incidentFiltersKey({ ...DEFAULT_INCIDENT_FILTERS, type: 'job_run' }),
    );
  });

  it('lists incidents with a no-store GET and tags the page with its query', async () => {
    responses.push(json(200, { ...emptyList, unavailable_sources: ['prometheus'] }));
    const filters = { ...DEFAULT_INCIDENT_FILTERS, type: 'compute_node' as const };
    const snapshot = await loadIncidentInbox(filters);
    expect(calls[0].url).toBe('/v1/admin/obs/incidents?limit=50&type=compute_node');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].cache).toBe('no-store');
    expect(snapshot.key).toBe(incidentFiltersKey(filters));
    expect(snapshot.page.unavailable_sources).toEqual(['prometheus']);
  });

  it('surfaces a 400 problem as an ApiError', async () => {
    responses.push(json(400, { title: 'Invalid cursor', status: 400, code: 'validation_failed', detail: 'cursor must be a value returned as next_cursor' }));
    await expect(listIncidents({ ...DEFAULT_INCIDENT_FILTERS, cursor: 'bad' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('incident references and detail reads', () => {
  it('parses canonical references only', () => {
    expect(parseIncidentId(`deployment/${UUID}`)).toEqual({ kind: 'deployment', id: UUID });
    expect(parseIncidentId(`platform_alert/${ALERT_ID}`)).toEqual({ kind: 'platform_alert', id: ALERT_ID });
    expect(parseIncidentId(`deployment/${UUID.toUpperCase()}`)).toBeNull();
    expect(parseIncidentId(`platform_alert/${UUID}`)).toBeNull();
    expect(parseIncidentId(`widget/${UUID}`)).toBeNull();
    expect(parseIncidentId('job_run')).toBeNull();
  });

  it('reads evidence and paged context under the typed incident path', async () => {
    responses.push(json(200, {}), json(200, {}), json(200, {}));
    await getIncidentEvidence({ kind: 'job_run', id: UUID });
    await getIncidentContext({ kind: 'platform_alert', id: ALERT_ID }, { cursor: 'c1', historyLimit: 50 });
    await getAlertTriageHistory(ALERT_ID, 'next');
    expect(calls.map((c) => c.url)).toEqual([
      `/v1/admin/obs/incidents/job_run/${UUID}/evidence`,
      `/v1/admin/obs/incidents/platform_alert/${ALERT_ID}/context?history_limit=50&cursor=c1`,
      `/v1/admin/obs/incidents/platform_alert/${ALERT_ID}/triage-history?cursor=next`,
    ]);
    expect(calls.every((c) => c.method === 'GET' && c.cache === 'no-store')).toBe(true);
  });

  it('never sends an empty since to the strict summary routes', async () => {
    responses.push(json(200, {}), json(200, {}), json(200, {}), json(200, {}));
    await getAlertWorkloadSummary();
    await getAlertRecurrence();
    await getAlertResponseTimes(undefined);
    await getAlertRecurrence('2026-10-23T12:00:00Z');
    expect(calls.map((c) => c.url)).toEqual([
      '/v1/admin/obs/incidents/platform_alert/summary',
      '/v1/admin/obs/incidents/platform_alert/recurrence',
      '/v1/admin/obs/incidents/platform_alert/response-times',
      '/v1/admin/obs/incidents/platform_alert/recurrence?since=2026-10-23T12%3A00%3A00Z',
    ]);
  });
});

describe('alert triage write', () => {
  it('POSTs the closed body with the dialog idempotency key', async () => {
    responses.push(json(200, { incident_id: `platform_alert/${ALERT_ID}`, triage: { revision: 4 } }));
    const res = await triageAlert(
      ALERT_ID,
      { action: 'snooze', expected_revision: 3, snoozed_until: '2026-10-30T13:00:00.000Z' },
      { idempotencyKey: 'key-1' },
    );
    expect(res.triage.revision).toBe(4);
    expect(calls[0]).toMatchObject({
      url: `/v1/admin/obs/incidents/platform_alert/${ALERT_ID}/triage`,
      method: 'POST',
      body: { action: 'snooze', expected_revision: 3, snoozed_until: '2026-10-30T13:00:00.000Z' },
    });
    expect(calls[0].headers['Idempotency-Key']).toBe('key-1');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
  });

  it('reports a revision conflict as a 409 ApiError', async () => {
    responses.push(json(409, { title: 'Triage changed or owned by another operator', status: 409, code: 'conflict' }));
    await expect(triageAlert(ALERT_ID, { action: 'acknowledge', expected_revision: 0 })).rejects.toMatchObject({ status: 409 });
  });

  it('offers the actions that fit the state, disabling release for another owner', () => {
    const base: ObsAlertTriage = { revision: 2, acknowledged: false, owned: false, snoozed: false, as_of: '' };
    expect(triageOptions(base, 'me').map((o) => o.action)).toEqual(['acknowledge', 'claim', 'snooze']);

    const ownedByOther = triageOptions({ ...base, acknowledged: true, owned: true, owner_account_id: 'them', snoozed: true }, 'me');
    expect(ownedByOther.map((o) => o.action)).toEqual(['unacknowledge', 'release', 'unsnooze']);
    expect(ownedByOther[1].disabledReason).toBeTruthy();

    const mine = triageOptions({ ...base, owned: true, owner_account_id: 'me' }, 'me');
    expect(mine[1]).toEqual({ action: 'release', label: 'Release ownership' });
  });

  it('keeps snoozes inside the 24 hour server bound', () => {
    expect(snoozeUntil(60, NOW)).toBe(new Date(NOW + 3_600_000).toISOString());
    expect(Date.parse(snoozeUntil(48 * 60, NOW)) - NOW).toBeLessThan(24 * 3_600_000);
  });
});

describe('linking', () => {
  it('maps API action paths onto console pages', () => {
    expect(
      incidentConsoleLinks({ type: 'compute_node', action_path: '/v1/admin/obs/nodes/n1/detail', audit_path: '/v1/admin/obs/audit-log/search?kind_prefix=operator.action.' }),
    ).toEqual([
      { href: '/nodes?node=n1', label: 'Compute node' },
      { href: '/audit-log?kind=operator.action.', label: 'Audit trail' },
    ]);
    expect(incidentConsoleLinks({ type: 'platform_alert', action_path: '/v1/admin/obs/health' })).toEqual([
      { href: '/telemetry', label: 'Telemetry health' },
    ]);
    expect(incidentConsoleLinks({ type: 'deployment', action_path: `/v1/admin/ops/deployments/${UUID}`, account_id: UUID })).toEqual([
      { href: `/tenants/${UUID}`, label: 'Tenant' },
    ]);
    expect(incidentConsoleLinks({ type: 'deployment', resource_id: UUID, account_id: UUID })[0]).toEqual({
      href: `/deployments?deployment=${UUID}`,
      label: 'Deployment',
    });
    expect(incidentConsoleLinks({ type: 'job_run', resource_id: UUID })[0].href).toBe(`/jobs?run=${UUID}`);
    expect(incidentConsoleLinks({ type: 'compute_node', resource_id: UUID, resource_name: 'node-a' })[0].href).toBe('/nodes?node=node-a');
    expect(incidentConsoleLinks({ type: 'platform_alert', action_path: `/v1/admin/obs/incidents/compute_node/${UUID}/evidence` })[0].href).toBe('/nodes');
  });

  it('only opens repository documentation as runbooks', () => {
    expect(runbookHref('/docs/runbooks/FaasDeployFailed.md')).toBe('https://github.com/poyrazK/faas/blob/main/docs/runbooks/FaasDeployFailed.md');
    expect(runbookHref('https://github.com/poyrazK/faas/blob/main/docs/ops/x.md#a')).toBe('https://github.com/poyrazK/faas/blob/main/docs/ops/x.md#a');
    expect(runbookHref('https://evil.example/docs/x')).toBeNull();
    expect(runbookHref('/docs/../secrets')).toBeNull();
    expect(runbookHref(undefined)).toBeNull();
  });
});

describe('paging merges', () => {
  const context = (resources: string[], timeline: string[], extra: Partial<ObsIncidentContextResponse> = {}): ObsIncidentContextResponse => ({
    as_of: '',
    incident_id: `deployment/${UUID}`,
    incident_status: 'failed',
    incident_observed_at: '',
    evidence_path: '',
    scope: { state: 'known', basis: 'resource' },
    counts: null,
    resources: resources.map((id) => ({ kind: 'app', id, status: 'live', relationship: 'owner', confirmed_failure: false })),
    limit: 25,
    next_cursor: '',
    since: '',
    until: '',
    timeline: timeline.map((id) => ({ resource_kind: 'app', resource_id: 'a', match: 'subject', entry: { id, source: 's', kind: 'k', at: '' } })),
    timeline_scope: '',
    timeline_limit: 25,
    timeline_truncated: false,
    unavailable_sources: [],
    ...extra,
  });

  it('appends context pages without duplicates and keeps truncation and gaps sticky', () => {
    const merged = mergeIncidentContext(
      context(['a1', 'a2'], ['e1'], { timeline_truncated: true, unavailable_sources: ['incident_scope'] }),
      context(['a2', 'a3'], ['e1', 'e2'], { next_cursor: 'c2' }),
    );
    expect(merged.resources.map((r) => r.id)).toEqual(['a1', 'a2', 'a3']);
    expect(merged.timeline.map((t) => t.entry.id)).toEqual(['e1', 'e2']);
    expect(merged.next_cursor).toBe('c2');
    expect(merged.timeline_truncated).toBe(true);
    expect(merged.unavailable_sources).toEqual(['incident_scope']);
  });

  it('appends older triage receipts', () => {
    const page = (ids: number[], next = ''): ObsAlertTriageHistory => ({
      incident_id: '',
      generated_at: '',
      snapshot_at: '',
      snapshot_revision: 5,
      current_revision: 5,
      items: ids.map((revision) => ({ id: `r${revision}`, revision, action: 'acknowledge', at: '', acknowledged: true, owned: false })),
      limit: 2,
      truncated: !!next,
      next_cursor: next,
      history_path: '',
      coverage: { state: 'complete', available_entries: 5, missing_entries: 0 },
    });
    const merged = mergeTriageHistory(page([5, 4], 'n'), page([4, 3]));
    expect(merged.items.map((i) => i.revision)).toEqual([5, 4, 3]);
    expect(merged.next_cursor).toBe('');
  });
});

describe('inbox filters in the page URL', () => {
  it('round-trips through the query string, keeping defaults out of it', () => {
    const filters = incidentFiltersFromSearch(new URLSearchParams('type=platform_alert&severity=critical&window=720&ack=unacknowledged&owner=mine'));
    expect(filters).toMatchObject({ type: 'platform_alert', severity: 'critical', windowHours: 720, acknowledgment: 'unacknowledged', ownership: 'mine', cursor: '' });
    expect(incidentFiltersToSearch(filters)).toEqual({
      type: 'platform_alert',
      severity: 'critical',
      window: '720',
      alert_status: null,
      ack: 'unacknowledged',
      owner: 'mine',
      snooze: null,
    });
    expect(Object.values(incidentFiltersToSearch(incidentFiltersFromSearch(new URLSearchParams())))).toEqual(Array(7).fill(null));
  });

  it('drops unknown values and alert-only filters on other sources', () => {
    const filters = incidentFiltersFromSearch(new URLSearchParams('type=bogus&severity=meh&window=5&ack=acknowledged'));
    expect(filters).toMatchObject({ type: '', severity: '', windowHours: 0, acknowledgment: '' });
    expect(incidentFiltersFromSearch(new URLSearchParams('type=deployment&window=720')).windowHours).toBe(0);
  });

  it('opens audit searches as the audit trail with the same filters', () => {
    expect(auditTrailHref(`/v1/admin/obs/audit-log/search?kind_prefix=operator.&target_account_id=${UUID}&operator_only=true&limit=50`)).toBe(
      `/audit-log?kind=operator.&account=${UUID}&operator=1`,
    );
    expect(auditTrailHref('/v1/admin/obs/audit-log/search')).toBe('/audit-log');
    expect(auditTrailHref('/v1/admin/obs/health')).toBeNull();
  });
});
