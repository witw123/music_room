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
  transpilePackages: ["@music-room/shared"]
};

export default nextConfig;
