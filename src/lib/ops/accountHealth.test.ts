import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTENTION_KINDS,
  ATTENTION_KIND_LABELS,
  attentionQuery,
  contactCustomer,
  diagnosisAttention,
  DISMISS_OUTCOME_LABELS,
  DISMISS_OUTCOMES,
  dismissSignal,
  getAttentionSummary,
  getContactDraft,
  getTenantHealth,
  kindLabel,
  listAttention,
  lookupAccount,
  RESTRICTION_LABELS,
  type ObsTenantDiagnosis,
} from './accountHealth';

let urls: string[];

beforeEach(() => {
  urls = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ query: 'x', matches: [], items: [], limit: 200 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('lookupAccount', () => {
  it('trims and encodes what the customer quoted', async () => {
    await lookupAccount('  https://shop.gregale.app/path?a=1 ');
    expect(urls).toEqual(['/v1/admin/obs/lookup?q=' + encodeURIComponent('https://shop.gregale.app/path?a=1')]);
  });
});

describe('attention filters', () => {
  it('sends only the filters that narrow the list', () => {
    expect(attentionQuery({})).toBe('');
    expect(attentionQuery({ state: 'active' })).toBe('');
    expect(attentionQuery({ state: 'resolved', kind: 'app_oom', accountId: 'a1' })).toBe('?kind=app_oom&state=resolved&account_id=a1');
  });

  it('clamps the limit to what apid accepts', () => {
    expect(attentionQuery({ limit: 5000 })).toBe('?limit=200');
    expect(attentionQuery({ limit: 0.4 })).toBe('');
    expect(attentionQuery({ limit: -3 })).toBe('');
  });

  it('lists through the attention endpoint', async () => {
    await listAttention({ state: 'open' });
    expect(urls).toEqual(['/v1/admin/obs/attention?state=open']);
  });

  it('labels every kind apid emits', () => {
    for (const k of ATTENTION_KINDS) expect(ATTENTION_KIND_LABELS[k]).toBeTruthy();
    expect(kindLabel(RESTRICTION_LABELS, 'brand_new_kind')).toBe('brand new kind');
  });
});

describe('diagnosisAttention', () => {
  const base: ObsTenantDiagnosis = {
    generated_at: '2026-11-15T09:00:00Z',
    restrictions: [],
    failed_deployments: [],
    domain_issues: [],
    healthy_domains: 0,
    enabled_flags: [],
    customer_errors: { window_hours: 24, total: 3, by_code: [], recent: [] },
    attention_signals: [],
  };

  it('is zero for a healthy or missing diagnosis; refused requests alone do not count', () => {
    expect(diagnosisAttention(null)).toBe(0);
    expect(diagnosisAttention(base)).toBe(0);
  });

  it('counts restrictions, open signals, failed deployments and domain problems', () => {
    const signal = (state: string) => ({
      id: 1, account_id: 'a', kind: 'app_oom', subject: 'shop', state, observed: 3,
      first_seen_at: base.generated_at, last_seen_at: base.generated_at,
    });
    const d: ObsTenantDiagnosis = {
      ...base,
      restrictions: [{ kind: 'account_past_due' }],
      attention_signals: [signal('open'), signal('dismissed')],
      failed_deployments: [{ deployment_id: 'd', app_id: 'p', status: 'failed', created_at: base.generated_at }],
      domain_issues: [{ domain: 'www.shop.example', problem: 'certificate issuance failed' }],
    };
    expect(diagnosisAttention(d)).toBe(4);
  });
});

describe('signal actions', () => {
  let calls: { url: string; init?: RequestInit }[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ signal: { id: 7, state: 'dismissed' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  });

  it('dismisses with the outcome, drops a blank note and sends the idempotency key', async () => {
    await dismissSignal(7, 'false_positive', '   ', { idempotencyKey: 'k-1' });
    expect(calls[0].url).toBe('/v1/admin/obs/attention/7/dismiss');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ outcome: 'false_positive' });
    expect(new Headers(calls[0].init?.headers).get('Idempotency-Key')).toBe('k-1');
  });

  it('contacts with the edited draft', async () => {
    await contactCustomer(7, 'Subject', 'deployment', 'Body', { idempotencyKey: 'k-2' });
    expect(calls[0].url).toBe('/v1/admin/obs/attention/7/contact');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ subject: 'Subject', category: 'deployment', body: 'Body' });
  });

  it('reads the draft, the summary and the customer view', async () => {
    await getContactDraft(7);
    await getAttentionSummary();
    await getTenantHealth('a/b');
    expect(calls.map((c) => c.url)).toEqual([
      '/v1/admin/obs/attention/7/contact-draft',
      '/v1/admin/obs/attention/summary',
      '/v1/admin/obs/tenants/a%2Fb/health',
    ]);
  });

  it('labels every dismiss outcome', () => {
    for (const o of DISMISS_OUTCOMES) expect(DISMISS_OUTCOME_LABELS[o]).toBeTruthy();
  });
});
