import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backendUrl = process.env.APID_BACKEND_URL || "http://146.190.210.124:8080";
    return [
      // API routes — proxy all /v1/* to the DO backend
      {
        source: "/v1/:path*",
        destination: `${backendUrl}/v1/:path*`,
      },
      // OAuth callback (GitHub App install redirect)
      {
        source: "/oauth/:path*",
        destination: `${backendUrl}/oauth/:path*`,
      },
      // Auth form posts go through /api/auth/* aliases, never through the
      // real path. /login and /signup are ALSO Next.js pages, and afterFiles
      // rewrites lose to filesystem routes — a rewrite on "/login" itself is
      // shadowed by the page, so the POST 405s in production (dev masks it).
      // Any future backend-proxied path must NOT share a name with a page.
      {
        source: "/api/auth/login",
        destination: `${backendUrl}/login`,
      },
      {
        source: "/api/auth/signup",
        destination: `${backendUrl}/signup`,
      },
      {
        source: "/api/auth/forgot",
        destination: `${backendUrl}/login/forgot`,
      },
      {
        source: "/auth/:path*",
        destination: `${backendUrl}/auth/:path*`,
      },
      {
        source: "/logout",
        destination: `${backendUrl}/logout`,
      },
      // Health check
      {
        source: "/healthz",
        destination: `${backendUrl}/healthz`,
      },
    ];
  },
};

export default nextConfig;
