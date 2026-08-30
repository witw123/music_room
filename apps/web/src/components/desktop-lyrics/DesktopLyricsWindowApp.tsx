"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DesktopLyricsBar } from "@/components/desktop-lyrics/DesktopLyricsBar";
import { invokeTauri } from "@/lib/desktop/tauri";
import { appSettingsChangeEvent, getAppSettings } from "@/features/settings/settings-store";
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

type ResizeGesture = {
  edge: "west" | "east" | "north" | "south" | "northwest" | "northeast" | "southwest" | "southeast";
  // Screen coordinates stay stable while the window itself is being resized,
  // unlike viewport coordinates which shift with every size change.
  startScreenX: number;
  startScreenY: number;
  startWidth: number;
  startHeight: number;
};

const resizeEdgePx = 14;
const minWidth = 320;
const minHeight = 64;
const maxWidth = 2400;
const maxHeight = 600;

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

function pickResizeEdge(event: { clientX: number; clientY: number }): ResizeGesture["edge"] | null {
  const nearLeft = event.clientX <= resizeEdgePx;
  const nearRight = event.clientX >= window.innerWidth - resizeEdgePx;
  const nearTop = event.clientY <= resizeEdgePx;
  const nearBottom = event.clientY >= window.innerHeight - resizeEdgePx;
  if (nearLeft && nearTop) return "northwest";
  if (nearRight && nearTop) return "northeast";
  if (nearLeft && nearBottom) return "southwest";
  if (nearRight && nearBottom) return "southeast";
  if (nearLeft) return "west";
  if (nearRight) return "east";
  if (nearTop) return "north";
  if (nearBottom) return "south";
  return null;
}

export function DesktopLyricsWindowApp() {
  const [state, setState] = useState<BridgeState>(readSnapshot);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const resizeGestureRef = useRef<ResizeGesture | null>(null);
  const pendingSizeRef = useRef<{ width: number; height: number } | null>(null);
  const sizeRafRef = useRef(0);
  // The settings slider resizes the native window proportionally; the lyrics
  // font then follows the window height (see DesktopLyricsBar).
  useEffect(() => {
    const syncScale = () => {
      const scale = getAppSettings().playback.desktopLyricScale;
      void invokeTauri("set_desktop_lyrics_size", {
        width: Math.round(860 * scale),
        height: Math.round(96 * scale)
      });
    };
    syncScale();
    window.addEventListener(appSettingsChangeEvent, syncScale);
    window.addEventListener("storage", syncScale);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, syncScale);
      window.removeEventListener("storage", syncScale);
    };
  }, []);

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

  // Bar interactions: near the window edges a pointer drag resizes the
  // window; anywhere else it moves the window (native start_dragging).
  const handleBarPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const edge = pickResizeEdge(event);
    if (edge) {
      resizeGestureRef.current = {
        edge,
        startScreenX: event.screenX,
        startScreenY: event.screenY,
        startWidth: window.innerWidth,
        startHeight: window.innerHeight
      };
      // Capture the pointer so moves outside the window bounds (which every
      // west/north resize requires) keep streaming into this element.
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    void invokeTauri("drag_desktop_lyrics_window");
  }, []);

  useEffect(() => {
    const flushPendingSize = () => {
      const pending = pendingSizeRef.current;
      if (!pending) return;
      pendingSizeRef.current = null;
      sizeRafRef.current = 0;
      void invokeTauri("set_desktop_lyrics_size", pending);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const gesture = resizeGestureRef.current;
      if (!gesture) return;
      let width = gesture.startWidth;
      let height = gesture.startHeight;
      const dx = event.screenX - gesture.startScreenX;
      const dy = event.screenY - gesture.startScreenY;
      if (gesture.edge.includes("east")) width = gesture.startWidth + dx;
      if (gesture.edge.includes("west")) width = gesture.startWidth - dx;
      if (gesture.edge.includes("south")) height = gesture.startHeight + dy;
      if (gesture.edge.includes("north")) height = gesture.startHeight - dy;
      pendingSizeRef.current = {
        width: Math.min(maxWidth, Math.max(minWidth, width)),
        height: Math.min(maxHeight, Math.max(minHeight, height))
      };
      if (!sizeRafRef.current) {
        sizeRafRef.current = window.requestAnimationFrame(flushPendingSize);
      }
    };
    const handlePointerUp = () => {
      resizeGestureRef.current = null;
      if (sizeRafRef.current) {
        window.cancelAnimationFrame(sizeRafRef.current);
        sizeRafRef.current = 0;
      }
      flushPendingSize();
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  const canControl = state.canControl;
  const plainLyric = state.track?.plainLyric ?? null;

  return (
    <main
      className="flex h-[100dvh] w-full items-center overflow-hidden"
      data-testid="desktop-lyrics-window"
    >
      <div className="h-full w-full">
        <DesktopLyricsBar
          title={state.track?.title ?? "等待选择歌曲"}
          artworkUrl={state.track?.artworkUrl ?? null}
          canControl={canControl}
          isPlaying={state.isPlaying}
          plainLyric={plainLyric}
          anchorAt={state.anchorAt}
          onClose={() => void invokeTauri("hide_desktop_lyrics_window")}
          onPointerDown={handleBarPointerDown}
          onNext={() => postCommand("next")}
          onPrev={() => postCommand("prev")}
          onTogglePlay={() => postCommand("toggle")}
          progressMs={state.progressMs}
          status={state.track ? "ready" : "idle"}
        />
      </div>
    </main>
  );
}
