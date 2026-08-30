"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DesktopLyricsBar } from "@/components/desktop-lyrics/DesktopLyricsBar";
import { invokeTauri } from "@/lib/desktop/tauri";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Player state snapshot bridged from the main window over BroadcastChannel.
 * Also mirrored into localStorage so a freshly opened lyrics window renders
 * the current track immediately instead of waiting for the next tick.
 */
type BridgeState = {
  track: {
    title: string;
    artist: string;
    artworkUrl: string | null;
    plainLyric: string | null;
    translatedLyric: string | null;
    romanizedLyric: string | null;
  } | null;
  progressMs: number;
  anchorAt: number;
  isPlaying: boolean;
  canControl: boolean;
};

const bridgeChannelName = "music-room-desktop-lyrics";
const bridgeSnapshotKey = "music-room-desktop-lyrics-snapshot";
const emptyState: BridgeState = {
  track: null,
  progressMs: 0,
  anchorAt: Date.now(),
  isPlaying: false,
  canControl: false
};

function readSnapshot(): BridgeState {
  if (typeof window === "undefined") return emptyState;
  try {
    const raw = window.localStorage.getItem(bridgeSnapshotKey);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as Partial<BridgeState>;
    if (!parsed || typeof parsed !== "object") return emptyState;
    return {
      track: parsed.track ?? null,
      progressMs: typeof parsed.progressMs === "number" ? parsed.progressMs : 0,
      anchorAt: typeof parsed.anchorAt === "number" ? parsed.anchorAt : Date.now(),
      isPlaying: parsed.isPlaying === true,
      canControl: parsed.canControl === true
    };
  } catch {
    return emptyState;
  }
}

export function DesktopLyricsWindowApp() {
  const [state, setState] = useState<BridgeState>(readSnapshot);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    // The native lyrics window is transparent on Windows/Linux; macOS builds
    // of tauri 2.11 cannot create transparent windows, so fall back to an
    // opaque dark surface there instead of a white flash.
    const isMacintosh = /Macintosh|Mac OS X/.test(navigator.userAgent);
    const background = isMacintosh ? "#0c0e13" : "transparent";
    document.documentElement.style.background = background;
    document.body.style.background = background;
    document.body.style.overflow = "hidden";

    const channel = new BroadcastChannel(bridgeChannelName);
    channel.onmessage = (event) => {
      const data = event.data as Partial<BridgeState> & { type?: string } | null;
      if (!data || data.type !== "state") return;
      setState({
        track: data.track ?? null,
        progressMs: typeof data.progressMs === "number" ? data.progressMs : 0,
        anchorAt: typeof data.anchorAt === "number" ? data.anchorAt : Date.now(),
        isPlaying: data.isPlaying === true,
        canControl: data.canControl === true
      });
    };
    channelRef.current = channel;
    return () => {
      channel.onmessage = null;
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const postCommand = useCallback((action: "prev" | "toggle" | "next") => {
    channelRef.current?.postMessage({ type: "command", action });
  }, []);

  const handleDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void invokeTauri("drag_desktop_lyrics_window");
  }, []);

  const canControl = state.canControl;
  const lyrics = useMemo(
    () => ({
      plainLyric: state.track?.plainLyric ?? null,
      translatedLyric: state.track?.translatedLyric ?? null,
      romanizedLyric: state.track?.romanizedLyric ?? null
    }),
    [state.track]
  );

  return (
    <main
      className="flex h-[100dvh] w-full items-center justify-center overflow-hidden p-2"
      data-testid="desktop-lyrics-window"
    >
      <div className="w-full">
        <DesktopLyricsBar
          artist={state.track?.artist ?? "暂无艺人信息"}
          artworkUrl={state.track?.artworkUrl ?? null}
          canControl={canControl}
          isPlaying={state.isPlaying}
          lyrics={lyrics}
          anchorAt={state.anchorAt}
          onClose={() => void invokeTauri("hide_desktop_lyrics_window")}
          onDragStart={handleDragStart}
          onNext={() => postCommand("next")}
          onPrev={() => postCommand("prev")}
          onTogglePlay={() => postCommand("toggle")}
          progressMs={state.progressMs}
          showRomanized
          showTranslation
          status={state.track ? "ready" : "idle"}
          title={state.track?.title ?? "等待选择歌曲"}
        />
      </div>
    </main>
  );
}
