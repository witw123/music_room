import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, "release");
const bundleRoot = path.join(
  process.env.LOCALAPPDATA ?? os.tmpdir(),
  "MusicRoom",
  "desktop-target",
  "release",
  "bundle"
);
const allowedFileNames = [
  ".exe",
  ".msi",
  ".dmg",
  ".AppImage",
  ".deb",
  ".rpm",
  ".zip",
  ".tar.gz",
  ".sig"
];

fs.mkdirSync(releaseDir, { recursive: true });

function collectFiles(currentDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(absolutePath);
      continue;
    }

    if (!allowedFileNames.some((suffix) => entry.name.endsWith(suffix))) {
      continue;
    }

    fs.copyFileSync(absolutePath, path.join(releaseDir, entry.name));
  }
}

if (fs.existsSync(bundleRoot)) {
  collectFiles(bundleRoot);
}
