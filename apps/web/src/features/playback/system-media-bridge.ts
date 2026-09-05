"use client";

import { useEffect, useRef } from "react";
import {
  capacitorPlugin,
  invokeTauri,
  listenTauri,
  isCapacitorRuntime,
  isTauriRuntime
} from "@/lib/desktop/tauri";

export type SystemMediaSnapshot = {
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  durationMs: number;
  positionMs: number;
  isPlaying: boolean;
};

export type SystemMediaHandlers = {
  onPlay: () => void;
  onPause: () => void;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeekTo: (positionMs: number) => void;
  onSeekBy: (deltaMs: number) => void;
};

const positionPushIntervalMs = 1_000;

type CommandPayload = { action?: string; positionMs?: number; deltaMs?: number };

function applyCommand(
  action: string | undefined,
  positionMs: number | undefined,
  deltaMs: number | undefined,
  handlers: SystemMediaHandlers
) {
  switch (action) {
    case "play":
      handlers.onPlay();
      break;
    case "pause":
      handlers.onPause();
      break;
    case "toggle":
      handlers.onToggle();
      break;
    case "next":
      handlers.onNext();
      break;
    case "prev":
      handlers.onPrev();
      break;
    case "seekTo":
      if (typeof positionMs === "number") handlers.onSeekTo(positionMs);
      break;
    case "seekBy":
      if (typeof deltaMs === "number") handlers.onSeekBy(deltaMs);
      break;
    default:
      break;
  }
}

/**
 * Bridges playback state to the OS system media player of each shell:
 *
 * - Tauri desktop: Windows (SMTC via WinRT), macOS (Now Playing), Linux (MPRIS)
 *   via `system_media_*` shell commands.
 * - Capacitor Android: the SystemMediaControls plugin owns a system media
 *   session + MediaStyle notification.
 * - Plain browsers: covered by the existing Media Session API wiring, so this
 *   hook stays passive.
 *
 * The command listener is registered once; metadata/playback pushes are
 * deduplicated (metadata by key, playback state by a 1s throttle).
 */
export function useSystemMediaTransport(input: {
  snapshot: SystemMediaSnapshot | null;
  handlers: SystemMediaHandlers;
}) {
  const { snapshot } = input;
  const handlersRef = useRef(input.handlers);
  handlersRef.current = input.handlers;
  const lastMetaKeyRef = useRef("");
  const lastPositionPushAtRef = useRef(0);
  const lastIsPlayingRef = useRef(false);
  const isNative = isCapacitorRuntime() || isTauriRuntime();

  // System commands (hardware keys handled separately via "media-key").
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const apply = (payload: CommandPayload | undefined) => {
      applyCommand(payload?.action, payload?.positionMs, payload?.deltaMs, handlersRef.current);
    };

    if (isTauriRuntime()) {
      void listenTauri<CommandPayload>("system-media-command", (payload) => {
        apply(payload);
      }).then((stop) => {
        if (cancelled) stop?.();
        else unlisten = stop;
      });
    } else {
      const plugin = capacitorPlugin("SystemMediaControls") as
        | {
            addListener?: (
              event: string,
              callback: (payload: CommandPayload) => void
            ) => Promise<{ remove: () => void }>;
          }
        | undefined;
      void plugin
        ?.addListener?.("systemMediaCommand", (payload) => {
          apply(payload);
        })
        .then((listenerHandle) => {
          if (cancelled) listenerHandle.remove();
          else unlisten = () => listenerHandle.remove();
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = undefined;
    };
  }, [isNative]);

  // Metadata: push on any track change; nothing playing clears the surface.
  useEffect(() => {
    if (!isNative) return;
    if (!snapshot) {
      if (lastMetaKeyRef.current === "") return;
      lastMetaKeyRef.current = "";
      if (isTauriRuntime()) void invokeTauri("system_media_clear");
      else void capacitorPlugin("SystemMediaControls")?.hide?.({});
      return;
    }

    const metaKey = [
      snapshot.title,
      snapshot.artist,
      snapshot.album,
      snapshot.artworkUrl,
      Math.round(snapshot.durationMs / 1000)
    ].join("|");
    if (lastMetaKeyRef.current === metaKey) return;
    lastMetaKeyRef.current = metaKey;

    if (isTauriRuntime()) {
      void invokeTauri("system_media_update_meta", {
        title: snapshot.title,
        artist: snapshot.artist,
        album: snapshot.album,
        artworkUrl: snapshot.artworkUrl,
        durationSecs: snapshot.durationMs / 1000
      });
    } else {
      void capacitorPlugin("SystemMediaControls")?.updateMetadata?.({
        title: snapshot.title,
        artist: snapshot.artist,
        album: snapshot.album,
        artworkUrl: snapshot.artworkUrl,
        durationMs: snapshot.durationMs
      });
    }
  }, [isNative, snapshot]);

  // Playback state: push immediately on play/pause, throttled while playing
  // so the OS timeline tracks the position without flooding the bridge.
  useEffect(() => {
    if (!isNative || !snapshot) return;
    const playingChanged = lastIsPlayingRef.current !== snapshot.isPlaying;
    const now = Date.now();
    if (!playingChanged && snapshot.isPlaying && now - lastPositionPushAtRef.current < positionPushIntervalMs) {
      return;
    }
    lastIsPlayingRef.current = snapshot.isPlaying;
    lastPositionPushAtRef.current = now;

    if (isTauriRuntime()) {
      void invokeTauri("system_media_update_playback", {
        isPlaying: snapshot.isPlaying,
        positionMs: snapshot.positionMs
      });
    } else {
      void capacitorPlugin("SystemMediaControls")?.updatePlaybackState?.({
        isPlaying: snapshot.isPlaying,
        positionMs: snapshot.positionMs
      });
    }
  }, [isNative, snapshot]);
}
