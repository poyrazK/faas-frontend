import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

vi.mock('./lib/hosting-flag', () => ({ hostingDashboardEnabled: false }));

it.each(['/hosting', '/hosting/site', '/operations/hosting', '/operations/hosting/site', '/dashboard/admin/hosting'])(
  'returns 404 for disabled hosting URL %s before layout streaming', (path) => {
    const response = middleware(new NextRequest(`https://operations.gregale.dev${path}`, { headers: { host: 'operations.gregale.dev' } }));
    expect(response.status).toBe(404);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  },
);

it('keeps the disabled page gate separate from backend runtime admission', () => {
  const response = middleware(new NextRequest('https://operations.gregale.dev/v1/internal/hosting/capabilities', { headers: { host: 'operations.gregale.dev' } }));
  expect(response.status).toBe(200);
});
