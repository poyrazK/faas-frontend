import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware for Gregale:
 * - Directs traffic for operations.gregale.dev (and operations.localhost) to the dedicated /operations/* application tree.
 * - Provides clean top-level URLs for every operator surface.
 * - Prevents legacy customer dashboard routes from being served on the operations host.
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
    // Backend-proxied requests must reach Next's rewrites. The operations-host
    // catch-all redirect below must not turn an API/auth/health response into
    // an HTML navigation response.
    const isBackendProxyPath =
      pathname === '/v1' ||
      pathname.startsWith('/v1/') ||
      pathname === '/oauth' ||
      pathname.startsWith('/oauth/') ||
      pathname === '/auth' ||
      pathname.startsWith('/auth/') ||
      pathname === '/logout' ||
      pathname === '/healthz';

    if (isBackendProxyPath) {
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    }

    // If accessing a legacy root or dashboard URL, rewrite to operations overview.
    if (
      pathname === '/' ||
      pathname === '/dashboard' ||
      pathname === '/operations' ||
      pathname === '/dashboard/admin/overview'
    ) {
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
      'capacity',
      'tenants',
      'anomalies',
      'rate-limits',
      'billing',
      'configuration',
      'audit-log',
      'incidents',
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

    // This project still contains the historical customer dashboard tree for
    // compatibility with old previews. It must never be reachable from the
    // operator hostname: customer traffic belongs to faas-web/gregale.dev.
    if (pathname.startsWith('/dashboard')) {
      return NextResponse.redirect(new URL('/overview', request.url));
    }

    // Keep the production operations deployment scoped to its operator tree.
    // Unknown top-level paths should not fall through to the legacy customer
    // pages or marketing routes.
    if (!pathname.startsWith('/operations/')) {
      return NextResponse.redirect(new URL('/overview', request.url));
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
