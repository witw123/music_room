"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RoomSnapshot, TrackMeta } from "@music-room/shared";
import { createSHA256 } from "hash-wasm";
import {
  getAssetUnitIndexes,
  getAssetUnits,
  getCachedLibraryTrack,
  linkTrackAssets,
  listManualCacheTasksForRoom,
  putAssetManifest,
  upsertCachedLibraryTrack,
  type AudioAssetUnitRecord
} from "@/lib/indexeddb";
import type { ManualCacheTaskPatch } from "@/features/upload/upload-ui-state";

const cachePollIntervalMs = 750;
const requestBatchSize = 8;

type OriginalAssetRequest = {
  assetId: string;
  assetKind: "original";
  unitIndexes: number[];
  totalUnits: number;
  priority: "bulk";
  maxReplicas: 1;
};

type RuntimeInput = {
  roomSnapshot: RoomSnapshot | null;
  requestAssetUnits: (request: OriginalAssetRequest) => boolean;
  cancelAssetRequests: (assetId: string) => void;
  updateManualCacheTask: (trackId: string, patch: ManualCacheTaskPatch) => void;
  refreshCacheLibrary: () => Promise<void>;
  setStatusMessage: (message: string) => void;
};

export async function assembleOriginalAsset(input: {
  track: TrackMeta;
  units: AudioAssetUnitRecord[];
}) {
  const manifest = input.track.originalAsset;
  if (!manifest) {
    throw new Error("Track does not have an original asset manifest.");
  }
  if (input.units.length !== manifest.unitCount) {
    throw new Error("Original asset is incomplete.");
  }
  const ordered = [...input.units].sort((left, right) => left.unitIndex - right.unitIndex);
  const hasher = await createSHA256();
  hasher.init();
  let sizeBytes = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const unit = ordered[index]!;
    if (unit.assetId !== manifest.assetId || unit.unitIndex !== index) {
      throw new Error("Original asset units are not contiguous.");
    }
    const bytes = new Uint8Array(unit.payload);
    hasher.update(bytes);
    sizeBytes += bytes.byteLength;
  }
  if (sizeBytes !== manifest.sizeBytes) {
    throw new Error("Original asset size does not match its manifest.");
  }
  if (hasher.digest("hex") !== manifest.fileHash) {
    throw new Error("Original asset failed whole-file verification.");
  }
  return new Blob(ordered.map((unit) => unit.payload), {
    type: manifest.mimeType || input.track.mimeType || "application/octet-stream"
  });
}

export function useRoomOriginalAssetCache(input: RuntimeInput) {
  const runtimeRef = useRef(input);
  runtimeRef.current = input;
  const activeTrackIdsRef = useRef(new Set<string>());
  const assemblingTrackIdsRef = useRef(new Set<string>());
  const completedAssetIdsRef = useRef(new Set<string>());
  const tickingRef = useRef(false);

  const finishTrack = useCallback(async (track: TrackMeta, units: AudioAssetUnitRecord[]) => {
    const runtime = runtimeRef.current;
    const asset = track.originalAsset!;
    if (completedAssetIdsRef.current.has(asset.assetId)) return;
    if (assemblingTrackIdsRef.current.has(track.id)) return;
    assemblingTrackIdsRef.current.add(track.id);
    const isManual = activeTrackIdsRef.current.has(track.id);
    if (isManual) {
      runtime.updateManualCacheTask(track.id, {
        status: "assembling",
        completedChunks: asset.unitCount,
        totalChunks: asset.unitCount,
        pendingChunkCount: 0,
        blockedReason: null,
        lastError: null
      });
    }
    try {
      const existing = await getCachedLibraryTrack(asset.fileHash);
      const file = existing?.file ?? await assembleOriginalAsset({ track, units });
      await upsertCachedLibraryTrack({
          fileHash: asset.fileHash,
          title: track.title,
          artist: track.artist,
          mimeType: asset.mimeType || track.mimeType || "application/octet-stream",
          durationMs: track.durationMs,
          sizeBytes: asset.sizeBytes,
          file,
          sourceTrackIds: [...(existing?.sourceTrackIds ?? []), track.id],
          sourceRoomIds: [
            ...(existing?.sourceRoomIds ?? []),
            ...(runtime.roomSnapshot ? [runtime.roomSnapshot.room.id] : [])
          ],
          lastSourceTrackId: track.id,
          lastSourceRoomId: runtime.roomSnapshot?.room.id ?? null,
          lastOwnerNickname: track.ownerNickname
        });
      if (track.playbackAsset) {
        await linkTrackAssets({
          trackId: track.id,
          originalAssetId: asset.assetId,
          playbackAssetId: track.playbackAsset.assetId
        });
      }
      await runtime.refreshCacheLibrary();
      completedAssetIdsRef.current.add(asset.assetId);
      if (isManual) {
        runtime.updateManualCacheTask(track.id, {
          status: "ready",
          completedChunks: asset.unitCount,
          totalChunks: asset.unitCount,
          pendingChunkCount: 0,
          blockedReason: null,
          errorMessage: null,
          lastError: null
        });
        runtime.setStatusMessage(`《${track.title}》已完整保存到本机缓存库。`);
      }
      activeTrackIdsRef.current.delete(track.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "源文件组装失败。";
      if (isManual) {
        runtime.updateManualCacheTask(track.id, {
          status: message.includes("verification") || message.includes("match")
            ? "failed-integrity"
            : "failed",
          errorMessage: message,
          lastError: message
        });
        runtime.setStatusMessage(`《${track.title}》缓存失败：${message}`);
      }
      activeTrackIdsRef.current.delete(track.id);
    } finally {
      assemblingTrackIdsRef.current.delete(track.id);
    }
  }, []);

  const tick = useCallback(async () => {
    if (tickingRef.current) return;
    tickingRef.current = true;
    try {
      const runtime = runtimeRef.current;
      const room = runtime.roomSnapshot;
      if (!room) return;
      const candidates = new Set(activeTrackIdsRef.current);
      const currentTrackId = room.room.playback.currentTrackId;
      if (currentTrackId) candidates.add(currentTrackId);

      for (const trackId of candidates) {
        const track = room.tracks.find((candidate) => candidate.id === trackId);
        const asset = track?.originalAsset;
        if (!track || !asset) {
          activeTrackIdsRef.current.delete(trackId);
          continue;
        }
        await putAssetManifest(asset);
        const owned = await getAssetUnitIndexes(asset.assetId);
        if (owned.length === asset.unitCount) {
          const units = await getAssetUnits(
            asset.assetId,
            Array.from({ length: asset.unitCount }, (_, index) => index)
          );
          await finishTrack(track, units);
          continue;
        }
        if (!activeTrackIdsRef.current.has(trackId)) continue;

        const ownedSet = new Set(owned);
        const missing = Array.from({ length: asset.unitCount }, (_, index) => index)
          .filter((index) => !ownedSet.has(index));
        const requestedIndexes = missing.slice(0, requestBatchSize);
        const requested = runtime.requestAssetUnits({
          assetId: asset.assetId,
          assetKind: "original",
          unitIndexes: requestedIndexes,
          totalUnits: asset.unitCount,
          priority: "bulk",
          maxReplicas: 1
        });
        runtime.updateManualCacheTask(trackId, {
          status: requested ? "downloading" : "blocked",
          mode: "manual",
          completedChunks: owned.length,
          totalChunks: asset.unitCount,
          mimeType: asset.mimeType,
          manifestSource: asset.assetId,
          blockedReason: requested ? null : "当前没有可用的成员传输通道",
          requestableChunkCount: missing.length,
          pendingChunkCount: missing.length,
          lastRequestedChunks: requestedIndexes,
          lastPieceReceivedAt: owned.length > 0 ? new Date().toISOString() : null,
          lastError: null,
          integrityMode: "strong"
        });
      }
    } finally {
      tickingRef.current = false;
    }
  }, [finishTrack]);

  useEffect(() => {
    const roomId = input.roomSnapshot?.room.id;
    if (!roomId) {
      activeTrackIdsRef.current.clear();
      return;
    }
    let cancelled = false;
    void listManualCacheTasksForRoom(roomId).then((tasks) => {
      if (cancelled) return;
      const tracks = runtimeRef.current.roomSnapshot?.tracks ?? [];
      for (const task of tasks) {
        if (
          (task.status === "queued" || task.status === "downloading" || task.status === "blocked" || task.status === "assembling") &&
          tracks.some((track) => track.id === task.trackId && track.originalAsset)
        ) {
          activeTrackIdsRef.current.add(task.trackId);
        }
      }
      void tick();
    });
    const intervalId = window.setInterval(() => void tick(), cachePollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [input.roomSnapshot?.room.id, tick]);

  const startManualCacheDownload = useCallback(async (trackId: string) => {
    const runtime = runtimeRef.current;
    const track = runtime.roomSnapshot?.tracks.find((candidate) => candidate.id === trackId);
    const asset = track?.originalAsset;
    if (!track || !asset) {
      runtime.setStatusMessage("该曲目没有可缓存的成员端源文件资产。");
      return;
    }
    await putAssetManifest(asset);
    completedAssetIdsRef.current.delete(asset.assetId);
    activeTrackIdsRef.current.add(trackId);
    runtime.updateManualCacheTask(trackId, {
      status: "queued",
      mode: "manual",
      fileHash: asset.fileHash,
      totalChunks: asset.unitCount,
      mimeType: asset.mimeType,
      manifestSource: asset.assetId,
      integrityMode: "strong",
      errorMessage: null,
      blockedReason: null,
      lastError: null
    });
    runtime.setStatusMessage(`正在从房间成员缓存《${track.title}》。`);
    await tick();
  }, [tick]);

  const pauseManualCacheDownload = useCallback((trackId: string) => {
    const runtime = runtimeRef.current;
    const track = runtime.roomSnapshot?.tracks.find((candidate) => candidate.id === trackId);
    const assetId = track?.originalAsset?.assetId;
    activeTrackIdsRef.current.delete(trackId);
    if (assetId) runtime.cancelAssetRequests(assetId);
    runtime.updateManualCacheTask(trackId, {
      status: "paused",
      blockedReason: null,
      lastRequestedChunks: []
    });
  }, []);

  return { startManualCacheDownload, pauseManualCacheDownload };
}
