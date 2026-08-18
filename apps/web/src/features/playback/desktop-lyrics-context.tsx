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
  getAppSettings
} from "@/features/settings/settings-store";
import {
  getActiveRoomLyricIndex,
  alignRoomLyricLines,
  parseRoomLyrics,
  selectRoomLyrics
} from "@/features/playback/lyrics";

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
const lyricRequestCache = new Map<string, Promise<CachedLyrics>>();

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
        }
      }
    };
  }, [selectActivePlayer]);

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

  const value = useMemo<DesktopLyricsContextValue>(() => ({
    isOpen,
    toggle: () => setIsOpen((current) => !current),
    close: () => setIsOpen(false),
    activePlayer,
    lyrics,
    showTranslation,
    showRomanized,
    registerPlayer
  }), [activePlayer, isOpen, lyrics, registerPlayer, showRomanized, showTranslation]);

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
