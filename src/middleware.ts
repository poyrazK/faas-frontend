import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware for Gregale:
 * - Handles subdomain routing for operations.gregale.dev (and operations.localhost for dev).
 * - When accessing the operations subdomain, routes root '/' and '/dashboard' directly
 *   to '/dashboard/admin/overview'.
 * - Injects 'x-is-operations' header for server and client components to detect operator context.
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const url = request.nextUrl.clone();

  // Detect operations subdomain (e.g., operations.gregale.dev, operations.localhost:3000)
  const isOperationsSubdomain =
    host.startsWith('operations.') || host.includes('.operations.');

  const requestHeaders = new Headers(request.headers);
  if (isOperationsSubdomain) {
    requestHeaders.set('x-is-operations', '1');
  }

  if (isOperationsSubdomain) {
    // If accessing root '/' or '/dashboard' on operations domain, rewrite to admin overview
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      url.pathname = '/dashboard/admin/overview';
      return NextResponse.rewrite(url, {
        request: {
          headers: requestHeaders,
        },
      });
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
