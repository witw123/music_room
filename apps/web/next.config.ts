import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  typedRoutes: true,
  transpilePackages: ["@music-room/shared"],
  async headers() {
    const apiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "'self'";
    const wsOrigin = process.env.NEXT_PUBLIC_WS_URL?.trim() || "'self'";
    const scriptSrc =
      process.env.NODE_ENV === "production"
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      `connect-src 'self' ${apiOrigin} ${wsOrigin}`,
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'"
    ].join("; ");
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" }
      ]
    }];
  }
};

export default nextConfig;
