import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backendUrl = process.env.APID_BACKEND_URL || "http://146.190.210.124:8080";
    return [
      {
        source: "/v1/:path*",
        destination: `${backendUrl}/v1/:path*`,
      },
      {
        source: "/oauth/:path*",
        destination: `${backendUrl}/oauth/:path*`,
      },
    ];
  },
};

export default nextConfig;
