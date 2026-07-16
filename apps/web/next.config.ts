import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
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
  transpilePackages: ["@music-room/shared"]
};

export default nextConfig;
