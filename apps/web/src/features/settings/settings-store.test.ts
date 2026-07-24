import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appSettingsStorageKey,
  getDefaultAppSettings,
  getCustomLayoutPageId,
  getAppSettings,
  normalizeSettings,
  resolveAppTheme,
  resetAppSettings,
  updateAppSettings
} from "./settings-store";

describe("app settings store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a compact sidebar and stable playback defaults", () => {
    expect(normalizeSettings(null)).toMatchObject({
      theme: "dark",
      layout: { sidebarCollapsed: true },
      discover: { provider: "netease" },
      playback: {
        defaultVolume: 0.8,
        loudnessNormalization: false,
        playerStyle: "vinyl",
        disableArtworkColor: false,
        localPlaybackMode: "sequence",
        lyricLines: 5,
        preventOfflineAutoLoad: false,
        streamingOnlyPlayback: false,
        fullyCachedPlayback: false
      }
    });
  });

  it("normalizes and resolves light and system themes", () => {
    expect(normalizeSettings({ theme: "light" }).theme).toBe("light");
    expect(normalizeSettings({ theme: "system" }).theme).toBe("system");
    expect(normalizeSettings({ theme: "unknown" }).theme).toBe("dark");
    expect(resolveAppTheme("dark", true)).toBe("dark");
    expect(resolveAppTheme("light", false)).toBe("light");
    expect(resolveAppTheme("system", true)).toBe("light");
    expect(resolveAppTheme("system", false)).toBe("dark");
  });

  it("normalizes the shared player style preference", () => {
    expect(normalizeSettings({ playback: { playerStyle: "square-cover" } }).playback.playerStyle).toBe("square-cover");
    expect(normalizeSettings({ playback: { playerStyle: "unknown" } }).playback.playerStyle).toBe("vinyl");
  });

  it("normalizes the discovery provider preference", () => {
    expect(normalizeSettings({ discover: { provider: "qqmusic" } }).discover.provider).toBe("qqmusic");
    expect(normalizeSettings({ discover: { provider: "unknown" } }).discover.provider).toBe("netease");
  });

  it("keeps custom layout pages independent and bounded", () => {
    const first = getDefaultAppSettings();
    const second = getDefaultAppSettings();
    first.layout.customLayout.pages.home.content.x = 400;
    expect(second.layout.customLayout.pages.home.content.x).toBe(64);

    const normalized = normalizeSettings({
      layout: {
        customLayout: {
          enabled: true,
          pages: {
            discover: {
              content: { x: 9999, y: -20, width: 100, height: 9999, visible: true, locked: false }
            }
          }
        }
      }
    });
    expect(normalized.layout.customLayout.enabled).toBe(true);
    expect(normalized.layout.customLayout.pages.discover.content).toMatchObject({ x: 1280, y: 0, width: 160, height: 900 });
    expect(getCustomLayoutPageId("/app/settings")).toBe("settings");
    expect(getCustomLayoutPageId("/rooms")).toBe("home");
  });

  it("persists normalized updates and can reset them", () => {
    const values = new Map<string, string>();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      dispatchEvent
    });

    updateAppSettings({
      layout: { sidebarCollapsed: false },
      discover: { provider: "qqmusic" },
      playback: {
        defaultVolume: 2,
        lyricLines: 9,
        preventOfflineAutoLoad: true,
        streamingOnlyPlayback: true
      }
    });
    expect(getAppSettings()).toMatchObject({
      layout: { sidebarCollapsed: false },
      discover: { provider: "qqmusic" },
      playback: {
        defaultVolume: 1,
        disableArtworkColor: false,
        lyricLines: 7,
        preventOfflineAutoLoad: true,
        streamingOnlyPlayback: true,
        fullyCachedPlayback: false
      }
    });
    expect(values.has(appSettingsStorageKey)).toBe(true);

    updateAppSettings({ playback: { disableArtworkColor: true } });
    expect(getAppSettings().playback.disableArtworkColor).toBe(true);

    resetAppSettings();
    expect(getAppSettings().layout.sidebarCollapsed).toBe(true);
    expect(dispatchEvent).toHaveBeenCalled();
  });
});
