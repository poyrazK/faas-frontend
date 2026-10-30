import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { OPS_HIDDEN_SLUGS, OPS_HOME, OPS_ROUTES } from '@/lib/routes';

/**
 * This deployment is the operator console only (customer pages live in
 * faas-web), so every host serves the same tree:
 * - clean URLs (/tenants) are rewritten onto app/operations/<slug>;
 * - /operations/<slug> redirects to its clean URL so each page has one address;
 * - backend-proxied paths pass through untouched to the next.config rewrites;
 * - legacy entry points (/, /dashboard/*) land on the fleet overview.
 */
const SLUGS = new Set([...OPS_ROUTES.map((route) => route.slug), ...OPS_HIDDEN_SLUGS]);

function isBackendPath(pathname: string): boolean {
  return pathname === '/v1' || pathname.startsWith('/v1/') || pathname === '/healthz';
}

function firstSegment(pathname: string): string {
  return pathname.split('/')[1] ?? '';
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isBackendPath(pathname)) return NextResponse.next();

  if (pathname === '/' || pathname === '/operations' || pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    return NextResponse.redirect(new URL(OPS_HOME, request.url));
  }

  if (pathname.startsWith('/operations/')) {
    const clean = pathname.slice('/operations'.length);
    if (SLUGS.has(firstSegment(clean))) {
      return NextResponse.redirect(new URL(`${clean}${search}`, request.url));
    }
    return NextResponse.next();
  }

  if (SLUGS.has(firstSegment(pathname))) {
    const url = request.nextUrl.clone();
    url.pathname = `/operations${pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, the /api/* auth aliases, and static
     * assets by extension.
     */
    '/((?!api|_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js)$).*)',
  ],
};
