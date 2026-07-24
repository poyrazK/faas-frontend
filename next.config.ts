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
      // Magic-link auth flow: POST /login, GET /auth/verify, POST /logout
      {
        source: "/login",
        destination: `${backendUrl}/login`,
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
