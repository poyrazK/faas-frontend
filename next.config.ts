import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backendUrl = process.env.APID_BACKEND_URL || "https://api.gregale.dev";
    return [
      // Control-plane API: the browser talks to one origin so the faas_sid
      // session cookie is first-party.
      {
        source: "/v1/:path*",
        destination: `${backendUrl}/v1/:path*`,
      },
      // Form-post aliases for the password endpoints. /login is also the
      // console's sign-in page, and afterFiles rewrites lose to filesystem
      // routes, so the POST must go through a path no page uses.
      {
        source: "/api/auth/login",
        destination: `${backendUrl}/login`,
      },
      {
        source: "/api/auth/forgot",
        destination: `${backendUrl}/login/forgot`,
      },
      {
        source: "/healthz",
        destination: `${backendUrl}/healthz`,
      },
    ];
  },
};

export default nextConfig;
