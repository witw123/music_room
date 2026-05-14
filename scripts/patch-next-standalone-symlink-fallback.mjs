import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const webRoot = path.join(repoRoot, "apps", "web");
const nextBuildUtilsPath = path.join(webRoot, "node_modules", "next", "dist", "build", "utils.js");

export async function patchNextStandaloneSymlinkFallback() {
  if (process.platform !== "win32" || !existsSync(nextBuildUtilsPath)) {
    return;
  }

  const source = await readFile(nextBuildUtilsPath, "utf8");
  const copyFileSnippet =
    "                    await _fs.promises.copyFile(tracedFilePath, fileOutputPath);";
  const copyFilePatchedSnippet =
    "                    await _fs.promises.cp(await _fs.promises.realpath(tracedFilePath).catch(()=>tracedFilePath), fileOutputPath, { recursive: true, force: true, dereference: true });";
  const originalSnippet = [
    "                    try {",
    "                        await _fs.promises.symlink(symlink, fileOutputPath);",
    "                    } catch (e) {",
    "                        if (e.code !== 'EEXIST') {",
    "                            throw e;",
    "                        }",
    "                    }"
  ].join("\n");
  const patchedSnippet = [
    "                    try {",
    "                        await _fs.promises.symlink(symlink, fileOutputPath);",
    "                    } catch (e) {",
    "                        if (e.code === 'EEXIST') {",
    "                            return;",
    "                        }",
    "                        if (e.code === 'EPERM' || e.code === 'UNKNOWN') {",
    "                            await _fs.promises.cp(await _fs.promises.realpath(tracedFilePath).catch(()=>tracedFilePath), fileOutputPath, { recursive: true, force: true, dereference: true });",
    "                        } else {",
    "                            throw e;",
    "                        }",
    "                    }"
  ].join("\n");

  if (!source.includes(originalSnippet) && !source.includes(copyFileSnippet)) {
    return;
  }

  const patchedSource = source
    .replace(originalSnippet, patchedSnippet)
    .replace(copyFileSnippet, copyFilePatchedSnippet);

  if (patchedSource === source) {
    return;
  }

  await writeFile(nextBuildUtilsPath, patchedSource, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  patchNextStandaloneSymlinkFallback().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
