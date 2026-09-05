import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

function request(pathname: string) {
  return new NextRequest(`https://operations.gregale.dev${pathname}`, {
    headers: { host: 'operations.gregale.dev' },
  });
}

describe('operations host boundary', () => {
  it('maps runtime configuration to the dedicated operations route', () => {
    const response = middleware(request('/configuration'));

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://operations.gregale.dev/operations/configuration'
    );
  });

  it('maps capacity to the dedicated operations route', () => {
    const response = middleware(request('/dashboard/admin/capacity'));

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://operations.gregale.dev/operations/capacity'
    );
  });

  it('passes backend API requests through for Next rewrites', () => {
    const response = middleware(request('/v1/account'));

    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('does not expose legacy customer dashboard routes', () => {
    const response = middleware(request('/dashboard/apps'));

    expect(response.headers.get('location')).toBe('https://operations.gregale.dev/overview');
  });

  it('does not expose legacy top-level customer routes', () => {
    const response = middleware(request('/signup'));

    expect(response.headers.get('location')).toBe('https://operations.gregale.dev/overview');
  });
});
