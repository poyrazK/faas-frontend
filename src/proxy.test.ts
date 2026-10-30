import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { OPS_ROUTES } from '@/lib/routes';

function request(pathname: string, host = 'operations.gregale.dev') {
  return new NextRequest(`https://${host}${pathname}`, { headers: { host } });
}

const rewriteOf = (pathname: string, host?: string) => proxy(request(pathname, host)).headers.get('x-middleware-rewrite');
const redirectOf = (pathname: string, host?: string) => proxy(request(pathname, host)).headers.get('location');

describe('operator console routing', () => {
  it.each(OPS_ROUTES.map((route) => route.slug))('serves /%s from app/operations', (slug) => {
    expect(rewriteOf(`/${slug}`)).toBe(`https://operations.gregale.dev/operations/${slug}`);
  });

  it('keeps nested paths and works on preview hosts too', () => {
    expect(rewriteOf('/tenants/abc', 'faas-frontend-git-x.vercel.app')).toBe(
      'https://faas-frontend-git-x.vercel.app/operations/tenants/abc',
    );
  });

  it('gives every page one address', () => {
    expect(redirectOf('/operations/configuration?x=1')).toBe('https://operations.gregale.dev/configuration?x=1');
    expect(redirectOf('/operations/login')).toBe('https://operations.gregale.dev/login');
  });

  it.each(['/', '/operations', '/dashboard', '/dashboard/admin/nodes', '/dashboard/apps'])(
    'sends legacy entry point %s to the fleet overview',
    (path) => {
      expect(redirectOf(path)).toBe('https://operations.gregale.dev/overview');
    },
  );

  it.each(['/v1/account', '/v1/admin/obs/overview', '/healthz'])('passes %s through to the backend rewrite', (path) => {
    const response = proxy(request(path));
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('lets unknown paths fall through to the 404 page', () => {
    const response = proxy(request('/signup'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
