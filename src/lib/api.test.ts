import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  confirmMfa,
  enrollMfa,
  forceParkInstance,
  getAccount,
  getObsOverview,
  logout,
  needsEnrollment,
  probeOperatorAccess,
  REQUEST_TIMEOUT_MS,
  rollbackOperatorRuntimeConfig,
  setStepUpHandler,
  setUnauthorizedHandler,
  updateOperatorRuntimeConfig,
} from './api';

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
  setStepUpHandler(null);
  setUnauthorizedHandler(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('operator writes', () => {
  it('replays a step-up-gated write once, with the same idempotency key', async () => {
    const stepUp = vi.fn(async () => true);
    setStepUpHandler(stepUp);
    responses.push(
      json(403, { title: 'Step-up required', status: 403, code: 'step_up_required' }),
      json(202, { ok: true, intent_id: 'intent-1', status_url: '/v1/admin/operator-intents/intent-1', expires_at: '' }),
    );

    const res = await forceParkInstance('inst-1', 'stuck_instance', { idempotencyKey: 'key-abc' });

    expect(res.intent_id).toBe('intent-1');
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].headers['Idempotency-Key']).toBe('key-abc');
    expect(calls[1].headers['Idempotency-Key']).toBe('key-abc');
    expect(calls[1].url).toContain('reason=stuck_instance');
  });

  it('surfaces step_up_required when the operator cancels the prompt', async () => {
    setStepUpHandler(async () => false);
    responses.push(json(403, { title: 'Step-up required', status: 403, code: 'step_up_required' }));

    await expect(forceParkInstance('inst-1', 'stuck_instance')).rejects.toMatchObject({ code: 'step_up_required' });
    expect(calls).toHaveLength(1);
  });

  it('mints a key for an admin write when the caller has none', async () => {
    responses.push(json(202, { ok: true, intent_id: 'i', status_url: '', expires_at: '' }));
    await forceParkInstance('inst-1', 'stuck_instance');
    expect(calls[0].headers['Idempotency-Key']).toMatch(/.+/);
  });
});

describe('runtime config writes', () => {
  it('sends only the fields apid accepts', async () => {
    responses.push(json(200, { key: 'k', version: 4 }));
    await updateOperatorRuntimeConfig('k', true, 'ticket OPS-1', 3);
    expect(calls[0].body).toEqual({ value: true, reason: 'ticket OPS-1', expected_version: 3 });
  });

  it('adds force only when asked, for core platform flags', async () => {
    responses.push(json(200, { key: 'k', version: 4 }), json(200, { key: 'k', version: 5 }));
    await updateOperatorRuntimeConfig('k', { enabled: false }, 'incident', 3, { force: true });
    await rollbackOperatorRuntimeConfig('k', 2, 'revert', 4);
    expect(calls[0].body).toEqual({ value: { enabled: false }, reason: 'incident', expected_version: 3, force: true });
    expect(calls[1].body).toEqual({ version: 2, reason: 'revert', expected_version: 4 });
  });
});

describe('session', () => {
  it('logs out with a CSRF token bound to auth.logout', async () => {
    responses.push(json(200, { csrf_token: 'tok-1' }), new Response(null, { status: 204 }));
    await logout();
    expect(calls[0].url).toBe('/v1/auth/csrf?action=auth.logout');
    expect(calls[1]).toMatchObject({ url: '/v1/auth/logout', method: 'POST', body: { csrf_token: 'tok-1' } });
  });

  it('treats an already-gone session as signed out', async () => {
    responses.push(json(401, { title: 'Unauthorized', status: 401, code: 'unauthorized' }));
    await expect(logout()).resolves.toBeUndefined();
  });

  it('reports a refused logout instead of hiding it', async () => {
    responses.push(json(200, { csrf_token: 'tok-1' }), json(400, { title: 'CSRF', status: 400, code: 'csrf_mismatch' }));
    await expect(logout()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('operator access probe', () => {
  it('distinguishes non-operators from transient failures', async () => {
    responses.push(json(200, { items: [] }));
    await expect(probeOperatorAccess()).resolves.toBe('granted');

    responses.push(json(403, { title: 'Forbidden', status: 403, code: 'forbidden' }));
    await expect(probeOperatorAccess()).resolves.toBe('denied');

    responses.push(json(503, { title: 'Unavailable', status: 503, code: 'capacity' }));
    await expect(probeOperatorAccess()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('on-call resilience', () => {
  it('abandons a request the control plane never answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const pending = getObsOverview();
    const assertion = expect(pending).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/did not answer within/) });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await assertion;
  });

  it('reports a mid-session 401, but not the session probes that expect one', async () => {
    const expired = vi.fn();
    setUnauthorizedHandler(expired);
    responses.push(json(401, { title: 'Unauthorized', status: 401, code: 'session_expired' }));
    await expect(getObsOverview()).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);

    responses.push(json(401, { title: 'Unauthorized', status: 401, code: 'unauthorized' }));
    await expect(getAccount()).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('hands the step-up prompt the reason, so it can tell enrollment from a code', async () => {
    const stepUp = vi.fn<(reason: ApiError) => Promise<boolean>>(async () => false);
    setStepUpHandler(stepUp);
    const notEnrolled = {
      title: 'MFA required',
      status: 403,
      code: 'mfa_required',
      detail: 'platform operators must enroll an authenticator: complete /v1/account/mfa/enroll and /v1/account/mfa/confirm',
    };
    responses.push(json(403, notEnrolled));
    await expect(forceParkInstance('i-1', 'stuck_instance')).rejects.toBeInstanceOf(ApiError);
    expect(needsEnrollment(stepUp.mock.calls[0][0])).toBe(true);
    expect(needsEnrollment(new ApiError({ ...notEnrolled, detail: 'complete /v1/account/mfa/enroll or /v1/account/mfa/verify' }, 403, ''))).toBe(false);
  });

  it('enrolls and confirms with the shapes apid expects', async () => {
    responses.push(json(200, { otpauth_url: 'otpauth://x', secret: 'S', qr_code_png_base64: 'iVBOR', recovery_codes: ['A-B'] }));
    await expect(enrollMfa()).resolves.toMatchObject({ secret: 'S' });
    expect(calls[0]).toMatchObject({ url: '/v1/account/mfa/enroll', method: 'POST', body: {} });

    responses.push(json(200, { csrf_token: 'tok' }), json(200, {}));
    await confirmMfa('123456');
    expect(calls[1].url).toBe('/v1/auth/csrf?action=mfa_confirm');
    expect(calls[2]).toMatchObject({ url: '/v1/account/mfa/confirm', method: 'POST', body: { totp: '123456', csrf_token: 'tok' } });
    expect(calls[2].headers['Idempotency-Key']).toMatch(/.+/);
  });
});

