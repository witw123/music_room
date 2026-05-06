import { spawnSync } from "node:child_process";

const requiredNodeMajor = 22;
const requiredPnpmMajor = 10;
let hasFailure = false;

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
if (nodeMajor !== requiredNodeMajor) {
  console.error(
    `[toolchain] Node.js ${requiredNodeMajor}.x is required. Current: ${process.versions.node}`
  );
  hasFailure = true;
} else {
  console.log(`[toolchain] Node.js ${process.versions.node}`);
}

const pnpmResult = spawnSync("pnpm", ["--version"], {
  encoding: "utf8",
  shell: process.platform === "win32"
});

if (pnpmResult.error || pnpmResult.status !== 0) {
  console.error("[toolchain] pnpm is required but was not found on PATH.");
  hasFailure = true;
} else {
  const version = pnpmResult.stdout.trim();
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (major !== requiredPnpmMajor) {
    console.error(`[toolchain] pnpm ${requiredPnpmMajor}.x is required. Current: ${version}`);
    hasFailure = true;
  } else {
    console.log(`[toolchain] pnpm ${version}`);
  }
}

process.exit(hasFailure ? 1 : 0);
