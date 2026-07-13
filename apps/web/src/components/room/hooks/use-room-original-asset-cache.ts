"use client";

import { useCallback } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import { getAssetUnitIndexes, putAssetManifest } from "@/lib/indexeddb";

export function useRoomOriginalAssetCache(input: {
  roomSnapshot: RoomSnapshot | null;
  requestAssetUnits: (request: {
    assetId: string;
    assetKind: "original";
    unitIndexes: number[];
    totalUnits: number;
    priority: "bulk";
    maxReplicas: 1;
  }) => boolean;
  cancelAssetRequests: (assetId: string) => void;
  setStatusMessage: (message: string) => void;
}) {
  const { roomSnapshot, requestAssetUnits, cancelAssetRequests, setStatusMessage } = input;
  const startManualCacheDownload = useCallback(async (trackId: string) => {
    const track = roomSnapshot?.tracks.find((candidate) => candidate.id === trackId);
    const asset = track?.originalAsset;
    if (!asset) {
      setStatusMessage("该曲目没有可缓存的成员端源文件资产。");
      return;
    }
    await putAssetManifest(asset);
    const owned = new Set(await getAssetUnitIndexes(asset.assetId));
    const missing = Array.from(
      { length: asset.unitCount },
      (_, unitIndex) => unitIndex
    ).filter((unitIndex) => !owned.has(unitIndex));
    if (missing.length === 0) {
      setStatusMessage("源文件已完整缓存在本机。");
      return;
    }
    const requested = requestAssetUnits({
      assetId: asset.assetId,
      assetKind: "original",
      unitIndexes: missing,
      totalUnits: asset.unitCount,
      priority: "bulk",
      maxReplicas: 1
    });
    setStatusMessage(
      requested ? "正在从房间成员缓存源文件。" : "当前没有成员可提供该源文件。"
    );
  }, [requestAssetUnits, roomSnapshot, setStatusMessage]);

  const pauseManualCacheDownload = useCallback((trackId: string) => {
    const assetId = roomSnapshot?.tracks.find(
      (candidate) => candidate.id === trackId
    )?.originalAsset?.assetId;
    if (assetId) {
      cancelAssetRequests(assetId);
      setStatusMessage("已暂停源文件缓存。");
    }
  }, [cancelAssetRequests, roomSnapshot, setStatusMessage]);

  return { startManualCacheDownload, pauseManualCacheDownload };
}
