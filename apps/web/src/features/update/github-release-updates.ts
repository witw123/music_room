import { isNewerReleaseVersion, normalizeReleaseVersion } from "./update-version";

type GitHubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  content_type?: string;
};

export type GitHubLatestReleaseResponse = {
  draft?: boolean;
  prerelease?: boolean;
  tag_name?: string;
  name?: string | null;
  html_url?: string;
  body?: string | null;
  assets?: GitHubReleaseAsset[];
};

export type AndroidReleaseUpdate = {
  version: string;
  releaseUrl: string;
  apkUrl: string;
  notes: string;
};

function isApkAsset(asset: GitHubReleaseAsset) {
  const name = asset.name?.toLowerCase() ?? "";
  return name.endsWith(".apk") || asset.content_type === "application/vnd.android.package-archive";
}

export function resolveAndroidReleaseUpdate(
  currentVersion: string,
  release: GitHubLatestReleaseResponse
): AndroidReleaseUpdate | null {
  if (release.draft || release.prerelease || !release.tag_name || !release.html_url) {
    return null;
  }

  const version = normalizeReleaseVersion(release.tag_name);
  if (!version || !isNewerReleaseVersion(currentVersion, version)) {
    return null;
  }

  const apkAsset = release.assets?.find(
    (asset) => isApkAsset(asset) && Boolean(asset.browser_download_url)
  );
  if (!apkAsset?.browser_download_url) {
    return null;
  }

  return {
    version,
    releaseUrl: release.html_url,
    apkUrl: apkAsset.browser_download_url,
    notes: release.body ?? ""
  };
}
