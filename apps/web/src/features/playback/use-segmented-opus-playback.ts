"use client";

import { useEffect, useRef, useState } from "react";
import {
  unitIndexesToRanges,
  type AssetAvailabilityAnnouncement,
  type RoomSnapshot,
  type TrackMeta
} from "@music-room/shared";
import {
  getAssetUnit,
  getAssetUnitIndexes,
  putAssetManifest
} from "@/lib/indexeddb";
import { getRoomPlaybackClockNowMs } from "./room-playback-clock";
import {
  contiguousPlaybackBufferMs,
  playbackUnitIndexAt,
  resolvePlaybackUnitOrder
} from "./playback-segment-scheduler";
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
  volume: number;
  audioUnlocked: boolean;
  availabilityByAsset: Record<string, Record<string, AssetAvailabilityAnnouncement>>;
  requestAssetUnits: (input: {
    assetId: string;
    assetKind: "playback" | "original";
    unitIndexes: number[];
    totalUnits: number;
    priority: "critical" | "playback-fill" | "bulk";
    preferredPeerId?: string | null;
    maxReplicas?: number;
  }) => boolean;
  emitAssetAvailability: (announcement: AssetAvailabilityAnnouncement) => void;
}) {
  const { roomSnapshot, currentTrack, peerId, audioUnlocked, volume } = input;
  const engineRef = useRef<SegmentedOpusEngine | null>(null);
  const runtimeRef = useRef(input);
  runtimeRef.current = input;
  const tickingRef = useRef(false);
  const announcedSignatureRef = useRef("");
  const activePlaybackAssetIdRef = useRef<string | null>(null);
  const storedManifestAssetIdRef = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<SegmentedPlaybackSnapshot>(idleSnapshot);
  const playbackAssetId = currentTrack?.playbackAsset?.assetId ?? null;
  const roomId = roomSnapshot?.room.id ?? null;
  const trackId = currentTrack?.id ?? null;

  useEffect(() => {
    const initialRuntime = runtimeRef.current;
    const playbackAsset = initialRuntime.currentTrack?.playbackAsset;
    const playback = initialRuntime.roomSnapshot?.room.playback;
    if (!playbackAsset || !playback || playback.currentTrackId !== initialRuntime.currentTrack?.id) {
      engineRef.current?.destroy();
      engineRef.current = null;
      activePlaybackAssetIdRef.current = null;
      storedManifestAssetIdRef.current = null;
      announcedSignatureRef.current = "";
      setSnapshot(idleSnapshot);
      return;
    }
    if (activePlaybackAssetIdRef.current !== playbackAsset.assetId) {
      activePlaybackAssetIdRef.current = playbackAsset.assetId;
      storedManifestAssetIdRef.current = null;
      announcedSignatureRef.current = "";
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
        ) {
          return;
        }
        if (storedManifestAssetIdRef.current !== currentPlaybackAsset.assetId) {
          await putAssetManifest(currentPlaybackAsset);
          storedManifestAssetIdRef.current = currentPlaybackAsset.assetId;
        }
        const owned = await getAssetUnitIndexes(currentPlaybackAsset.assetId);
        const serverNowMs = getRoomPlaybackClockNowMs();
        const startAtMs = currentPlayback.startAt ? Date.parse(currentPlayback.startAt) : serverNowMs;
        const positionMs = Math.min(
          currentPlaybackAsset.durationMs,
          currentPlayback.positionMs + (currentPlayback.status === "playing" ? Math.max(0, serverNowMs - startAtMs) : 0)
        );
        const bufferMs = contiguousPlaybackBufferMs({
          manifest: currentPlaybackAsset,
          positionMs,
          ownedUnitIndexes: owned
        });
        const audioContextState = roomAudioOutput.getSharedAudioContext()?.state ?? null;

        const wanted = resolvePlaybackUnitOrder({
          manifest: currentPlaybackAsset,
          positionMs,
          ownedUnitIndexes: owned,
          requestLimit: 16
        });
        const providers = Object.values(runtime.availabilityByAsset[currentPlaybackAsset.assetId] ?? {})
          .filter((provider) => provider.ownerPeerId !== runtime.peerId);
        const playbackUnavailable =
          wanted.length > 0 && providers.length === 0 && bufferMs < 6_000;
        if (wanted.length > 0) {
          if (!playbackUnavailable) {
            const currentUnit = playbackUnitIndexAt(currentPlaybackAsset, positionMs);
            const criticalEnd = currentUnit + Math.ceil(10_000 / currentPlaybackAsset.segmentDurationMs);
            const criticalWanted = bufferMs < 10_000
              ? wanted.filter((unitIndex) => unitIndex <= criticalEnd)
              : [];
            const fillWanted = wanted.filter((unitIndex) => !criticalWanted.includes(unitIndex));
            if (criticalWanted.length > 0) {
              runtime.requestAssetUnits({
                assetId: currentPlaybackAsset.assetId,
                assetKind: "playback",
                unitIndexes: criticalWanted,
                totalUnits: currentPlaybackAsset.unitCount,
                priority: "critical",
                preferredPeerId: providers[0]?.ownerPeerId ?? null,
                maxReplicas: 2
              });
            }
            if (fillWanted.length > 0) {
              runtime.requestAssetUnits({
                assetId: currentPlaybackAsset.assetId,
                assetKind: "playback",
                unitIndexes: fillWanted,
                totalUnits: currentPlaybackAsset.unitCount,
                priority: "playback-fill",
                preferredPeerId: providers[0]?.ownerPeerId ?? null,
                maxReplicas: 1
              });
            }
          }
        }

        const ranges = unitIndexesToRanges(owned, currentPlaybackAsset.unitCount);
        const signature = `${currentPlaybackAsset.assetId}:${JSON.stringify(ranges)}`;
        if (signature !== announcedSignatureRef.current && ranges.length > 0) {
          announcedSignatureRef.current = signature;
          runtime.emitAssetAvailability({
            protocolVersion: 4,
            roomId: runtime.roomSnapshot!.room.id,
            assetId: currentPlaybackAsset.assetId,
            assetKind: "playback",
            ownerPeerId: runtime.peerId,
            nickname:
              runtime.roomSnapshot!.room.members.find((member) => member.peerId === runtime.peerId)?.nickname ?? "Member",
            totalUnits: currentPlaybackAsset.unitCount,
            availableRanges: ranges,
            complete: owned.length === currentPlaybackAsset.unitCount,
            source: "local_cache",
            announcedAt: new Date().toISOString()
          });
        }

        if (playbackUnavailable) {
          setSnapshot({
            state: "unavailable",
            bufferedMs: bufferMs,
            ownedUnitCount: owned.length,
            totalUnitCount: currentPlaybackAsset.unitCount,
            audioContextState,
            lastError: null
          });
          return;
        }

        if (!runtime.audioUnlocked || audioContextState !== "running") {
          setSnapshot({
            state: "awaiting-unlock",
            bufferedMs: bufferMs,
            ownedUnitCount: owned.length,
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
        setSnapshot({
          state: result.state,
          bufferedMs: bufferMs,
          ownedUnitCount: owned.length,
          totalUnitCount: currentPlaybackAsset.unitCount,
          audioContextState,
          lastError: null
        });
      } catch (error) {
        const failedEngine = engineRef.current;
        engineRef.current = null;
        storedManifestAssetIdRef.current = null;
        failedEngine?.destroy();
        const runtime = runtimeRef.current;
        const totalUnitCount = runtime.currentTrack?.playbackAsset?.unitCount ?? 0;
        const audioContextState = roomAudioOutput.getSharedAudioContext()?.state ?? null;
        setSnapshot((current) => buildSegmentedPlaybackFailureSnapshot({
          current,
          totalUnitCount,
          audioContextState,
          error
        }));
      } finally {
        tickingRef.current = false;
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), 250);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    audioUnlocked,
    playbackAssetId,
    roomId,
    trackId,
    peerId,
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
