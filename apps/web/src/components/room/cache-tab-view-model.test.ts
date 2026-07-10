import { describe, expect, it } from "vitest";
import type { TrackMeta } from "@music-room/shared";
import type { ManualCacheTask } from "@/features/upload/manual-cache-task-store";
import {
  deriveRoomCacheRow,
  filterRoomCacheRows,
  formatCachedAt,
  formatCacheSize,
  isCachedTrackInRoomLibrary
} from "./cache-tab-view-model";

const track: TrackMeta = {
  id: "track_1",
  title: "Night Drive",
  artist: "Aster",
  album: null,
  durationMs: 180_000,
  bitrate: 1_411_000,
  sizeBytes: 42 * 1024 * 1024,
  codec: "flac",
  mimeType: "audio/flac",
  fileHash: "hash_1",
  artworkUrl: null,
  ownerSessionId: "user_owner",
  ownerNickname: "Owner",
  sourceType: "local_upload",
  pieceManifest: {
    totalChunks: 10,
    chunkSize: 1024,
    pieceMimeType: "audio/flac"
  }
};

function createTask(patch: Partial<ManualCacheTask>): ManualCacheTask {
  return {
    trackId: track.id,
    status: "downloading",
    mode: "manual",
    fileHash: track.fileHash,
    updatedAt: "2026-07-10T00:00:00.000Z",
    errorMessage: null,
    completedChunks: 3,
    totalChunks: 10,
    mimeType: "audio/flac",
    manifestSource: "snapshot",
    blockedReason: null,
    integrityMode: "strong",
    providerPeerIds: [],
    connectedProviderPeerIds: [],
    selectedProviderPeerId: null,
    requestableChunkCount: 0,
    pendingChunkCount: 0,
    lastRequestedChunks: [],
    lastPieceReceivedAt: null,
    lastError: null,
    ...patch
  };
}

describe("cache tab view model", () => {
  it("keeps a download failure visible when providers are offline", () => {
    const row = deriveRoomCacheRow({
      track,
      task: createTask({ status: "failed", errorMessage: "连接中断" }),
      cachedTrack: null,
      remotePeerCount: 0,
      availableTotalChunks: 0
    });

    expect(row.status).toMatchObject({ key: "failed", label: "下载失败" });
    expect(row.detail).toBe("连接中断");
    expect(row.action).toBe("retry");
  });

  it("shows a ready task as finalizing until the cache library refreshes", () => {
    const row = deriveRoomCacheRow({
      track,
      task: createTask({ status: "ready", completedChunks: 10 }),
      cachedTrack: null,
      remotePeerCount: 1,
      availableTotalChunks: 10
    });

    expect(row.status).toMatchObject({ key: "finalizing", label: "正在完成" });
    expect(row.action).toBeNull();
  });

  it("uses readable progress when the total chunk count is unknown", () => {
    const row = deriveRoomCacheRow({
      track: { ...track, pieceManifest: null },
      task: createTask({ totalChunks: 0, completedChunks: 0 }),
      cachedTrack: null,
      remotePeerCount: 1,
      availableTotalChunks: 0
    });

    expect(row.progress.label).toBe("等待分片信息");
    expect(row.progress.percent).toBe(0);
  });

  it("translates an internal blocked reason into readable copy", () => {
    const row = deriveRoomCacheRow({
      track,
      task: createTask({ status: "blocked", blockedReason: "provider-not-connected" }),
      cachedTrack: null,
      remotePeerCount: 0,
      availableTotalChunks: 0
    });

    expect(row.detail).toBe("缓存来源正在重新连接。");
  });

  it("filters room rows by active, available and completed states", () => {
    const active = deriveRoomCacheRow({
      track,
      task: createTask({ status: "downloading" }),
      cachedTrack: null,
      remotePeerCount: 1,
      availableTotalChunks: 10
    });
    const available = deriveRoomCacheRow({
      track: { ...track, id: "track_2", fileHash: "hash_2" },
      task: null,
      cachedTrack: null,
      remotePeerCount: 1,
      availableTotalChunks: 10
    });
    const completed = deriveRoomCacheRow({
      track: { ...track, id: "track_3" },
      task: null,
      cachedTrack: { fileHash: track.fileHash },
      remotePeerCount: 0,
      availableTotalChunks: 0
    });

    expect(filterRoomCacheRows([active, available, completed], "active")).toEqual([active]);
    expect(filterRoomCacheRows([active, available, completed], "available")).toEqual([available]);
    expect(filterRoomCacheRows([active, available, completed], "completed")).toEqual([completed]);
  });

  it("formats cache metadata and detects an existing room library entry", () => {
    expect(formatCacheSize(0)).toBe("0 B");
    expect(formatCacheSize(1_572_864)).toBe("1.5 MB");
    expect(formatCachedAt("not-a-date")).toBe("时间未知");
    expect(
      isCachedTrackInRoomLibrary({
        fileHash: "hash_1",
        activeSessionUserId: "user_me",
        tracks: [{ ...track, ownerSessionId: "user_me" }]
      })
    ).toBe(true);
  });
});
