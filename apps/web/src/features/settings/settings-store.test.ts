import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appSettingsStorageKey,
  getAppSettings,
  normalizeSettings,
  resetAppSettings,
  updateAppSettings
} from "./settings-store";

describe("app settings store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a compact sidebar and stable playback defaults", () => {
    expect(normalizeSettings(null)).toMatchObject({
      layout: { sidebarCollapsed: true },
      playback: { defaultVolume: 0.8, localPlaybackMode: "sequence", lyricLines: 5 }
    });
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
      playback: { defaultVolume: 2, lyricLines: 9 }
    });
    expect(getAppSettings()).toMatchObject({
      layout: { sidebarCollapsed: false },
      playback: { defaultVolume: 1, lyricLines: 7 }
    });
    expect(values.has(appSettingsStorageKey)).toBe(true);

    resetAppSettings();
    expect(getAppSettings().layout.sidebarCollapsed).toBe(true);
    expect(dispatchEvent).toHaveBeenCalled();
  });
});
