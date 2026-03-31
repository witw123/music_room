import path from "node:path";
import process from "node:process";
import os from "node:os";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const targetDir = path.join(
  process.env.LOCALAPPDATA ?? os.tmpdir(),
  "MusicRoom",
  "desktop-target"
);
const tauriBin =
  process.platform === "win32"
    ? path.join(rootDir, "node_modules", ".bin", "tauri.cmd")
    : path.join(rootDir, "node_modules", ".bin", "tauri");

const args = process.argv.slice(2);

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

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
