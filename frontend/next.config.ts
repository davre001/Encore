import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    // Video uploads and take-file streaming exceed Next's 10MB default.
    middlewareClientMaxBodySize: "512mb",
    proxyClientMaxBodySize: "512mb",
  } as NextConfig["experimental"],
  // Allow external profile-picture hosts so <img src={user.picture}> renders.
  images: {
    remotePatterns: [
      // Google profile pictures (OAuth sign-in)
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "lh4.googleusercontent.com" },
      { protocol: "https", hostname: "lh5.googleusercontent.com" },
      { protocol: "https", hostname: "lh6.googleusercontent.com" },
      // Gravatar
      { protocol: "https", hostname: "www.gravatar.com" },
      { protocol: "https", hostname: "gravatar.com" },
      // Generic HTTPS avatars (e.g. GitHub, Discord CDN)
      { protocol: "https", hostname: "**" },
    ],
  },
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
