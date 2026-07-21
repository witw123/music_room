import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];

if (target !== "server" && target !== "web") {
  console.error("Usage: node scripts/e2e-run-server.mjs <server|web>");
  process.exit(1);
}

const pnpmExecPath = process.env.npm_execpath;
const command = pnpmExecPath && pnpmExecPath.endsWith(".cjs") ? process.execPath : "pnpm";
const baseArgs = pnpmExecPath && pnpmExecPath.endsWith(".cjs") ? [pnpmExecPath] : [];
const args =
  target === "server"
    ? [...baseArgs, "--filter", "@music-room/server", "start"]
    : [...baseArgs, "--filter", "@music-room/web", "dev"];

const env =
  target === "server"
    ? {
        ...process.env,
        NODE_ENV: "test",
        PORT: "3001",
        REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379/15",
        AUTH_FAKE_PERSISTENCE: "true",
        AUTH_FAKE_PERSIST_PATH: resolve(repoRoot, ".tmp/e2e/auth-store.json"),
        AUTH_RATE_LIMIT_DISABLED: "true",
        DATABASE_URL:
          process.env.DATABASE_URL ??
          "postgresql://music_room:music_room@127.0.0.1:65432/music_room?schema=public&connect_timeout=1",
        CORS_ORIGINS: "http://127.0.0.1:3000,http://localhost:3000"
      }
    : {
        ...process.env,
        NODE_ENV: "test",
        PORT: "3000",
        NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3001",
        NEXT_PUBLIC_WS_URL: "ws://127.0.0.1:3001",
        NEXT_PUBLIC_SOCKET_PATH: "/ws/socket.io"
      };

if (target === "server") {
  const build = spawnSync(
    command,
    [...baseArgs, "--filter", "@music-room/server", "build"],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32"
    }
  );

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

const child = spawn(command, args, {
  cwd: repoRoot,
  env,
  stdio: "inherit",
  shell: process.platform === "win32"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
