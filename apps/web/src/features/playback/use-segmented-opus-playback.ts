"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSnapshot, TrackMeta } from "@music-room/shared";
import {
  getAssetUnit,
  putAssetManifest
} from "@/lib/indexeddb";
import { getRoomPlaybackClockNowMs } from "./room-playback-clock";
import { SegmentedOpusEngine } from "./segmented-opus-engine";
import { roomAudioOutput } from "./room-audio-output";

export type SegmentedPlaybackState =
  | "idle"
  | "awaiting-unlock"
  | "buffering"
  | "live"
  | "paused"
  | "unavailable"
  | "ended";

export type SegmentedPlaybackSnapshot = {
  state: SegmentedPlaybackState;
  playbackIdentity?: string | null;
  bufferedMs: number;
  ownedUnitCount: number;
  totalUnitCount: number;
  audioContextState: AudioContextState | null;
  lastError: string | null;
  sourceHealth?: "source-ready" | "source-underrun" | "source-silent" | "source-ended";
  sourceEnergy?: number;
  decodedPeak?: number;
  decodedRms?: number;
  maxSampleDelta?: number;
  underrunCount?: number;
  lastUnderrunAt?: string | null;
  lastDecodeError?: string | null;
};

const idleSnapshot: SegmentedPlaybackSnapshot = {
  state: "idle",
  playbackIdentity: null,
  bufferedMs: 0,
  ownedUnitCount: 0,
  totalUnitCount: 0,
  audioContextState: null,
  lastError: null
};

export function useSegmentedOpusPlayback(input: {
  roomSnapshot: RoomSnapshot | null;
  currentTrack: TrackMeta | null;
  peerId: string;
  isCurrentSource: boolean;
  volume: number;
  audioUnlocked: boolean;
}) {
  const { roomSnapshot, peerId, isCurrentSource, volume } = input;
  const engineRef = useRef<SegmentedOpusEngine | null>(null);
  const runtimeRef = useRef(input);
  runtimeRef.current = input;
  const tickingRef = useRef(false);
  const activePlaybackAssetIdRef = useRef<string | null>(null);
  const storedManifestAssetIdRef = useRef<string | null>(null);
  const playbackEngineIdentityRef = useRef<string | null>(null);
  const playbackGenerationRef = useRef(0);
  const [snapshot, setSnapshot] = useState<SegmentedPlaybackSnapshot>(idleSnapshot);
  const roomId = roomSnapshot?.room.id ?? null;
  const hasActivePlayback = hasActiveSegmentedPlayback({
    isCurrentSource,
    currentTrackId: roomSnapshot?.room.playback.currentTrackId,
    hasPlaybackAsset: !!input.currentTrack?.playbackAsset
  });
  const playbackIdentity = resolveSegmentedPlaybackIdentity({
    playback: roomSnapshot?.room.playback,
    playbackAssetId: input.currentTrack?.playbackAsset?.assetId
  });
  const releaseEngine = useCallback(() => {
    playbackGenerationRef.current += 1;
    engineRef.current?.destroy();
    engineRef.current = null;
    activePlaybackAssetIdRef.current = null;
    storedManifestAssetIdRef.current = null;
    playbackEngineIdentityRef.current = null;
  }, []);

  useEffect(() => {
    if (hasActivePlayback) {
      return;
    }

    releaseEngine();
    setSnapshot(idleSnapshot);
  }, [hasActivePlayback, releaseEngine]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled || tickingRef.current) {
        return;
      }
      tickingRef.current = true;
      let generation = playbackGenerationRef.current;
      try {
        const runtime = runtimeRef.current;
        const currentPlaybackAsset = runtime.currentTrack?.playbackAsset;
        const currentPlayback = runtime.roomSnapshot?.room.playback;
        const currentPlaybackIdentity = resolveSegmentedPlaybackIdentity({
          playback: currentPlayback,
          playbackAssetId: currentPlaybackAsset?.assetId
        });
        const currentPlaybackEngineIdentity = resolveSegmentedPlaybackEngineIdentity({
          playback: currentPlayback,
          playbackAssetId: currentPlaybackAsset?.assetId
        });
        if (playbackEngineIdentityRef.current !== currentPlaybackEngineIdentity) {
          engineRef.current?.destroy();
          engineRef.current = null;
          activePlaybackAssetIdRef.current = null;
          storedManifestAssetIdRef.current = null;
          playbackEngineIdentityRef.current = currentPlaybackEngineIdentity;
          playbackGenerationRef.current += 1;
        }
        generation = playbackGenerationRef.current;
        if (
          cancelled ||
          !currentPlaybackAsset ||
          !currentPlayback ||
          currentPlayback.currentTrackId !== runtime.currentTrack?.id
          || !runtime.isCurrentSource
        ) {
          setSnapshot({ ...idleSnapshot, playbackIdentity: currentPlaybackIdentity });
          return;
        }
        if (storedManifestAssetIdRef.current !== currentPlaybackAsset.assetId) {
          await putAssetManifest(currentPlaybackAsset);
          storedManifestAssetIdRef.current = currentPlaybackAsset.assetId;
        }
        const serverNowMs = getRoomPlaybackClockNowMs();
        const audioContextState = roomAudioOutput.getSharedAudioContext()?.state ?? null;

        if (!runtime.audioUnlocked || audioContextState !== "running") {
          if (cancelled || generation !== playbackGenerationRef.current) {
            return;
          }
          setSnapshot({
            state: "awaiting-unlock",
            bufferedMs: 0,
            ownedUnitCount: 0,
            totalUnitCount: currentPlaybackAsset.unitCount,
            audioContextState,
            lastError: null
          });
          return;
        }
        engineRef.current ??= new SegmentedOpusEngine();
        const result = await engineRef.current.sync({
          manifest: currentPlaybackAsset,
          playback: currentPlayback,
          serverNowMs,
          volume: runtime.volume,
          getUnit: (unitIndex) => getAssetUnit(currentPlaybackAsset.assetId, unitIndex)
        });
        const sourceHealth = engineRef.current?.getSourceHealth();
        if (cancelled || generation !== playbackGenerationRef.current) {
          return;
        }
        setSnapshot({
          state: result.state,
          playbackIdentity: currentPlaybackIdentity,
          bufferedMs: result.bufferedUnits * currentPlaybackAsset.segmentDurationMs,
          ownedUnitCount: result.bufferedUnits,
          totalUnitCount: currentPlaybackAsset.unitCount,
          audioContextState,
          lastError: null,
          sourceHealth: sourceHealth?.state,
          sourceEnergy: sourceHealth?.energy,
          decodedPeak: sourceHealth?.decodedPeak,
          decodedRms: sourceHealth?.decodedRms,
          maxSampleDelta: sourceHealth?.maxSampleDelta,
          underrunCount: sourceHealth?.underrunCount,
          lastUnderrunAt: sourceHealth?.lastUnderrunAt,
          lastDecodeError: sourceHealth?.lastDecodeError
        });
      } catch (error) {
        const failedEngine = engineRef.current;
        engineRef.current = null;
        storedManifestAssetIdRef.current = null;
        failedEngine?.destroy();
        const runtime = runtimeRef.current;
        const totalUnitCount = runtime.currentTrack?.playbackAsset?.unitCount ?? 0;
        const audioContextState = roomAudioOutput.getSharedAudioContext()?.state ?? null;
        const failedPlaybackIdentity = resolveSegmentedPlaybackIdentity({
          playback: runtime.roomSnapshot?.room.playback,
          playbackAssetId: runtime.currentTrack?.playbackAsset?.assetId
        });
        if (!cancelled && generation === playbackGenerationRef.current) {
          setSnapshot((current) => buildSegmentedPlaybackFailureSnapshot({
            current,
            totalUnitCount,
            audioContextState,
            error,
            playbackIdentity: failedPlaybackIdentity
          }));
        }
      } finally {
        tickingRef.current = false;
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), 100);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      releaseEngine();
      setSnapshot({ ...idleSnapshot, playbackIdentity: null });
    };
  }, [
    roomId,
    peerId,
    isCurrentSource,
    releaseEngine
  ]);

  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => () => engineRef.current?.destroy(), []);

  if (snapshot.playbackIdentity === playbackIdentity) {
    return snapshot;
  }

  return {
    ...idleSnapshot,
    playbackIdentity,
    totalUnitCount: input.currentTrack?.playbackAsset?.unitCount ?? 0,
    audioContextState: roomAudioOutput.getSharedAudioContext()?.state ?? null
  };
}

export function resolveSegmentedPlaybackIdentity(input: {
  playback:
    | Pick<
        RoomSnapshot["room"]["playback"],
        "currentTrackId" | "mediaEpoch" | "playbackRevision" | "startAt"
      >
    | null
    | undefined;
  playbackAssetId: string | null | undefined;
}) {
  if (!input.playbackAssetId || !input.playback?.currentTrackId) {
    return null;
  }

  return [
    input.playbackAssetId,
    input.playback.currentTrackId,
    input.playback.mediaEpoch,
    input.playback.startAt ?? "none",
    input.playback.playbackRevision
  ].join(":");
}

/**
 * Identifies the local media source, excluding timeline-only changes such as
 * pause/resume and seek. Those changes are handled inside the existing engine.
 */
export function resolveSegmentedPlaybackEngineIdentity(input: {
  playback:
    | Pick<
        RoomSnapshot["room"]["playback"],
        "currentTrackId" | "mediaEpoch" | "playbackRevision" | "startAt"
      >
    | null
    | undefined;
  playbackAssetId: string | null | undefined;
}) {
  if (!input.playbackAssetId || !input.playback?.currentTrackId) {
    return null;
  }

  return [
    input.playbackAssetId,
    input.playback.currentTrackId,
    input.playback.mediaEpoch
  ].join(":");
}

export function hasActiveSegmentedPlayback(input: {
  isCurrentSource: boolean;
  currentTrackId: string | null | undefined;
  hasPlaybackAsset: boolean;
}) {
  return input.isCurrentSource && Boolean(input.currentTrackId) && input.hasPlaybackAsset;
}

function formatSegmentedPlaybackError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "分段音频读取或解码失败";
}

export function buildSegmentedPlaybackFailureSnapshot(input: {
  current: SegmentedPlaybackSnapshot;
  totalUnitCount: number;
  audioContextState: AudioContextState | null;
  error: unknown;
  playbackIdentity?: string | null;
}): SegmentedPlaybackSnapshot {
  return {
    ...input.current,
    ...(input.playbackIdentity !== undefined
      ? { playbackIdentity: input.playbackIdentity }
      : {}),
    state: input.audioContextState === "running" ? "buffering" : "awaiting-unlock",
    totalUnitCount: input.totalUnitCount,
    audioContextState: input.audioContextState,
    lastError: formatSegmentedPlaybackError(input.error)
  };
}
