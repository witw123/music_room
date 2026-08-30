"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { TrackMeta } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import {
  appSettingsChangeEvent,
  getAppSettings,
  updateAppSettings
} from "@/features/settings/settings-store";
import {
  getActiveRoomLyricIndex,
  alignRoomLyricLines,
  getRoomLyricDisplayWords,
  parseRoomLyrics,
  selectRoomLyrics
} from "@/features/playback/lyrics";
import {
  capacitorPlugin,
  invokeTauri,
  isCapacitorRuntime,
  isTauriRuntime
} from "@/lib/desktop/tauri";

export type DesktopLyricsSource = "room" | "local";

export type DesktopLyricsPlayer = {
  source: DesktopLyricsSource;
  currentTrack: TrackMeta | null;
  playbackTrackId: string | null | undefined;
  isPlaying: boolean;
  progressMs: number;
  artworkUrl: string | null;
  canControlPlayback: boolean;
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
};

type DesktopLyricsRegistration = {
  updatePlayer: (player: DesktopLyricsPlayer) => void;
  unregisterPlayer: () => void;
};

type DesktopLyricsContextValue = {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  activePlayer: DesktopLyricsPlayer | null;
  lyrics: DesktopLyricsState;
  showTranslation: boolean;
  showRomanized: boolean;
  toggleTranslation: () => void;
  toggleRomanized: () => void;
  registerPlayer: (source: DesktopLyricsSource, player: DesktopLyricsPlayer) => DesktopLyricsRegistration;
};

type DesktopLyricsState = {
  status: "idle" | "loading" | "ready" | "error";
  plainLyric: string | null;
  translatedLyric: string | null;
  romanizedLyric: string | null;
  currentLine: string | null;
  translatedLine: string | null;
  romanizedLine: string | null;
};

type CachedLyrics = Omit<DesktopLyricsState, "status" | "currentLine" | "translatedLine" | "romanizedLine">;

const desktopLyricsPositionStorageKey = "music-room-desktop-lyrics-position-v1";
const desktopLyricsBridgeChannelName = "music-room-desktop-lyrics";
const desktopLyricsBridgeSnapshotKey = "music-room-desktop-lyrics-snapshot";
const lyricRequestCache = new Map<string, Promise<CachedLyrics>>();

type NativeDesktopLyricsPlugin = {
  toggle?: (args?: Record<string, unknown>) => Promise<{ granted?: boolean; visible?: boolean } | undefined>;
  hide?: (args?: Record<string, unknown>) => Promise<unknown>;
  updateLine?: (args: Record<string, unknown>) => Promise<unknown>;
  updatePlayback?: (args: Record<string, unknown>) => Promise<unknown>;
};

function getNativeDesktopLyricsPlugin(): NativeDesktopLyricsPlugin | undefined {
  return capacitorPlugin("DesktopLyrics") as NativeDesktopLyricsPlugin | undefined;
}

export const musicRoomCloseDesktopLyricsEvent = "music-room:close-desktop-lyrics";

export function closeDesktopLyricsNative() {
  if (isTauriRuntime()) {
    void invokeTauri("hide_desktop_lyrics_window");
  } else if (isCapacitorRuntime()) {
    void getNativeDesktopLyricsPlugin()?.hide?.({});
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(musicRoomCloseDesktopLyricsEvent));
  }
}

const emptyLyrics: DesktopLyricsState = {
  status: "idle",
  plainLyric: null,
  translatedLyric: null,
  romanizedLyric: null,
  currentLine: null,
  translatedLine: null,
  romanizedLine: null
};

const DesktopLyricsContext = createContext<DesktopLyricsContextValue | null>(null);

export function DesktopLyricsProvider({ children }: { children: ReactNode }) {
  const playersRef = useRef(new Map<DesktopLyricsSource, DesktopLyricsPlayer>());
  const [activePlayer, setActivePlayer] = useState<DesktopLyricsPlayer | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [lyrics, setLyrics] = useState<DesktopLyricsState>(emptyLyrics);
  const [showTranslation, setShowTranslation] = useState(true);
  const [showRomanized, setShowRomanized] = useState(false);
  const activePlayerRef = useRef<DesktopLyricsPlayer | null>(null);
  const bridgeChannelRef = useRef<BroadcastChannel | null>(null);
  const lastBridgeSnapshotWriteAtRef = useRef(0);
  activePlayerRef.current = activePlayer;
  const hasActivePlayer = activePlayer !== null;

  const close = useCallback(() => {
    if (isTauriRuntime()) {
      void invokeTauri("hide_desktop_lyrics_window");
    } else if (isCapacitorRuntime()) {
      void getNativeDesktopLyricsPlugin()?.hide?.({});
    }
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const handleClose = () => close();
    window.addEventListener(musicRoomCloseDesktopLyricsEvent, handleClose);
    return () => window.removeEventListener(musicRoomCloseDesktopLyricsEvent, handleClose);
  }, [close]);

  const selectActivePlayer = useCallback(() => {
    const roomPlayer = playersRef.current.get("room");
    const localPlayer = playersRef.current.get("local");
    const nextPlayer = roomPlayer?.currentTrack || roomPlayer?.playbackTrackId
      ? roomPlayer
      : localPlayer?.currentTrack || localPlayer?.playbackTrackId
        ? localPlayer
        : null;
    setActivePlayer(nextPlayer ?? null);
  }, []);

  const registerPlayer = useCallback((source: DesktopLyricsSource, player: DesktopLyricsPlayer) => {
    playersRef.current.set(source, player);
    setActivePlayer((current) => current?.source === source ? player : current);
    selectActivePlayer();

    return {
      updatePlayer: (nextPlayer: DesktopLyricsPlayer) => {
        playersRef.current.set(source, nextPlayer);
        setActivePlayer((current) => current?.source === source ? nextPlayer : current);
        selectActivePlayer();
      },
      unregisterPlayer: () => {
        const current = playersRef.current.get(source);
        if (current === player || current?.source === source) {
          playersRef.current.delete(source);
          selectActivePlayer();
          if (source === "room") {
            close();
          }
        }
      }
    };
  }, [close, selectActivePlayer]);

  useEffect(() => {
    const syncSettings = () => {
      const playback = getAppSettings().playback;
      setShowTranslation(playback.showLyricTranslation);
      setShowRomanized(playback.showLyricRomanized);
    };
    syncSettings();
    window.addEventListener(appSettingsChangeEvent, syncSettings);
    window.addEventListener("storage", syncSettings);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, syncSettings);
      window.removeEventListener("storage", syncSettings);
    };
  }, []);

  const activeTrackKey = activePlayer?.currentTrack
    ? `${activePlayer.currentTrack.sourceType}:${activePlayer.currentTrack.sourceRef?.trackId ?? activePlayer.currentTrack.id}:${activePlayer.currentTrack.lyrics ?? ""}:${activePlayer.currentTrack.translatedLyrics ?? ""}:${activePlayer.currentTrack.romanizedLyrics ?? ""}`
    : null;
  const activeTrack = activePlayer?.currentTrack ?? null;
  const activeProgressMs = activePlayer?.progressMs ?? 0;
  const activeIsPlaying = activePlayer?.isPlaying === true;

  useEffect(() => {
    let cancelled = false;
    const track = activeTrack;
    if (!isOpen || !track) {
      setLyrics(emptyLyrics);
      return () => {
        cancelled = true;
      };
    }

    const localLyrics = track.lyrics?.trim() || null;
    const localTranslated = track.translatedLyrics?.trim() || null;
    const localRomanized = track.romanizedLyrics?.trim() || null;
    const provider = track.sourceRef?.provider;
    const providerTrackId = track.sourceRef?.trackId;
    const directLyrics = selectRoomLyrics({ localLyrics });

    setLyrics({
      status: directLyrics || localTranslated || localRomanized ? "ready" : provider && providerTrackId ? "loading" : "ready",
      plainLyric: directLyrics,
      translatedLyric: localTranslated,
      romanizedLyric: localRomanized,
      currentLine: null,
      translatedLine: null,
      romanizedLine: null
    });

    if (directLyrics || !provider || !providerTrackId) {
      return () => {
        cancelled = true;
      };
    }

    const cacheKey = `${provider}:${providerTrackId}`;
    let request = lyricRequestCache.get(cacheKey);
    if (!request) {
      request = loadProviderLyrics(provider, providerTrackId);
      lyricRequestCache.set(cacheKey, request);
    }

    void request.then((result) => {
      if (cancelled) return;
      setLyrics({
        status: result.plainLyric || result.translatedLyric || result.romanizedLyric ? "ready" : "error",
        ...result,
        currentLine: null,
        translatedLine: null,
        romanizedLine: null
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeTrack, activeTrackKey, isOpen]);

  const lyricLines = useMemo(() => parseRoomLyrics(lyrics.plainLyric), [lyrics.plainLyric]);
  const translatedLines = useMemo(() => parseRoomLyrics(lyrics.translatedLyric), [lyrics.translatedLyric]);
  const romanizedLines = useMemo(() => parseRoomLyrics(lyrics.romanizedLyric), [lyrics.romanizedLyric]);

  useEffect(() => {
    if (!activePlayer || lyricLines.length === 0) {
      setLyrics((current) => ({ ...current, currentLine: null, translatedLine: null, romanizedLine: null }));
      return;
    }
    const activeIndex = Math.max(0, getActiveRoomLyricIndex(lyricLines, activePlayer.progressMs));
    const activeLine = lyricLines[activeIndex];
    const translatedLine = alignRoomLyricLines(lyricLines, translatedLines)[activeIndex]?.text ?? null;
    const romanizedLine = alignRoomLyricLines(lyricLines, romanizedLines)[activeIndex]?.text ?? null;
    setLyrics((current) => ({
      ...current,
      currentLine: activeLine?.text ?? null,
      translatedLine,
      romanizedLine
    }));
  }, [activePlayer, activePlayer?.progressMs, lyricLines, romanizedLines, translatedLines]);

  const toggleTranslation = useCallback(() => {
    setShowTranslation((current) => {
      const next = !current;
      updateAppSettings({ playback: { showLyricTranslation: next } });
      return next;
    });
  }, []);

  const toggleRomanized = useCallback(() => {
    setShowRomanized((current) => {
      const next = !current;
      updateAppSettings({ playback: { showLyricRomanized: next } });
      return next;
    });
  }, []);

  // ── Tauri desktop shell: bridge playback state to the native lyrics window
  // over BroadcastChannel; the window posts transport commands back. ──
  useEffect(() => {
    // Skip inside the lyrics window itself: it has no registered player and
    // must not echo empty state back at the main window.
    if (!isTauriRuntime() || !hasActivePlayer) return;
    const channel = new BroadcastChannel(desktopLyricsBridgeChannelName);
    channel.onmessage = (event) => {
      const data = event.data as { type?: string; action?: string; scale?: number } | null;
      if (!data || data.type !== "command") return;
      const player = activePlayerRef.current;
      if (data.action === "prev" && player?.canControlPlayback) player.onPrev();
      if (data.action === "toggle" && player?.canControlPlayback) player.onTogglePlay();
      if (data.action === "next" && player?.canControlPlayback) player.onNext();
      if (data.action === "toggleTranslation") toggleTranslation();
      if (data.action === "toggleRomanized") toggleRomanized();
      if (data.action === "setScale" && typeof data.scale === "number") {
        updateAppSettings({ playback: { desktopLyricScale: data.scale } });
      }
    };
    bridgeChannelRef.current = channel;
    return () => {
      channel.onmessage = null;
      channel.close();
      if (bridgeChannelRef.current === channel) {
        bridgeChannelRef.current = null;
      }
    };
  }, [hasActivePlayer, toggleRomanized, toggleTranslation]);

  const bridgeTrackPayload = useMemo(() => {
    if (!activeTrack) return null;
    return {
      title: activeTrack.title,
      artist: activeTrack.artist,
      artworkUrl: activePlayer?.artworkUrl ?? activeTrack.artworkUrl ?? null,
      durationMs: activeTrack.durationMs ?? null,
      plainLyric: lyrics.plainLyric,
      translatedLyric: lyrics.translatedLyric,
      romanizedLyric: lyrics.romanizedLyric
    };
  }, [activeTrack, activePlayer?.artworkUrl, lyrics.plainLyric, lyrics.translatedLyric, lyrics.romanizedLyric]);

  useEffect(() => {
    if (!isTauriRuntime() || !hasActivePlayer) return;
    const channel = bridgeChannelRef.current;
    if (!channel) return;
    const payload = {
      type: "state" as const,
      at: Date.now(),
      progressMs: activeProgressMs,
      isPlaying: activeIsPlaying,
      canControl: activePlayer?.canControlPlayback === true && Boolean(activePlayer?.playbackTrackId),
      showTranslation,
      showRomanized,
      track: bridgeTrackPayload
    };
    try {
      channel.postMessage(payload);
    } catch {
      // Bridge traffic is best-effort; the window re-syncs on the next tick.
    }
    const now = Date.now();
    if (now - lastBridgeSnapshotWriteAtRef.current >= 500) {
      lastBridgeSnapshotWriteAtRef.current = now;
      try {
        window.localStorage.setItem(desktopLyricsBridgeSnapshotKey, JSON.stringify(payload));
      } catch {
        // Storage may be unavailable; the channel still keeps the window live.
      }
    }
  }, [activeIsPlaying, hasActivePlayer, activePlayer?.canControlPlayback, activePlayer?.playbackTrackId, activeProgressMs, bridgeTrackPayload, showRomanized, showTranslation]);

  // ── Capacitor mobile shell: push anchors and char-level word timings to the
  // native SYSTEM_ALERT_WINDOW overlay; it interpolates and draws per frame. ──
  useEffect(() => {
    if (!isCapacitorRuntime() || !hasActivePlayer) return;
    getNativeDesktopLyricsPlugin()?.updatePlayback?.({
      isPlaying: activeIsPlaying,
      progressMs: activeProgressMs,
      at: Date.now()
    });
  }, [activeIsPlaying, hasActivePlayer, activeProgressMs]);

  useEffect(() => {
    if (!isCapacitorRuntime() || !hasActivePlayer || lyricLines.length === 0) return;
    const plugin = getNativeDesktopLyricsPlugin();
    if (!plugin?.updateLine) return;
    const activeIndex = Math.max(0, getActiveRoomLyricIndex(lyricLines, activeProgressMs));
    const words = getRoomLyricDisplayWords(lyricLines, activeIndex).map((word) => ({
      t: word.text,
      s: word.timeMs,
      d: word.durationMs
    }));
    const translation = showTranslation
      ? alignRoomLyricLines(lyricLines, translatedLines)[activeIndex]?.text ?? null
      : null;
    const romanized = showRomanized
      ? alignRoomLyricLines(lyricLines, romanizedLines)[activeIndex]?.text ?? null
      : null;
    plugin.updateLine({ words: JSON.stringify(words), translation, romanized });
  }, [activeProgressMs, hasActivePlayer, lyricLines, romanizedLines, showRomanized, showTranslation, translatedLines]);

  const toggle = useCallback(() => {
    if (isTauriRuntime()) {
      // The async shell command reports the real post-toggle visibility;
      // optimistic state would drift when window creation fails.
      void invokeTauri<boolean>("toggle_desktop_lyrics").then((visible) => {
        setIsOpen(visible === true);
      });
      return;
    }
    if (isCapacitorRuntime()) {
      // Without the overlay permission this opens the system settings page;
      // toggling again after granting shows the lyrics.
      void getNativeDesktopLyricsPlugin()?.toggle?.({});
      setIsOpen((current) => !current);
      return;
    }
    setIsOpen((current) => !current);
  }, []);

  const value = useMemo<DesktopLyricsContextValue>(() => ({
    isOpen,
    toggle,
    close,
    activePlayer,
    lyrics,
    showTranslation,
    showRomanized,
    toggleTranslation,
    toggleRomanized,
    registerPlayer
  }), [activePlayer, close, isOpen, lyrics, registerPlayer, showRomanized, showTranslation, toggle, toggleRomanized, toggleTranslation]);

  return <DesktopLyricsContext.Provider value={value}>{children}</DesktopLyricsContext.Provider>;
}

export function useDesktopLyrics() {
  const context = useContext(DesktopLyricsContext);
  if (!context) {
    throw new Error("useDesktopLyrics must be used inside DesktopLyricsProvider");
  }
  return context;
}

export function useDesktopLyricsRegistration(player: DesktopLyricsPlayer) {
  const { registerPlayer } = useDesktopLyrics();
  const registrationRef = useRef<DesktopLyricsRegistration | null>(null);
  const playerRef = useRef(player);
  playerRef.current = player;

  useEffect(() => {
    registrationRef.current = registerPlayer(player.source, playerRef.current);
    return () => {
      registrationRef.current?.unregisterPlayer();
      registrationRef.current = null;
    };
  }, [player.source, registerPlayer]);

  useEffect(() => {
    registrationRef.current?.updatePlayer(player);
  }, [player]);
}

async function loadProviderLyrics(provider: "netease" | "qqmusic", trackId: string): Promise<CachedLyrics> {
  try {
    const response = provider === "netease"
      ? await musicRoomApi.getNeteaseLyrics(trackId)
      : await musicRoomApi.getQqMusicLyrics(trackId);
    return {
      plainLyric: selectRoomLyrics({
        wordSyncedLyric: response.wordSyncedLyric,
        plainLyric: response.plainLyric
      }),
      translatedLyric: response.translatedLyric?.trim() || null,
      romanizedLyric: response.romanizedLyric?.trim() || null
    };
  } catch {
    return { plainLyric: null, translatedLyric: null, romanizedLyric: null };
  }
}

export function getDesktopLyricsPositionStorageKey() {
  return desktopLyricsPositionStorageKey;
}
