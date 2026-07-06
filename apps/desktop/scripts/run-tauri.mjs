import path from "node:path";
import process from "node:process";
import os from "node:os";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const rootDir = process.cwd();
const targetDir = path.join(
  process.env.LOCALAPPDATA ?? os.tmpdir(),
  "MusicRoom",
  "desktop-target"
);
const tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const tauriCapabilityPath = path.join(rootDir, "src-tauri", "capabilities", "default.json");
const defaultPublicOrigin = "https://example.com";
const defaultUpdaterEndpoint =
  "https://github.com/witw123/music_room/releases/latest/download/latest.json";
const tauriBin =
  process.platform === "win32"
    ? path.join(rootDir, "node_modules", ".bin", "tauri.cmd")
    : path.join(rootDir, "node_modules", ".bin", "tauri");

const args = process.argv.slice(2);

function normalizePublicOrigin(rawOrigin) {
  const candidate = rawOrigin?.trim() || defaultPublicOrigin;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`MUSIC_ROOM_PUBLIC_ORIGIN must use http or https: ${candidate}`);
  }

  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

async function prepareRemoteShellConfig(publicOrigin) {
  const [tauriConfigSource, capabilitySource] = await Promise.all([
    readFile(tauriConfigPath, "utf8"),
    readFile(tauriCapabilityPath, "utf8")
  ]);
  const tauriConfig = JSON.parse(tauriConfigSource);
  const capabilityConfig = JSON.parse(capabilitySource);

  tauriConfig.build = {
    ...tauriConfig.build,
    frontendDist: `${publicOrigin}/app?client=desktop`
  };

  tauriConfig.plugins = {
    ...tauriConfig.plugins,
    updater: {
      ...(tauriConfig.plugins?.updater ?? {}),
      endpoints: [process.env.MUSIC_ROOM_UPDATER_ENDPOINT || defaultUpdaterEndpoint],
      pubkey: process.env.TAURI_SIGNING_PUBLIC_KEY || tauriConfig.plugins?.updater?.pubkey || ""
    }
  };

  capabilityConfig.remote = {
    ...capabilityConfig.remote,
    urls: [
      "http://localhost:3000",
      "http://localhost:3000/*",
      publicOrigin,
      `${publicOrigin}/*`
    ]
  };

  await Promise.all([
    writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, "utf8"),
    writeFile(tauriCapabilityPath, `${JSON.stringify(capabilityConfig, null, 2)}\n`, "utf8")
  ]);

  let restored = false;
  return async () => {
    if (restored) {
      return;
    }

    restored = true;
    await Promise.all([
      writeFile(tauriConfigPath, tauriConfigSource, "utf8"),
      writeFile(tauriCapabilityPath, capabilitySource, "utf8")
    ]);
  };
}

async function main() {
  const isBuildCommand = args.some((arg) => arg === "build");
  if (isBuildCommand && !process.env.MUSIC_ROOM_PUBLIC_ORIGIN) {
    throw new Error(
      "MUSIC_ROOM_PUBLIC_ORIGIN is required when building desktop release bundles."
    );
  }
  if (isBuildCommand && !process.env.TAURI_SIGNING_PUBLIC_KEY) {
    throw new Error("TAURI_SIGNING_PUBLIC_KEY is required when building updater-enabled desktop bundles.");
  }

  const publicOrigin = normalizePublicOrigin(process.env.MUSIC_ROOM_PUBLIC_ORIGIN);
  if (!process.env.MUSIC_ROOM_PUBLIC_ORIGIN) {
    console.warn(
      `[desktop] MUSIC_ROOM_PUBLIC_ORIGIN is not set; using placeholder ${defaultPublicOrigin}`
    );
  }

  const restoreConfig = await prepareRemoteShellConfig(publicOrigin);
  const child =
    process.platform === "win32"
      ? spawn(`"${tauriBin}" ${args.join(" ")}`.trim(), {
          cwd: rootDir,
          stdio: "inherit",
          shell: true,
          env: {
            ...process.env,
            CARGO_TARGET_DIR: targetDir
          }
        })
      : spawn(tauriBin, args, {
          cwd: rootDir,
          stdio: "inherit",
          shell: false,
          env: {
            ...process.env,
            CARGO_TARGET_DIR: targetDir
          }
        });

  const finish = async (code, signal) => {
    try {
      await restoreConfig();
    } catch (error) {
      console.error("[desktop] Failed to restore generated Tauri config:", error);
    }

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  };

  child.on("exit", (code, signal) => {
    void finish(code, signal);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
