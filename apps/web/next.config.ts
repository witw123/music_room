import type { NextConfig } from "next";
import path from "node:path";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version
  },
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/.pnpm/esbuild@*/**",
      "./node_modules/.pnpm/@esbuild+*/**",
      "./node_modules/.pnpm/sharp@*/**",
      "./node_modules/.pnpm/@img+*/**"
    ]
  },
  typedRoutes: true,
  transpilePackages: ["@music-room/shared"],
  async headers() {
    return [
      {
        // PWA manifest 变更需要及时生效,只做短缓存。
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
          { key: "Content-Type", value: "application/manifest+json" }
        ]
      },
      {
        // 静态图标与房间封面走内容寻址/低频变更,可长缓存。
        source: "/:asset(icons|room-covers)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }]
      }
    ];
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/app",
        permanent: false
      }
    ];
  }
};

export default nextConfig;
