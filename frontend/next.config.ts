import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    // Video uploads and take-file streaming exceed Next's 10MB default.
    middlewareClientMaxBodySize: "512mb",
    proxyClientMaxBodySize: "512mb",
  } as NextConfig["experimental"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:5000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
