import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("uses a sibling macOS installer architecture for architecture-neutral updater tarballs", () => {
  const releaseAssetsDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-room-updater-"));
  const macosAssetsDir = path.join(releaseAssetsDir, "desktop-macos");
  fs.mkdirSync(macosAssetsDir);

  try {
    fs.writeFileSync(path.join(macosAssetsDir, "Music.Room.app.tar.gz"), "bundle");
    fs.writeFileSync(path.join(macosAssetsDir, "Music.Room.app.tar.gz.sig"), "signature");
    fs.writeFileSync(path.join(macosAssetsDir, "Music.Room_0.2.9_aarch64.dmg"), "dmg");

    const result = spawnSync(
      process.execPath,
      ["scripts/write-tauri-latest-json.mjs", releaseAssetsDir],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REF_NAME: "v0.2.9",
          GITHUB_REPOSITORY: "owner/repo"
        }
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const latestJson = JSON.parse(
      fs.readFileSync(path.join(releaseAssetsDir, "latest.json"), "utf8")
    );
    assert.deepEqual(Object.keys(latestJson.platforms).sort(), ["darwin-aarch64"]);
    assert.equal(
      latestJson.platforms["darwin-aarch64"].url,
      "https://github.com/owner/repo/releases/download/v0.2.9/Music.Room.app.tar.gz"
    );
  } finally {
    fs.rmSync(releaseAssetsDir, { recursive: true, force: true });
  }
});
