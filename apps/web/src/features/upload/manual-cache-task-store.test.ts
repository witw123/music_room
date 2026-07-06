import { describe, expect, it } from "vitest";
import {
  applyManualCacheTaskDrop,
  applyManualCacheTaskUpdate,
  buildManualCacheTaskRecord,
  buildNextManualCacheTask,
  hydrateManualCacheTasksForRoom,
  resolveManualCacheTaskStateUpdate,
  resolveStalePlaybackDemandTaskIds,
  shouldHydrateCacheTaskPieceIndexes
} from "./manual-cache-task-store";
import type { ManualCacheTask, ManualCacheTaskUpsertRecord } from "./manual-cache-task-store";

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

  it("applies task updates through state and persistence boundaries", () => {
    let currentTasks: Record<string, ManualCacheTask> = {};
    const persistedRecords: ManualCacheTaskUpsertRecord[] = [];

    applyManualCacheTaskUpdate({
      trackId: "track_1",
      patch: {
        status: "downloading",
        completedChunks: 1,
        totalChunks: 4
      },
      roomId: "room_1",
      roomTracks: [
        {
          id: "track_1",
          fileHash: "hash_1",
          mimeType: "audio/flac"
        }
      ],
      updatedAt: "2026-07-06T00:00:00.000Z",
      setManualCacheTasks: (updater) => {
        currentTasks = updater(currentTasks);
      },
      upsertManualCacheTask: (record) => {
        persistedRecords.push(record);
      }
    });

    expect(currentTasks.track_1).toMatchObject({
      trackId: "track_1",
      status: "downloading",
      fileHash: "hash_1",
      completedChunks: 1,
      totalChunks: 4
    });
    expect(persistedRecords).toHaveLength(1);
    expect(persistedRecords[0]).toMatchObject({
      roomId: "room_1",
      trackId: "track_1",
      fileHash: "hash_1",
      status: "downloading"
    });
  });

  it("drops task state and runtime indexes for a track", () => {
    let currentTasks: Record<string, ManualCacheTask> = {
      track_1: buildNextManualCacheTask({
        trackId: "track_1",
        existing: null,
        track: {
          fileHash: "hash_1",
          mimeType: "audio/flac"
        },
        patch: {
          status: "queued"
        },
        updatedAt: "2026-07-06T00:00:00.000Z"
      })!
    };
    const deletedTasks: Array<{ roomId: string; trackId: string }> = [];
    const chunkIndexesByTrack = new Map([["track_1", new Set([0])]]);
    const assemblingTrackIdsByTrack = new Set(["track_1"]);

    applyManualCacheTaskDrop({
      trackId: "track_1",
      roomId: "room_1",
      chunkIndexesByTrack,
      assemblingTrackIdsByTrack,
      setManualCacheTasks: (updater) => {
        currentTasks = updater(currentTasks);
      },
      deleteManualCacheTask: (roomId, trackId) => {
        deletedTasks.push({ roomId, trackId });
      }
    });

    expect(currentTasks).toEqual({});
    expect([...chunkIndexesByTrack.keys()]).toEqual([]);
    expect([...assemblingTrackIdsByTrack.keys()]).toEqual([]);
    expect(deletedTasks).toEqual([{ roomId: "room_1", trackId: "track_1" }]);
  });

  it("loads room manual cache tasks with stale task cleanup and cached piece indexes", async () => {
    const pieceIndexQueries: Array<{
      trackId: string;
      peerId: string;
      fileHash?: string | null;
      chunkSize?: number | null;
    }> = [];

    const result = await hydrateManualCacheTasksForRoom({
      roomId: "room_1",
      peerId: "peer_1",
      currentPlaybackTrackId: "track_current",
      roomTracks: [
        {
          id: "track_manual",
          relayManifest: null,
          pieceManifest: {
            totalChunks: 2,
            chunkSize: 1024,
            pieceMimeType: "audio/flac"
          }
        }
      ],
      listManualCacheTasksForRoom: async () => [
        {
          taskKey: "room_1:track_manual",
          roomId: "room_1",
          trackId: "track_manual",
          fileHash: "hash_manual",
          status: "queued",
          mode: "manual",
          errorMessage: null,
          completedChunks: 0,
          totalChunks: 2,
          mimeType: "audio/flac",
          manifestSource: "snapshot",
          blockedReason: null,
          integrityMode: "weak",
          providerPeerIds: [],
          connectedProviderPeerIds: [],
          selectedProviderPeerId: null,
          requestableChunkCount: 0,
          pendingChunkCount: 0,
          lastRequestedChunks: [],
          lastPieceReceivedAt: null,
          lastError: null,
          updatedAt: "2026-07-06T00:00:00.000Z"
        },
        {
          taskKey: "room_1:track_old",
          roomId: "room_1",
          trackId: "track_old",
          fileHash: "hash_old",
          status: "downloading",
          mode: "playback-demand",
          errorMessage: null,
          completedChunks: 0,
          totalChunks: 2,
          mimeType: "audio/flac",
          manifestSource: "snapshot",
          blockedReason: null,
          integrityMode: "weak",
          providerPeerIds: [],
          connectedProviderPeerIds: [],
          selectedProviderPeerId: null,
          requestableChunkCount: 0,
          pendingChunkCount: 0,
          lastRequestedChunks: [],
          lastPieceReceivedAt: null,
          lastError: null,
          updatedAt: "2026-07-06T00:00:00.000Z"
        }
      ],
      getCachedPieceIndexes: async (trackId, peerId, options) => {
        pieceIndexQueries.push({
          trackId,
          peerId,
          fileHash: options?.fileHash,
          chunkSize: options?.chunkSize
        });
        return [0, 1];
      },
      localCacheOwnerKey: "local"
    });

    expect(result.tasks).toHaveLength(2);
    expect(result.staleTasks).toEqual([{ roomId: "room_1", trackId: "track_old" }]);
    expect(result.chunkIndexesByTrack.get("track_manual")).toEqual(new Set([0, 1]));
    expect(result.chunkIndexesByTrack.get("track_old")).toEqual(new Set([0, 1]));
    expect(pieceIndexQueries).toEqual([
      {
        trackId: "track_manual",
        peerId: "peer_1",
        fileHash: "hash_manual",
        chunkSize: 1024
      },
      {
        trackId: "track_old",
        peerId: "peer_1",
        fileHash: "hash_old",
        chunkSize: undefined
      }
    ]);
  });
});
