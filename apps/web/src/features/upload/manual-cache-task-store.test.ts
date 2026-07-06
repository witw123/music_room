import { describe, expect, it } from "vitest";
import {
  buildManualCacheTaskRecord,
  buildNextManualCacheTask,
  resolveManualCacheTaskStateUpdate,
  resolveStalePlaybackDemandTaskIds,
  shouldHydrateCacheTaskPieceIndexes
} from "./manual-cache-task-store";

describe("manual cache task store helpers", () => {
  it("builds task state from defaults and patches", () => {
    const task = buildNextManualCacheTask({
      trackId: "track_1",
      existing: null,
      track: {
        fileHash: "hash_1",
        mimeType: "audio/flac"
      },
      patch: {
        status: "queued",
        mode: "manual",
        completedChunks: 1,
        totalChunks: 4
      },
      updatedAt: "2026-07-06T00:00:00.000Z"
    });

    expect(task).toMatchObject({
      trackId: "track_1",
      status: "queued",
      mode: "manual",
      fileHash: "hash_1",
      completedChunks: 1,
      totalChunks: 4,
      mimeType: "audio/flac",
      updatedAt: "2026-07-06T00:00:00.000Z"
    });
  });

  it("keeps only current playback-demand task ids active", () => {
    expect(
      resolveStalePlaybackDemandTaskIds({
        currentPlaybackTrackId: "track_current",
        currentTasks: {
          track_manual: {
            trackId: "track_manual",
            status: "downloading",
            mode: "manual",
            fileHash: "hash_manual",
            updatedAt: "2026-07-06T00:00:00.000Z",
            errorMessage: null,
            completedChunks: 0,
            totalChunks: 0,
            mimeType: null,
            manifestSource: null,
            blockedReason: null,
            integrityMode: null,
            providerPeerIds: [],
            connectedProviderPeerIds: [],
            selectedProviderPeerId: null,
            requestableChunkCount: 0,
            pendingChunkCount: 0,
            lastRequestedChunks: [],
            lastPieceReceivedAt: null,
            lastError: null
          },
          track_old: {
            trackId: "track_old",
            status: "downloading",
            mode: "playback-demand",
            fileHash: "hash_old",
            updatedAt: "2026-07-06T00:00:00.000Z",
            errorMessage: null,
            completedChunks: 0,
            totalChunks: 0,
            mimeType: null,
            manifestSource: null,
            blockedReason: null,
            integrityMode: null,
            providerPeerIds: [],
            connectedProviderPeerIds: [],
            selectedProviderPeerId: null,
            requestableChunkCount: 0,
            pendingChunkCount: 0,
            lastRequestedChunks: [],
            lastPieceReceivedAt: null,
            lastError: null
          }
        }
      })
    ).toEqual(["track_old"]);
  });

  it("hydrates piece indexes only for active manual cache statuses", () => {
    expect(shouldHydrateCacheTaskPieceIndexes({ mode: "manual", status: "queued" })).toBe(true);
    expect(
      shouldHydrateCacheTaskPieceIndexes({ mode: "playback-demand", status: "blocked" })
    ).toBe(true);
    expect(shouldHydrateCacheTaskPieceIndexes({ mode: "auto-played", status: "queued" })).toBe(false);
    expect(shouldHydrateCacheTaskPieceIndexes({ mode: "manual", status: "ready" })).toBe(false);
  });

  it("resolves task state updates and persistence records", () => {
    const update = resolveManualCacheTaskStateUpdate({
      currentTasks: {},
      trackId: "track_1",
      roomTracks: [
        {
          id: "track_1",
          fileHash: "hash_1",
          mimeType: "audio/flac"
        }
      ],
      patch: {
        status: "downloading",
        completedChunks: 2,
        totalChunks: 4
      },
      updatedAt: "2026-07-06T00:00:00.000Z"
    });

    expect(update.nextTask).toMatchObject({
      trackId: "track_1",
      fileHash: "hash_1",
      status: "downloading",
      completedChunks: 2,
      totalChunks: 4
    });
    expect(update.nextTasks.track_1).toBe(update.nextTask);
    expect(buildManualCacheTaskRecord({ roomId: "room_1", task: update.nextTask! })).toMatchObject({
      roomId: "room_1",
      trackId: "track_1",
      fileHash: "hash_1",
      status: "downloading",
      completedChunks: 2,
      totalChunks: 4,
      updatedAt: "2026-07-06T00:00:00.000Z"
    });
  });
});
