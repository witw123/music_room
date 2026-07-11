import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync
} from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { patchNextStandaloneSymlinkFallback } from "./patch-next-standalone-symlink-fallback.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const webRoot = path.join(repoRoot, "apps", "web");
const sharedRoot = path.join(repoRoot, "packages", "shared");
const desktopWebDist = path.join(repoRoot, "apps", "desktop", "dist", "web", "app");
const desktopNodeDist = path.join(repoRoot, "apps", "desktop", "dist", "node");
const nextStandaloneDir = path.join(webRoot, ".next", "standalone");
const nextStaticDir = path.join(webRoot, ".next", "static");
const desktopApiPort = process.env.MUSIC_ROOM_DESKTOP_API_PORT ?? "3001";
const packagedPublicOrigin = process.env.MUSIC_ROOM_PUBLIC_ORIGIN?.replace(/\/$/, "");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  await patchNextStandaloneSymlinkFallback();

  // Next resolves the workspace package through its compiled main entry. A clean release
  // checkout has no packages/shared/dist until we build it explicitly.
  await run(
    process.execPath,
    [path.join(sharedRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"],
    { cwd: sharedRoot }
  );

  // Clean and create directory structure
  if (existsSync(desktopWebDist)) {
    rmSync(desktopWebDist, { recursive: true, force: true });
  }
  mkdirSync(desktopWebDist, { recursive: true });
  mkdirSync(desktopNodeDist, { recursive: true });

  // Build Next.js app - NEXT_PUBLIC vars baked at build time
  await run(
    process.execPath,
    [path.join(webRoot, "node_modules", "next", "dist", "bin", "next"), "build"],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: packagedPublicOrigin ?? `http://127.0.0.1:${desktopApiPort}`,
        NEXT_PUBLIC_WS_URL: packagedPublicOrigin ?? `ws://127.0.0.1:${desktopApiPort}`,
        NEXT_TELEMETRY_DISABLED: "1"
      }
    }
  );

  if (!existsSync(nextStandaloneDir)) {
    throw new Error(`Next standalone output was not found at ${nextStandaloneDir}`);
  }

  // Copy only the traced standalone runtime instead of the full workspace node_modules tree.
  cpSync(nextStandaloneDir, desktopWebDist, { recursive: true });

  // Windows standalone generation may replace pnpm symlinks with real directories. In that
  // layout Next can no longer resolve packages that normally sit beside its store entry.
  const nextPackageDir = realpathSync(path.join(webRoot, "node_modules", "next"));
  const nextDependencyDir = path.dirname(nextPackageDir);
  const appNodeModules = path.join(desktopWebDist, "apps", "web", "node_modules");
  for (const dependency of readdirSync(nextDependencyDir)) {
    if (dependency === "next" || existsSync(path.join(appNodeModules, dependency))) continue;
    cpSync(path.join(nextDependencyDir, dependency), path.join(appNodeModules, dependency), {
      recursive: true,
      dereference: true
    });
  }

  if (existsSync(nextStaticDir)) {
    cpSync(nextStaticDir, path.join(desktopWebDist, "apps", "web", ".next", "static"), {
      recursive: true
    });
  }

  const publicDir = path.join(webRoot, "public");
  if (existsSync(publicDir)) {
    cpSync(publicDir, path.join(desktopWebDist, "apps", "web", "public"), { recursive: true });
  }

  const bundledNodeName = process.platform === "win32" ? "node.exe" : "node";
  const bundledNodePath = path.join(desktopNodeDist, bundledNodeName);
  copyFileSync(process.execPath, bundledNodePath);

  console.log(`Desktop web app built at ${desktopWebDist}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
