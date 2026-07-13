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
import {
  shouldPauseOriginalAutoCache,
  shouldStartOriginalAutoCache
} from "@/features/cache/original-auto-cache-policy";

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
  network: {
    throughputKbps: number | null;
    rttP95Ms: number | null;
    playbackChannelBufferedBytes: number;
    deadlineMissesLast30s: number;
  };
}) {
  const { roomSnapshot, currentTrack, peerId, audioUnlocked, volume } = input;
  const engineRef = useRef<SegmentedOpusEngine | null>(null);
  const runtimeRef = useRef(input);
  runtimeRef.current = input;
  const tickingRef = useRef(false);
  const announcedSignatureRef = useRef("");
  const announcedOriginalSignatureRef = useRef("");
  const activePlaybackAssetIdRef = useRef<string | null>(null);
  const availableStorageBytesRef = useRef<number | null>(null);
  const lastStorageEstimateAtRef = useRef(0);
  const originalAutoCacheActiveRef = useRef(false);
  const [state, setState] = useState<
    "idle" | "awaiting-unlock" | "buffering" | "live" | "paused" | "unavailable"
  >("idle");
  const [bufferedMs, setBufferedMs] = useState(0);
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
      originalAutoCacheActiveRef.current = false;
      announcedSignatureRef.current = "";
      announcedOriginalSignatureRef.current = "";
      setState("idle");
      setBufferedMs(0);
      return;
    }
    if (activePlaybackAssetIdRef.current !== playbackAsset.assetId) {
      activePlaybackAssetIdRef.current = playbackAsset.assetId;
      originalAutoCacheActiveRef.current = false;
      announcedSignatureRef.current = "";
      announcedOriginalSignatureRef.current = "";
    }
    let cancelled = false;
    engineRef.current ??= new SegmentedOpusEngine();
    const playbackManifestReady = putAssetManifest(playbackAsset);
    const initialOriginalAsset = initialRuntime.currentTrack?.originalAsset;
    const originalManifestReady = initialOriginalAsset
      ? putAssetManifest(initialOriginalAsset)
      : Promise.resolve();

    const tick = async () => {
      if (cancelled || tickingRef.current) {
        return;
      }
      tickingRef.current = true;
      try {
        await playbackManifestReady;
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
        const originalAsset = runtime.currentTrack?.originalAsset ?? initialOriginalAsset;
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
        setBufferedMs(bufferMs);

        const wanted = resolvePlaybackUnitOrder({
          manifest: currentPlaybackAsset,
          positionMs,
          ownedUnitIndexes: owned,
          requestLimit: 16
        });
        const providers = Object.values(runtime.availabilityByAsset[currentPlaybackAsset.assetId] ?? {})
          .filter((provider) => provider.ownerPeerId !== runtime.peerId);
        if (wanted.length > 0) {
          if (providers.length === 0 && bufferMs < 6_000) {
            setState("unavailable");
            return;
          }
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

        if (originalAsset) {
          if (originalAsset.assetId === initialOriginalAsset?.assetId) {
            await originalManifestReady;
          } else {
            await putAssetManifest(originalAsset);
          }
          if (Date.now() - lastStorageEstimateAtRef.current >= 10_000) {
            lastStorageEstimateAtRef.current = Date.now();
            const estimate = await navigator.storage?.estimate?.().catch(() => null);
            availableStorageBytesRef.current = estimate?.quota !== undefined && estimate.usage !== undefined
              ? Math.max(0, estimate.quota - estimate.usage)
              : null;
          }
          const localPlaybackComplete = owned.length === currentPlaybackAsset.unitCount ? 1 : 0;
          const remotePlaybackComplete = Object.values(
            runtime.availabilityByAsset[currentPlaybackAsset.assetId] ?? {}
          ).filter((provider) => provider.ownerPeerId !== runtime.peerId && provider.complete).length;
          const policyInput = {
            playbackBufferedMs: bufferMs,
            completePlaybackProviderCount: localPlaybackComplete + remotePlaybackComplete,
            throughputKbps: runtime.network.throughputKbps,
            rttP95Ms: runtime.network.rttP95Ms,
            playbackChannelBufferedBytes: runtime.network.playbackChannelBufferedBytes,
            deadlineMissesLast30s: runtime.network.deadlineMissesLast30s,
            availableStorageBytes: availableStorageBytesRef.current,
            originalSizeBytes: originalAsset.sizeBytes
          };
          if (originalAutoCacheActiveRef.current && shouldPauseOriginalAutoCache(policyInput)) {
            originalAutoCacheActiveRef.current = false;
          } else if (!originalAutoCacheActiveRef.current && shouldStartOriginalAutoCache(policyInput)) {
            originalAutoCacheActiveRef.current = true;
          }
          const originalOwned = await getAssetUnitIndexes(originalAsset.assetId);
          if (originalAutoCacheActiveRef.current && originalOwned.length < originalAsset.unitCount) {
            const originalWanted = Array.from(
              { length: Math.min(4, originalAsset.unitCount - originalOwned.length) },
              (_, offset) => {
                const ownedSet = new Set(originalOwned);
                let index = 0;
                let remaining = offset;
                while (index < originalAsset.unitCount) {
                  if (!ownedSet.has(index) && remaining-- === 0) return index;
                  index += 1;
                }
                return -1;
              }
            ).filter((index) => index >= 0);
            runtime.requestAssetUnits({
              assetId: originalAsset.assetId,
              assetKind: "original",
              unitIndexes: originalWanted,
              totalUnits: originalAsset.unitCount,
              priority: "bulk",
              preferredPeerId: Object.values(runtime.availabilityByAsset[originalAsset.assetId] ?? {})
                .find((provider) => provider.ownerPeerId !== runtime.peerId)?.ownerPeerId ?? null,
              maxReplicas: 1
            });
          }
          const originalRanges = unitIndexesToRanges(originalOwned, originalAsset.unitCount);
          const originalSignature = `${originalAsset.assetId}:${JSON.stringify(originalRanges)}`;
          if (originalRanges.length > 0 && originalSignature !== announcedOriginalSignatureRef.current) {
            announcedOriginalSignatureRef.current = originalSignature;
            runtime.emitAssetAvailability({
              protocolVersion: 4,
              roomId: runtime.roomSnapshot!.room.id,
              assetId: originalAsset.assetId,
              assetKind: "original",
              ownerPeerId: runtime.peerId,
              nickname:
                runtime.roomSnapshot!.room.members.find((member) => member.peerId === runtime.peerId)?.nickname ?? "Member",
              totalUnits: originalAsset.unitCount,
              availableRanges: originalRanges,
              complete: originalOwned.length === originalAsset.unitCount,
              source: "local_cache",
              announcedAt: new Date().toISOString()
            });
          }
        }

        if (!runtime.audioUnlocked) {
          setState("awaiting-unlock");
          return;
        }
        const result = await engineRef.current!.sync({
          manifest: currentPlaybackAsset,
          playback: currentPlayback,
          serverNowMs,
          volume: runtime.volume,
          getUnit: (unitIndex) => getAssetUnit(currentPlaybackAsset.assetId, unitIndex)
        });
        setState(result.state);
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

  return { state, bufferedMs };
}
