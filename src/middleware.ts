import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware for Gregale:
 * - Directs traffic for operations.gregale.dev (and operations.localhost) to the dedicated /operations/* application tree.
 * - Provides clean top-level URLs (/overview, /controls, /nodes, /tenants, /anomalies, /rate-limits, /billing, /audit-log, /login).
 * - Injects 'x-is-operations' header for server and client components to detect operator context.
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const url = request.nextUrl.clone();
  const pathname = url.pathname;

  // Detect operations subdomain (e.g., operations.gregale.dev, operations.localhost:3000)
  const isOperationsSubdomain =
    host.startsWith('operations.') || host.includes('.operations.');

  const requestHeaders = new Headers(request.headers);
  if (isOperationsSubdomain) {
    requestHeaders.set('x-is-operations', '1');
  }

  if (isOperationsSubdomain) {
    // If accessing root '/' or '/dashboard', rewrite to operations overview
    if (pathname === '/' || pathname === '/dashboard' || pathname === '/dashboard/admin/overview') {
      url.pathname = '/operations/overview';
      return NextResponse.rewrite(url, {
        request: {
          headers: requestHeaders,
        },
      });
    }

    // Clean top-level URL mappings
    const cleanPaths = [
      'overview',
      'controls',
      'nodes',
      'tenants',
      'anomalies',
      'rate-limits',
      'billing',
      'audit-log',
      'login',
    ];

    for (const p of cleanPaths) {
      if (pathname === `/${p}` || pathname.startsWith(`/${p}/`)) {
        url.pathname = `/operations${pathname}`;
        return NextResponse.rewrite(url, {
          request: {
            headers: requestHeaders,
          },
        });
      }
      if (pathname === `/dashboard/admin/${p}` || pathname.startsWith(`/dashboard/admin/${p}/`)) {
        url.pathname = pathname.replace('/dashboard/admin/', '/operations/');
        return NextResponse.rewrite(url, {
          request: {
            headers: requestHeaders,
          },
        });
      }
    }
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public asset extensions (png, svg, jpg, webp, etc.)
     */
    '/((?!api|_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js)$).*)',
  ],
};
