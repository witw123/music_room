const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY || "witw123/music_room";
const tagName = process.env.GITHUB_REF_NAME;

if (!token || !tagName) {
  throw new Error("GH_TOKEN/GITHUB_TOKEN and GITHUB_REF_NAME are required.");
}

const apiBaseUrl = "https://api.github.com";
const [owner, repo] = repository.split("/");

async function github(path, init = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${init.method ?? "GET"} ${path} failed: ${response.status} ${body}`);
  }

  return response.json();
}

function resolveReleaseAssetLabel(assetName) {
  if (!assetName.startsWith("Music.Room") || assetName.includes("_Android.apk")) {
    return "";
  }

  return assetName.replace(/^Music\.Room/, "Music Room");
}

const release = await github(`/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tagName)}`);

for (const asset of release.assets ?? []) {
  const label = resolveReleaseAssetLabel(asset.name);
  if (!label || asset.label === label) {
    continue;
  }

  await github(`/repos/${owner}/${repo}/releases/assets/${asset.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: asset.name,
      label
    })
  });

  console.log(`Set release asset label: ${asset.name} -> ${label}`);
}
