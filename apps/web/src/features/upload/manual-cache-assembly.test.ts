import { describe, expect, it, vi } from "vitest";
import { assembleManualCacheTrackFromPieces } from "./manual-cache-assembly";

describe("assembleManualCacheTrackFromPieces", () => {
  const roomTrack = {
    id: "track_1",
    title: "Cached",
    artist: "Artist",
    album: null,
    durationMs: 120_000,
    bitrate: null,
    sizeBytes: 4096,
    codec: "flac",
    mimeType: "audio/flac",
    fileHash: "hash_1",
    artworkUrl: null,
    ownerSessionId: "user_1",
    ownerNickname: "Host",
    sourceType: "local_upload" as const,
    relayManifest: null,
    pieceManifest: {
      totalChunks: 2,
      chunkSize: 1024,
      pieceMimeType: "audio/flac"
    }
  };

  it("persists assembled tracks and marks cache tasks ready", async () => {
    const taskUpdates: Array<{ trackId: string; patch: unknown }> = [];
    const persistedTracks: string[] = [];
    const deletedPieces: string[] = [];
    const announcedTracks: string[] = [];
    const consumedPieces: string[] = [];
    const statusMessages: string[] = [];
    const assembledFile = new File(["assembled"], "assembled.flac", { type: "audio/flac" });

    await assembleManualCacheTrackFromPieces({
      manualTrackCachingEnabled: true,
      assemblingTrackIds: new Set(),
      trackId: "track_1",
      mimeType: "audio/flac",
      totalChunks: 2,
      roomId: "room_1",
      roomTracks: [roomTrack],
      peerId: "peer_1",
      localCacheOwnerKey: "local",
      updateManualCacheTask: (trackId, patch) => {
        taskUpdates.push({ trackId, patch });
      },
      getCachedPiecesForTrack: async () => [
        { chunkIndex: 0, payload: new ArrayBuffer(1) },
        { chunkIndex: 1, payload: new ArrayBuffer(1) }
      ],
      assembleTrackFileFromPieces: async () => ({ file: assembledFile }),
      persistTrackIntoLibrary: async ({ track }) => {
        persistedTracks.push(track.id);
      },
      deleteCachedPiecesForTrack: async (trackId) => {
        deletedPieces.push(trackId);
      },
      onCachedPiecesConsumed: (trackId) => {
        consumedPieces.push(trackId);
      },
      announceRoomTrackAvailability: (trackId) => {
        announcedTracks.push(trackId);
      },
      setStatusMessage: (message) => {
        statusMessages.push(message);
      }
    });

    expect(taskUpdates.map(({ patch }) => patch)).toEqual([
      expect.objectContaining({ status: "assembling", completedChunks: 2 }),
      expect.objectContaining({ status: "ready", completedChunks: 2 })
    ]);
    expect(persistedTracks).toEqual(["track_1"]);
    expect(deletedPieces).toEqual(["track_1"]);
    expect(consumedPieces).toEqual(["track_1"]);
    expect(announcedTracks).toEqual(["track_1"]);
    expect(statusMessages).toEqual(["已缓存《Cached》。"]);
  });

  it("retains cached pieces after assembly when the active playback window may still read them", async () => {
    const taskUpdates: Array<{ trackId: string; patch: unknown }> = [];
    const deletedPieces: string[] = [];
    const consumedPieces: string[] = [];
    const assembledFile = new File(["assembled"], "assembled.flac", { type: "audio/flac" });

    await assembleManualCacheTrackFromPieces({
      manualTrackCachingEnabled: true,
      assemblingTrackIds: new Set(),
      trackId: "track_1",
      mimeType: "audio/flac",
      totalChunks: 2,
      roomId: "room_1",
      roomTracks: [roomTrack],
      peerId: "peer_1",
      localCacheOwnerKey: "local",
      retainCachedPiecesAfterAssembly: true,
      updateManualCacheTask: (trackId, patch) => {
        taskUpdates.push({ trackId, patch });
      },
      getCachedPiecesForTrack: async () => [
        { chunkIndex: 0, payload: new ArrayBuffer(1) },
        { chunkIndex: 1, payload: new ArrayBuffer(1) }
      ],
      assembleTrackFileFromPieces: async () => ({ file: assembledFile }),
      persistTrackIntoLibrary: async () => undefined,
      deleteCachedPiecesForTrack: async (trackId) => {
        deletedPieces.push(trackId);
      },
      onCachedPiecesConsumed: (trackId) => {
        consumedPieces.push(trackId);
      },
      announceRoomTrackAvailability: () => undefined,
      setStatusMessage: () => undefined
    });

    expect(taskUpdates.map(({ patch }) => patch)).toEqual([
      expect.objectContaining({ status: "assembling", completedChunks: 2 }),
      expect.objectContaining({ status: "ready", completedChunks: 2 })
    ]);
    expect(deletedPieces).toEqual([]);
    expect(consumedPieces).toEqual([]);
  });

  it("returns incomplete assemblies to downloading progress", async () => {
    const updateManualCacheTask = vi.fn();

    await assembleManualCacheTrackFromPieces({
      manualTrackCachingEnabled: true,
      assemblingTrackIds: new Set(),
      trackId: "track_1",
      mimeType: "audio/flac",
      totalChunks: 2,
      roomId: "room_1",
      roomTracks: [roomTrack],
      peerId: "peer_1",
      localCacheOwnerKey: "local",
      updateManualCacheTask,
      getCachedPiecesForTrack: async () => [{ chunkIndex: 0, payload: new ArrayBuffer(1) }],
      assembleTrackFileFromPieces: async () => {
        throw new Error("should not assemble incomplete pieces");
      },
      persistTrackIntoLibrary: async () => {
        throw new Error("should not persist incomplete pieces");
      },
      deleteCachedPiecesForTrack: async () => undefined,
      onCachedPiecesConsumed: () => undefined,
      announceRoomTrackAvailability: () => undefined,
      setStatusMessage: () => undefined
    });

    expect(updateManualCacheTask).toHaveBeenLastCalledWith(
      "track_1",
      expect.any(Function)
    );
    const patch = updateManualCacheTask.mock.calls.at(-1)?.[1]({
      status: "downloading"
    });
    expect(patch).toMatchObject({
      status: "downloading",
      completedChunks: 1,
      totalChunks: 2,
      mimeType: "audio/flac"
    });
  });

  it("marks assembly failures as retryable instead of leaving tasks stuck assembling", async () => {
    const updateManualCacheTask = vi.fn();
    const statusMessages: string[] = [];
    const assemblingTrackIds = new Set<string>();

    await assembleManualCacheTrackFromPieces({
      manualTrackCachingEnabled: true,
      assemblingTrackIds,
      trackId: "track_1",
      mimeType: "audio/flac",
      totalChunks: 2,
      roomId: "room_1",
      roomTracks: [roomTrack],
      peerId: "peer_1",
      localCacheOwnerKey: "local",
      updateManualCacheTask,
      getCachedPiecesForTrack: async () => [
        { chunkIndex: 0, payload: new ArrayBuffer(1) },
        { chunkIndex: 1, payload: new ArrayBuffer(1) }
      ],
      assembleTrackFileFromPieces: async () => {
        throw new Error("worker timed out");
      },
      persistTrackIntoLibrary: async () => undefined,
      deleteCachedPiecesForTrack: async () => undefined,
      onCachedPiecesConsumed: () => undefined,
      announceRoomTrackAvailability: () => undefined,
      setStatusMessage: (message) => {
        statusMessages.push(message);
      }
    });

    expect(assemblingTrackIds.has("track_1")).toBe(false);
    expect(updateManualCacheTask).toHaveBeenLastCalledWith(
      "track_1",
      expect.any(Function)
    );
    const patch = updateManualCacheTask.mock.calls.at(-1)?.[1]({
      status: "assembling",
      completedChunks: 2,
      totalChunks: 2,
      mimeType: "audio/flac"
    });
    expect(patch).toMatchObject({
      status: "failed",
      errorMessage: "缓存组装失败：worker timed out",
      blockedReason: null,
      completedChunks: 2,
      totalChunks: 2,
      mimeType: "audio/flac",
      lastError: "assembly-failed"
    });
    expect(statusMessages).toEqual(["曲目 Cached 的缓存组装失败，可稍后重试。"]);
  });
});
