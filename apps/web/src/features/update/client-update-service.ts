"use client";

import { githubReleasesUrl } from "@/lib/client-shell";
import {
  getClientPlatformFromBrowser,
  getClientVersionFromBrowser
} from "@/lib/client-shell-browser";
import { getDesktopAppVersion, isDesktopRuntime, openDesktopExternal } from "@/lib/desktop-api";
import {
  type AndroidReleaseUpdate,
  type GitHubLatestReleaseResponse,
  resolveAndroidReleaseUpdate
} from "./github-release-updates";

export type ClientUpdateCheckMode = "startup" | "manual";

export type DesktopClientUpdate = {
  platform: "desktop";
  version: string;
  currentVersion: string;
  notes: string;
  install: () => Promise<void>;
};

export type AndroidClientUpdate = AndroidReleaseUpdate & {
  platform: "mobile";
  openDownload: () => Promise<void>;
};

export type ClientUpdate = DesktopClientUpdate | AndroidClientUpdate;

export type ClientUpdateCheckResult =
  | {
      status: "available";
      update: ClientUpdate;
    }
  | {
      status: "current" | "unsupported";
    }
  | {
      status: "failed";
      message: string;
    };

const latestReleaseApiUrl = "https://api.github.com/repos/witw123/music_room/releases/latest";

function toFailureMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "检查更新失败。";
}

async function checkDesktopUpdate(): Promise<ClientUpdateCheckResult> {
  if (!isDesktopRuntime()) {
    return { status: "unsupported" };
  }

  const [{ check }, { relaunch }, currentVersion] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
    getDesktopAppVersion()
  ]);

  const update = await check();
  if (!update) {
    return { status: "current" };
  }

  return {
    status: "available",
    update: {
      platform: "desktop",
      version: update.version,
      currentVersion: currentVersion ?? update.currentVersion,
      notes: update.body ?? "",
      install: async () => {
        await update.downloadAndInstall();
        await relaunch();
      }
    }
  };
}

async function checkAndroidUpdate(): Promise<ClientUpdateCheckResult> {
  const currentVersion = getClientVersionFromBrowser();
  if (!currentVersion) {
    return { status: "unsupported" };
  }

  const response = await fetch(latestReleaseApiUrl, {
    headers: {
      Accept: "application/vnd.github+json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`GitHub Releases 返回 ${response.status}`);
  }

  const release = (await response.json()) as GitHubLatestReleaseResponse;
  const update = resolveAndroidReleaseUpdate(currentVersion, release);
  if (!update) {
    return { status: "current" };
  }

  return {
    status: "available",
    update: {
      ...update,
      platform: "mobile",
      openDownload: async () => {
        await openDesktopExternal(update.apkUrl || update.releaseUrl || githubReleasesUrl);
      }
    }
  };
}

export async function checkClientUpdate(
  mode: ClientUpdateCheckMode = "manual"
): Promise<ClientUpdateCheckResult> {
  try {
    const platform = getClientPlatformFromBrowser();
    if (platform === "desktop") {
      return await checkDesktopUpdate();
    }

    if (platform === "mobile") {
      return await checkAndroidUpdate();
    }

    return { status: "unsupported" };
  } catch (error) {
    if (mode === "startup") {
      return { status: "unsupported" };
    }

    return {
      status: "failed",
      message: toFailureMessage(error)
    };
  }
}
