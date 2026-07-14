"use client";

import { useEffect, useRef, useState } from "react";
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
  bufferedMs: number;
  ownedUnitCount: number;
  totalUnitCount: number;
  audioContextState: AudioContextState | null;
  lastError: string | null;
  sourceHealth?: "source-ready" | "source-underrun" | "source-silent" | "source-ended";
  sourceEnergy?: number;
};

const idleSnapshot: SegmentedPlaybackSnapshot = {
  state: "idle",
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
  const { roomSnapshot, currentTrack, peerId, isCurrentSource, audioUnlocked, volume } = input;
  const engineRef = useRef<SegmentedOpusEngine | null>(null);
  const runtimeRef = useRef(input);
  runtimeRef.current = input;
  const tickingRef = useRef(false);
  const activePlaybackAssetIdRef = useRef<string | null>(null);
  const storedManifestAssetIdRef = useRef<string | null>(null);
  const playbackIdentityRef = useRef<string | null>(null);
  const playbackGenerationRef = useRef(0);
  const [snapshot, setSnapshot] = useState<SegmentedPlaybackSnapshot>(idleSnapshot);
  const playbackAssetId = currentTrack?.playbackAsset?.assetId ?? null;
  const roomId = roomSnapshot?.room.id ?? null;
  const trackId = currentTrack?.id ?? null;
  const playbackRuntimeKey = roomSnapshot?.room.playback
    ? [
        roomSnapshot.room.playback.currentTrackId,
        roomSnapshot.room.playback.mediaEpoch,
        roomSnapshot.room.playback.startAt,
        roomSnapshot.room.playback.status,
        roomSnapshot.room.playback.positionMs,
        roomSnapshot.room.playback.sourcePeerId
      ].join(":")
    : null;

  useEffect(() => {
    const initialRuntime = runtimeRef.current;
    const playbackAsset = initialRuntime.currentTrack?.playbackAsset;
    const playback = initialRuntime.roomSnapshot?.room.playback;
    const playbackIdentity = playbackAsset && playback
      ? [
          playbackAsset.assetId,
          playback.currentTrackId,
          playback.mediaEpoch,
          playback.startAt ?? "none",
          playback.playbackRevision
        ].join(":")
      : null;
    const generation = ++playbackGenerationRef.current;
    if (
      playbackIdentityRef.current !== null &&
      playbackIdentity !== playbackIdentityRef.current
    ) {
      engineRef.current?.destroy();
      engineRef.current = null;
      activePlaybackAssetIdRef.current = null;
      storedManifestAssetIdRef.current = null;
    }
    playbackIdentityRef.current = playbackIdentity;
    if (
      !playbackAsset ||
      !playback ||
      playback.currentTrackId !== initialRuntime.currentTrack?.id ||
      !initialRuntime.isCurrentSource
    ) {
      engineRef.current?.destroy();
      engineRef.current = null;
      activePlaybackAssetIdRef.current = null;
      storedManifestAssetIdRef.current = null;
      setSnapshot(idleSnapshot);
      return;
    }
    if (activePlaybackAssetIdRef.current !== playbackAsset.assetId) {
      activePlaybackAssetIdRef.current = playbackAsset.assetId;
      storedManifestAssetIdRef.current = null;
    }
    let cancelled = false;

    const tick = async () => {
      if (cancelled || tickingRef.current) {
        return;
      }
      tickingRef.current = true;
      try {
        const runtime = runtimeRef.current;
        const currentPlaybackAsset = runtime.currentTrack?.playbackAsset;
        const currentPlayback = runtime.roomSnapshot?.room.playback;
        if (
          cancelled ||
          !currentPlaybackAsset ||
          currentPlaybackAsset.assetId !== playbackAsset.assetId ||
          !currentPlayback ||
          currentPlayback.currentTrackId !== runtime.currentTrack?.id
          || !runtime.isCurrentSource
        ) {
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
          bufferedMs: result.bufferedUnits * currentPlaybackAsset.segmentDurationMs,
          ownedUnitCount: result.bufferedUnits,
          totalUnitCount: currentPlaybackAsset.unitCount,
          audioContextState,
          lastError: null,
          sourceHealth: sourceHealth?.state,
          sourceEnergy: sourceHealth?.energy
        });
      } catch (error) {
        const failedEngine = engineRef.current;
        engineRef.current = null;
        storedManifestAssetIdRef.current = null;
        failedEngine?.destroy();
        const runtime = runtimeRef.current;
        const totalUnitCount = runtime.currentTrack?.playbackAsset?.unitCount ?? 0;
        const audioContextState = roomAudioOutput.getSharedAudioContext()?.state ?? null;
        if (!cancelled && generation === playbackGenerationRef.current) {
          setSnapshot((current) => buildSegmentedPlaybackFailureSnapshot({
            current,
            totalUnitCount,
            audioContextState,
            error
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
    };
  }, [
    audioUnlocked,
    playbackAssetId,
    roomId,
    trackId,
    playbackRuntimeKey,
    peerId,
    isCurrentSource
  ]);

  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => () => engineRef.current?.destroy(), []);

  return snapshot;
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
}): SegmentedPlaybackSnapshot {
  return {
    ...input.current,
    state: input.audioContextState === "running" ? "buffering" : "awaiting-unlock",
    totalUnitCount: input.totalUnitCount,
    audioContextState: input.audioContextState,
    lastError: formatSegmentedPlaybackError(input.error)
  };
}
