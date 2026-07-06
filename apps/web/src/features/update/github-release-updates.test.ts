import { describe, expect, it } from "vitest";
import { resolveAndroidReleaseUpdate } from "./github-release-updates";

describe("resolveAndroidReleaseUpdate", () => {
  it("returns the latest APK release when it is newer than the current version", () => {
    const update = resolveAndroidReleaseUpdate("0.2.8", {
      draft: false,
      prerelease: false,
      tag_name: "v0.2.9",
      name: "Music Room v0.2.9",
      html_url: "https://github.com/witw123/music_room/releases/tag/v0.2.9",
      body: "## 修复内容\n- 自动更新。",
      assets: [
        {
          name: "Music.Room_0.2.9_x64-setup.exe",
          browser_download_url: "https://example.com/setup.exe",
          content_type: "application/octet-stream"
        },
        {
          name: "Music.Room_0.2.9_Android.apk",
          browser_download_url: "https://example.com/app.apk",
          content_type: "application/vnd.android.package-archive"
        }
      ]
    });

    expect(update).toEqual({
      version: "0.2.9",
      releaseUrl: "https://github.com/witw123/music_room/releases/tag/v0.2.9",
      apkUrl: "https://example.com/app.apk",
      notes: "## 修复内容\n- 自动更新。"
    });
  });

  it("ignores drafts prereleases old versions and releases without an APK", () => {
    const baseRelease = {
      tag_name: "v0.2.9",
      name: "Music Room v0.2.9",
      html_url: "https://github.com/witw123/music_room/releases/tag/v0.2.9",
      body: "",
      assets: []
    };

    expect(resolveAndroidReleaseUpdate("0.2.8", { ...baseRelease, draft: true })).toBeNull();
    expect(resolveAndroidReleaseUpdate("0.2.8", { ...baseRelease, prerelease: true })).toBeNull();
    expect(resolveAndroidReleaseUpdate("0.2.9", { ...baseRelease })).toBeNull();
    expect(resolveAndroidReleaseUpdate("0.2.8", { ...baseRelease })).toBeNull();
  });
});
