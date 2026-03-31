import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const webRoot = path.join(repoRoot, "apps", "web");
const desktopWebDist = path.join(repoRoot, "apps", "desktop", "dist", "web", "app");
const nextStandaloneDir = path.join(webRoot, ".next", "standalone");
const nextStaticDir = path.join(webRoot, ".next", "static");
const desktopApiPort = process.env.MUSIC_ROOM_DESKTOP_API_PORT ?? "3001";
const nextBuildUtilsPath = path.join(webRoot, "node_modules", "next", "dist", "build", "utils.js");

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

async function patchNextStandaloneSymlinkFallback() {
  if (process.platform !== "win32" || !existsSync(nextBuildUtilsPath)) {
    return;
  }

  const source = await readFile(nextBuildUtilsPath, "utf8");
  const copyFileSnippet = "                    await _fs.promises.copyFile(tracedFilePath, fileOutputPath);";
  const copyFilePatchedSnippet = "                    await _fs.promises.cp(await _fs.promises.realpath(tracedFilePath).catch(()=>tracedFilePath), fileOutputPath, { recursive: true, force: true, dereference: true });";
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
