import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const targetDir = path.join(
  process.env.LOCALAPPDATA ?? os.tmpdir(),
  "MusicRoom",
  "desktop-target"
);
const pathsToClean = [
  path.join(rootDir, "release"),
  path.join(rootDir, ".cargo-target"),
  targetDir
];

for (const targetPath of pathsToClean) {
  try {
    fs.rmSync(targetPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200
    });
  } catch (error) {
    const nextError = error;
    if (!(nextError instanceof Error)) {
      throw error;
    }

    if (!/EPERM|EBUSY/i.test(nextError.message)) {
      throw error;
    }
  }
}
