import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { patchNextStandaloneSymlinkFallback } from "./patch-next-standalone-symlink-fallback.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const webRoot = path.join(repoRoot, "apps", "web");
const desktopWebDist = path.join(repoRoot, "apps", "desktop", "dist", "web", "app");
const nextStandaloneDir = path.join(webRoot, ".next", "standalone");
const nextStaticDir = path.join(webRoot, ".next", "static");
const desktopApiPort = process.env.MUSIC_ROOM_DESKTOP_API_PORT ?? "3001";

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

  // Clean and create directory structure
  if (existsSync(desktopWebDist)) {
    rmSync(desktopWebDist, { recursive: true, force: true });
  }
  mkdirSync(desktopWebDist, { recursive: true });

  // Build Next.js app - NEXT_PUBLIC vars baked at build time
  await run(
    process.execPath,
    [path.join(webRoot, "node_modules", "next", "dist", "bin", "next"), "build"],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${desktopApiPort}`,
        NEXT_PUBLIC_WS_URL: `ws://127.0.0.1:${desktopApiPort}`,
        NEXT_TELEMETRY_DISABLED: "1"
      }
    }
  );

  if (!existsSync(nextStandaloneDir)) {
    throw new Error(`Next standalone output was not found at ${nextStandaloneDir}`);
  }

  // Copy only the traced standalone runtime instead of the full workspace node_modules tree.
  cpSync(nextStandaloneDir, desktopWebDist, { recursive: true });

  if (existsSync(nextStaticDir)) {
    cpSync(nextStaticDir, path.join(desktopWebDist, ".next", "static"), { recursive: true });
  }

  const publicDir = path.join(webRoot, "public");
  if (existsSync(publicDir)) {
    cpSync(publicDir, path.join(desktopWebDist, "public"), { recursive: true });
  }

  console.log(`Desktop web app built at ${desktopWebDist}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
