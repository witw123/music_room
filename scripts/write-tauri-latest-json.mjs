import fs from "node:fs";
import path from "node:path";

const releaseAssetsDir = process.argv[2];
const tagName = process.env.GITHUB_REF_NAME;
const repository = process.env.GITHUB_REPOSITORY || "witw123/music_room";

if (!releaseAssetsDir || !tagName) {
  throw new Error("Usage: node scripts/write-tauri-latest-json.mjs <release-assets-dir>");
}

const absoluteReleaseAssetsDir = path.resolve(releaseAssetsDir);

function walkFiles(currentDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(currentDir, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}

function normalizeReleaseAssetFileNames(currentDir) {
  for (const filePath of walkFiles(currentDir)) {
    const fileName = path.basename(filePath);
    if (!fileName.includes(" ")) {
      continue;
    }

    const normalizedPath = path.join(path.dirname(filePath), fileName.replaceAll(" ", "."));
    if (fs.existsSync(normalizedPath)) {
      throw new Error(`Cannot normalize duplicate release asset name: ${normalizedPath}`);
    }

    fs.renameSync(filePath, normalizedPath);
  }
}

function toDownloadUrl(fileName) {
  return `https://github.com/${repository}/releases/download/${tagName}/${encodeURIComponent(fileName)}`;
}

function findUpdaterArtifact(files, predicate) {
  const artifactPath = findUpdaterArtifactPath(files, predicate);
  if (!artifactPath) {
    return null;
  }

  return toUpdaterArtifact(artifactPath);
}

function findUpdaterArtifactPath(files, predicate) {
  return files.find((filePath) => predicate(path.basename(filePath))) ?? null;
}

function findUpdaterArtifacts(files, predicate) {
  return files
    .filter((filePath) => predicate(path.basename(filePath)))
    .map((artifactPath) => ({
      artifactPath,
      artifact: toUpdaterArtifact(artifactPath)
    }));
}

function toUpdaterArtifact(artifactPath) {
  const signaturePath = `${artifactPath}.sig`;
  if (!fs.existsSync(signaturePath)) {
    throw new Error(`Missing updater signature for ${artifactPath}`);
  }

  return {
    signature: fs.readFileSync(signaturePath, "utf8").trim(),
    url: toDownloadUrl(path.basename(artifactPath))
  };
}

function getMacosPlatformKeyFromName(fileName) {
  const lowerFileName = fileName.toLowerCase();
  if (lowerFileName.includes("aarch64") || lowerFileName.includes("arm64")) {
    return "darwin-aarch64";
  }

  if (
    lowerFileName.includes("x86_64") ||
    lowerFileName.includes("x64") ||
    lowerFileName.includes("amd64")
  ) {
    return "darwin-x86_64";
  }

  return null;
}

function getMacosInstallerPlatformKeys(files) {
  return new Set(
    files
      .filter((filePath) => path.basename(filePath).endsWith(".dmg"))
      .map((filePath) => getMacosPlatformKeyFromName(path.basename(filePath)))
      .filter(Boolean)
  );
}

function resolveMacosUpdaterPlatformKeys(artifactPath, files) {
  const artifactFileName = path.basename(artifactPath);
  const artifactPlatformKey = getMacosPlatformKeyFromName(artifactFileName);
  if (artifactPlatformKey) {
    return [artifactPlatformKey];
  }

  const siblingInstallerKeys = getMacosInstallerPlatformKeys(
    files.filter((filePath) => path.dirname(filePath) === path.dirname(artifactPath))
  );
  if (siblingInstallerKeys.size === 1) {
    return [...siblingInstallerKeys];
  }

  const allInstallerKeys = getMacosInstallerPlatformKeys(files);
  if (allInstallerKeys.size === 1) {
    return [...allInstallerKeys];
  }

  throw new Error(
    `Cannot infer macOS updater target for ${artifactFileName}. Include aarch64, arm64, x86_64, x64, or amd64 in the updater artifact name, or publish it beside one arch-specific .dmg.`
  );
}

normalizeReleaseAssetFileNames(absoluteReleaseAssetsDir);
const files = walkFiles(absoluteReleaseAssetsDir);
const platforms = {};

const windows = findUpdaterArtifact(
  files,
  (fileName) => fileName.endsWith("-setup.exe") || fileName.endsWith("-setup.nsis.zip")
);
if (windows) {
  platforms["windows-x86_64"] = windows;
}

const linux = findUpdaterArtifact(files, (fileName) => fileName.endsWith(".AppImage"));
if (linux) {
  platforms["linux-x86_64"] = linux;
}

const macosArtifacts = findUpdaterArtifacts(files, (fileName) => fileName.endsWith(".app.tar.gz"));
for (const { artifactPath, artifact } of macosArtifacts) {
  for (const platformKey of resolveMacosUpdaterPlatformKeys(artifactPath, files)) {
    platforms[platformKey] = artifact;
  }
}

const version = tagName.replace(/^v/i, "");
const latestJson = {
  version,
  notes: `Music Room ${tagName}`,
  pub_date: new Date().toISOString(),
  platforms
};

if (!Object.keys(platforms).length) {
  throw new Error("No updater artifacts were found.");
}

fs.writeFileSync(
  path.join(absoluteReleaseAssetsDir, "latest.json"),
  `${JSON.stringify(latestJson, null, 2)}\n`,
  "utf8"
);
