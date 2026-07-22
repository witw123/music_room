import type { PlaybackMode } from "@music-room/shared";

export const appSettingsStorageKey = "music-room-settings-v1";
export const appSettingsChangeEvent = "music-room-settings-change";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export type AppSettings = {
  version: 1;
  theme: ThemePreference;
  layout: {
    sidebarCollapsed: boolean;
    reduceMotion: boolean;
  };
  playback: {
    defaultVolume: number;
    localPlaybackMode: PlaybackMode;
    showLyricsByDefault: boolean;
    preventOfflineAutoLoad: boolean;
    streamingOnlyPlayback: boolean;
    lyricFontScale: "small" | "medium" | "large";
    lyricLines: number;
  };
};

const defaultSettings: AppSettings = {
  version: 1,
  theme: "dark",
  layout: {
    sidebarCollapsed: true,
    reduceMotion: false
  },
  playback: {
    defaultVolume: 0.8,
    localPlaybackMode: "sequence",
    showLyricsByDefault: false,
    preventOfflineAutoLoad: false,
    streamingOnlyPlayback: false,
    lyricFontScale: "medium",
    lyricLines: 5
  }
};

export function getDefaultAppSettings() {
  return cloneSettings(defaultSettings);
}

export function getAppSettings(): AppSettings {
  if (typeof window === "undefined") return cloneSettings(defaultSettings);

  try {
    const raw = window.localStorage.getItem(appSettingsStorageKey);
    if (!raw) return cloneSettings(defaultSettings);
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return cloneSettings(defaultSettings);
  }
}

export function updateAppSettings(
  patch: Partial<{
    theme: ThemePreference;
    layout: Partial<AppSettings["layout"]>;
    playback: Partial<AppSettings["playback"]>;
  }>
) {
  const current = getAppSettings();
  const next = normalizeSettings({
    ...current,
    ...patch,
    layout: { ...current.layout, ...patch.layout },
    playback: { ...current.playback, ...patch.playback }
  });
  if (typeof window !== "undefined") {
    window.localStorage.setItem(appSettingsStorageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(appSettingsChangeEvent));
  }
  return next;
}

export function resetAppSettings() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(appSettingsStorageKey);
    window.dispatchEvent(new Event(appSettingsChangeEvent));
  }
  return cloneSettings(defaultSettings);
}

export function normalizeSettings(value: unknown): AppSettings {
  const input = isRecord(value) ? value : {};
  const layout = isRecord(input.layout) ? input.layout : {};
  const playback = isRecord(input.playback) ? input.playback : {};
  const volume = typeof playback.defaultVolume === "number" && Number.isFinite(playback.defaultVolume)
    ? Math.min(1, Math.max(0, playback.defaultVolume))
    : defaultSettings.playback.defaultVolume;
  const lyricLines = typeof playback.lyricLines === "number" && Number.isFinite(playback.lyricLines)
    ? Math.round(Math.min(7, Math.max(3, playback.lyricLines)))
    : defaultSettings.playback.lyricLines;
  const playbackMode = playback.localPlaybackMode === "shuffle" || playback.localPlaybackMode === "single"
    ? playback.localPlaybackMode
    : "sequence";
  const lyricFontScale = playback.lyricFontScale === "small" || playback.lyricFontScale === "large"
    ? playback.lyricFontScale
    : "medium";

  return {
    version: 1,
    theme: input.theme === "light" || input.theme === "system" ? input.theme : "dark",
    layout: {
      sidebarCollapsed: layout.sidebarCollapsed !== false,
      reduceMotion: layout.reduceMotion === true
    },
    playback: {
      defaultVolume: volume,
      localPlaybackMode: playbackMode,
      showLyricsByDefault: playback.showLyricsByDefault === true,
      preventOfflineAutoLoad: playback.preventOfflineAutoLoad === true,
      streamingOnlyPlayback: playback.streamingOnlyPlayback === true,
      lyricFontScale,
      lyricLines
    }
  };
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    version: settings.version,
    theme: settings.theme,
    layout: { ...settings.layout },
    playback: { ...settings.playback }
  };
}

export function resolveAppTheme(preference: ThemePreference, prefersLight?: boolean): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "system") {
    const systemPrefersLight = prefersLight ?? (
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
        : false
    );
    return systemPrefersLight ? "light" : "dark";
  }
  return "dark";
}

export function applyAppTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveAppTheme(preference);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
