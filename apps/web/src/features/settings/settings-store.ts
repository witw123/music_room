import type { PlaybackMode } from "@music-room/shared";

export const appSettingsStorageKey = "music-room-settings-v1";
export const appSettingsChangeEvent = "music-room-settings-change";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;
export type PlayerStyle = "vinyl" | "square-cover";
export type DiscoverProvider = "netease" | "qqmusic";
export type CustomLayoutPageId = "home" | "discover" | "playlists" | "favorites" | "profile" | "settings";
export type CustomLayoutItemId = "sidebar" | "content" | "player" | "mobile-navigation";

export type CustomLayoutItem = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  locked: boolean;
};

export type CustomLayoutPage = Record<CustomLayoutItemId, CustomLayoutItem>;

export type CustomLayoutSettings = {
  enabled: boolean;
  pages: Record<CustomLayoutPageId, CustomLayoutPage>;
};

export const customLayoutCanvas = {
  width: 1440,
  height: 900
} as const;

export const customLayoutPageIds: CustomLayoutPageId[] = [
  "home",
  "discover",
  "playlists",
  "favorites",
  "profile",
  "settings"
];

export const customLayoutPageLabels: Record<CustomLayoutPageId, string> = {
  home: "首页",
  discover: "发现",
  playlists: "歌单",
  favorites: "收藏",
  profile: "我的",
  settings: "设置"
};

export const customLayoutItemLabels: Record<CustomLayoutItemId, string> = {
  sidebar: "侧边栏",
  content: "主内容",
  player: "底部播放器",
  "mobile-navigation": "移动端导航"
};

export type AppSettings = {
  version: 1;
  theme: ThemePreference;
  layout: {
    sidebarCollapsed: boolean;
    reduceMotion: boolean;
    customLayout: CustomLayoutSettings;
  };
  discover: {
    provider: DiscoverProvider;
  };
  playback: {
    defaultVolume: number;
    loudnessNormalization: boolean;
    playerStyle: PlayerStyle;
    disableArtworkColor: boolean;
    localPlaybackMode: PlaybackMode;
    showLyricsByDefault: boolean;
    preventOfflineAutoLoad: boolean;
    streamingOnlyPlayback: boolean;
    fullyCachedPlayback: boolean;
    lyricFontScale: "small" | "medium" | "large";
    lyricLines: number;
  };
};

const defaultSettings: AppSettings = {
  version: 1,
  theme: "dark",
  layout: {
    sidebarCollapsed: true,
    reduceMotion: false,
    customLayout: getDefaultCustomLayoutSettings()
  },
  discover: {
    provider: "netease"
  },
  playback: {
    defaultVolume: 0.8,
    loudnessNormalization: false,
    playerStyle: "vinyl",
    disableArtworkColor: false,
    localPlaybackMode: "sequence",
    showLyricsByDefault: false,
    preventOfflineAutoLoad: false,
    streamingOnlyPlayback: false,
    fullyCachedPlayback: false,
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
    discover: Partial<AppSettings["discover"]>;
    playback: Partial<AppSettings["playback"]>;
  }>
) {
  const current = getAppSettings();
  const next = normalizeSettings({
    ...current,
    ...patch,
    layout: { ...current.layout, ...patch.layout },
    discover: { ...current.discover, ...patch.discover },
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
  const discover = isRecord(input.discover) ? input.discover : {};
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
  const playerStyle: PlayerStyle = playback.playerStyle === "square-cover" ? "square-cover" : "vinyl";
  const lyricFontScale = playback.lyricFontScale === "small" || playback.lyricFontScale === "large"
    ? playback.lyricFontScale
    : "medium";

  return {
    version: 1,
    theme: input.theme === "light" || input.theme === "system" ? input.theme : "dark",
    layout: {
      sidebarCollapsed: layout.sidebarCollapsed !== false,
      reduceMotion: layout.reduceMotion === true,
      customLayout: normalizeCustomLayoutSettings(layout.customLayout)
    },
    discover: {
      provider: discover.provider === "qqmusic" ? "qqmusic" : "netease"
    },
    playback: {
      defaultVolume: volume,
      loudnessNormalization: playback.loudnessNormalization === true,
      playerStyle,
      disableArtworkColor: playback.disableArtworkColor === true,
      localPlaybackMode: playbackMode,
      showLyricsByDefault: playback.showLyricsByDefault === true,
      preventOfflineAutoLoad: playback.preventOfflineAutoLoad === true,
      streamingOnlyPlayback: playback.streamingOnlyPlayback === true,
      fullyCachedPlayback: playback.fullyCachedPlayback === true,
      lyricFontScale,
      lyricLines
    }
  };
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    version: settings.version,
    theme: settings.theme,
    layout: {
      sidebarCollapsed: settings.layout.sidebarCollapsed,
      reduceMotion: settings.layout.reduceMotion,
      customLayout: cloneCustomLayoutSettings(settings.layout.customLayout)
    },
    discover: { ...settings.discover },
    playback: { ...settings.playback }
  };
}

function cloneCustomLayoutSettings(settings: CustomLayoutSettings): CustomLayoutSettings {
  return {
    enabled: settings.enabled,
    pages: Object.fromEntries(
      customLayoutPageIds.map((pageId) => [
        pageId,
        Object.fromEntries(
          (Object.entries(settings.pages[pageId]) as Array<[CustomLayoutItemId, CustomLayoutItem]>).map(([itemId, item]) => [
            itemId,
            { ...item }
          ])
        ) as CustomLayoutPage
      ])
    ) as Record<CustomLayoutPageId, CustomLayoutPage>
  };
}

export function getDefaultCustomLayoutSettings(): CustomLayoutSettings {
  const pages = Object.fromEntries(
    customLayoutPageIds.map((pageId) => [pageId, createDefaultCustomLayoutPage()])
  ) as Record<CustomLayoutPageId, CustomLayoutPage>;
  return { enabled: false, pages };
}

export function normalizeCustomLayoutSettings(value: unknown): CustomLayoutSettings {
  const input = isRecord(value) ? value : {};
  const pagesInput = isRecord(input.pages) ? input.pages : {};
  const defaults = getDefaultCustomLayoutSettings();
  const pages = Object.fromEntries(
    customLayoutPageIds.map((pageId) => {
      const pageInput = isRecord(pagesInput[pageId]) ? pagesInput[pageId] : {};
      const defaultPage = defaults.pages[pageId];
      const page = Object.fromEntries(
        (Object.keys(defaultPage) as CustomLayoutItemId[]).map((itemId) => [
          itemId,
          normalizeCustomLayoutItem(pageInput[itemId], defaultPage[itemId])
        ])
      ) as CustomLayoutPage;
      return [pageId, page];
    })
  ) as Record<CustomLayoutPageId, CustomLayoutPage>;

  return {
    enabled: input.enabled === true,
    pages
  };
}

export function getCustomLayoutPageId(pathname: string | null): CustomLayoutPageId {
  if (pathname?.startsWith("/app/discover")) return "discover";
  if (pathname?.startsWith("/app/playlists")) return "playlists";
  if (pathname?.startsWith("/app/favorites")) return "favorites";
  if (pathname?.startsWith("/app/profile")) return "profile";
  if (pathname?.startsWith("/app/settings")) return "settings";
  return "home";
}

function createDefaultCustomLayoutPage(): CustomLayoutPage {
  return {
    sidebar: { x: 0, y: 0, width: 64, height: 840, visible: true, locked: false },
    content: { x: 64, y: 0, width: 1376, height: 840, visible: true, locked: false },
    player: { x: 64, y: 840, width: 1376, height: 60, visible: true, locked: false },
    "mobile-navigation": { x: 0, y: 840, width: 1440, height: 60, visible: true, locked: true }
  };
}

function normalizeCustomLayoutItem(value: unknown, fallback: CustomLayoutItem): CustomLayoutItem {
  const input = isRecord(value) ? value : {};
  const width = normalizeLayoutNumber(input.width, fallback.width, 160, customLayoutCanvas.width);
  const height = normalizeLayoutNumber(input.height, fallback.height, 56, customLayoutCanvas.height);
  return {
    x: normalizeLayoutNumber(input.x, fallback.x, 0, customLayoutCanvas.width - width),
    y: normalizeLayoutNumber(input.y, fallback.y, 0, customLayoutCanvas.height - height),
    width,
    height,
    visible: input.visible !== false,
    locked: input.locked === true
  };
}

function normalizeLayoutNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.min(maximum, Math.max(minimum, numeric)));
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f5f7fb" : "#09090b");
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
