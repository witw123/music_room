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

function toDownloadUrl(fileName) {
  return `https://github.com/${repository}/releases/download/${tagName}/${encodeURIComponent(fileName)}`;
}

function findUpdaterArtifact(files, predicate) {
  const artifactPath = files.find((filePath) => predicate(path.basename(filePath)));
  if (!artifactPath) {
    return null;
  }

  const signaturePath = `${artifactPath}.sig`;
  if (!fs.existsSync(signaturePath)) {
    throw new Error(`Missing updater signature for ${artifactPath}`);
  }

  return {
    signature: fs.readFileSync(signaturePath, "utf8").trim(),
    url: toDownloadUrl(path.basename(artifactPath))
  };
}

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

const macos = findUpdaterArtifact(files, (fileName) => fileName.endsWith(".app.tar.gz"));
if (macos) {
  const isAppleSilicon = macos.url.includes("_aarch64") || macos.url.includes("aarch64");
  platforms[isAppleSilicon ? "darwin-aarch64" : "darwin-x86_64"] = macos;
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
