import { describe, expect, it } from "vitest";
import {
  applyHydratedManualCacheTasksResult,
  applyManualCacheTaskDrop,
  applyManualCacheDownloadStartResult,
  applyManualCacheProgressResult,
  applyManualCacheTaskUpdate,
  buildManualCacheTaskRecord,
  buildNextManualCacheTask,
  hydrateManualCacheTasksForRoom,
  resolveManualCachePausePatch,
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

  it("keeps runtime cache metrics out of persisted manual cache records", () => {
    const task = buildNextManualCacheTask({
      trackId: "track_1",
      existing: null,
      track: {
        fileHash: "hash_1",
        mimeType: "audio/flac"
      },
      patch: {
        status: "downloading",
        completedChunks: 2,
        totalChunks: 4,
        downloadRateKbps: 6_200,
        activeAheadMs: 12_000,
        activePeerCount: 2,
        peerSummaries: [
          {
            peerId: "peer_fast",
            requestedChunkCount: 2,
            downloadRateKbps: 4_000,
            priority: "active-critical"
          }
        ]
      },
      updatedAt: "2026-07-06T00:00:00.000Z"
    });

    const record = buildManualCacheTaskRecord({
      roomId: "room_1",
      task: task!
    });

    expect(record).not.toHaveProperty("downloadRateKbps");
    expect(record).not.toHaveProperty("activeAheadMs");
    expect(record).not.toHaveProperty("activePeerCount");
    expect(record).not.toHaveProperty("peerSummaries");
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

  it("applies cache download start results to runtime state and callbacks", () => {
    const chunkIndexesByTrack = new Map<string, Set<number>>([
      ["track_1", new Set([9])]
    ]);
    const taskPatches: Array<Partial<ManualCacheTask>> = [];
    const statusMessages: string[] = [];
    const assembleRequests: Array<{ trackId: string; mimeType: string | null; totalChunks: number }> = [];

    applyManualCacheDownloadStartResult({
      trackId: "track_1",
      result: {
        shouldClearChunkIndexes: true,
        chunkIndexes: new Set([0, 1]),
        taskPatch: {
          status: "downloading",
          completedChunks: 2,
          totalChunks: 3
        },
        statusMessage: "已开始缓存《Cached》。",
        assembleRequest: {
          trackId: "track_1",
          mimeType: "audio/flac",
          totalChunks: 3
        }
      },
      chunkIndexesByTrack,
      updateManualCacheTask: (_trackId, patch) => {
        taskPatches.push(patch);
      },
      setStatusMessage: (message) => {
        statusMessages.push(message);
      },
      assembleManualCacheTrack: (trackId, mimeType, totalChunks) => {
        assembleRequests.push({ trackId, mimeType, totalChunks });
      }
    });

    expect(chunkIndexesByTrack.get("track_1")).toEqual(new Set([0, 1]));
    expect(taskPatches).toEqual([
      {
        status: "downloading",
        completedChunks: 2,
        totalChunks: 3
      }
    ]);
    expect(statusMessages).toEqual(["已开始缓存《Cached》。"]);
    expect(assembleRequests).toEqual([
      {
        trackId: "track_1",
        mimeType: "audio/flac",
        totalChunks: 3
      }
    ]);
  });

  it("applies manual cache progress results to runtime state and callbacks", () => {
    const chunkIndexesByTrack = new Map<string, Set<number>>();
    const availabilityEvents: string[] = [];
    const taskPatches: Array<Partial<ManualCacheTask>> = [];
    const assembleRequests: Array<{ trackId: string; mimeType: string | null; totalChunks: number }> = [];

    const applied = applyManualCacheProgressResult({
      trackId: "track_1",
      result: {
        accepted: true,
        nextChunkIndexes: new Set([0, 1]),
        availability: "available",
        taskPatch: {
          status: "downloading",
          completedChunks: 2,
          totalChunks: 3
        },
        assembleRequest: {
          trackId: "track_1",
          mimeType: "audio/flac",
          totalChunks: 3
        }
      },
      chunkIndexesByTrack,
      publishAvailability: (availability) => {
        availabilityEvents.push(availability);
      },
      updateManualCacheTask: (_trackId, patch) => {
        taskPatches.push(patch);
      },
      assembleManualCacheTrack: (trackId, mimeType, totalChunks) => {
        assembleRequests.push({ trackId, mimeType, totalChunks });
      }
    });

    expect(applied).toBe(true);
    expect(chunkIndexesByTrack.get("track_1")).toEqual(new Set([0, 1]));
    expect(availabilityEvents).toEqual(["available"]);
    expect(taskPatches).toEqual([
      {
        status: "downloading",
        completedChunks: 2,
        totalChunks: 3
      }
    ]);
    expect(assembleRequests).toEqual([
      {
        trackId: "track_1",
        mimeType: "audio/flac",
        totalChunks: 3
      }
    ]);
  });

  it("resolves pause patches only for active manual cache tasks", () => {
    const downloadingTask = buildNextManualCacheTask({
      trackId: "track_1",
      existing: null,
      track: {
        fileHash: "hash_1",
        mimeType: "audio/flac"
      },
      patch: {
        status: "downloading",
        blockedReason: "waiting-for-peer",
        selectedProviderPeerId: "peer_2",
        requestableChunkCount: 3,
        pendingChunkCount: 2,
        lastRequestedChunks: [0, 1],
        lastError: "timeout"
      },
      updatedAt: "2026-07-06T00:00:00.000Z"
    });

    expect(resolveManualCachePausePatch(downloadingTask)).toEqual({
      status: "paused",
      blockedReason: null,
      selectedProviderPeerId: null,
      requestableChunkCount: 0,
      pendingChunkCount: 0,
      lastRequestedChunks: [],
      lastError: null
    });
    expect(resolveManualCachePausePatch({ ...downloadingTask!, status: "queued" })).toMatchObject({
      status: "paused"
    });
    expect(resolveManualCachePausePatch({ ...downloadingTask!, status: "blocked" })).toMatchObject({
      status: "paused"
    });
    expect(resolveManualCachePausePatch({ ...downloadingTask!, status: "ready" })).toBeNull();
    expect(resolveManualCachePausePatch(null)).toBeNull();
  });

  it("skips rejected manual cache progress results", () => {
    const chunkIndexesByTrack = new Map<string, Set<number>>();

    const applied = applyManualCacheProgressResult({
      trackId: "track_1",
      result: {
        accepted: false,
        nextChunkIndexes: new Set([0]),
        availability: "available",
        taskPatch: {
          status: "downloading"
        },
        assembleRequest: {
          trackId: "track_1",
          mimeType: "audio/flac",
          totalChunks: 1
        }
      },
      chunkIndexesByTrack,
      publishAvailability: () => {
        throw new Error("availability should not publish");
      },
      updateManualCacheTask: () => {
        throw new Error("task should not update");
      },
      assembleManualCacheTrack: () => {
        throw new Error("assembly should not start");
      }
    });

    expect(applied).toBe(false);
    expect(chunkIndexesByTrack.has("track_1")).toBe(false);
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

  it("applies hydrated manual cache task results to state, cleanup, and runtime indexes", () => {
    let currentTasks: Record<string, ManualCacheTask> = {};
    const deletedTasks: Array<{ roomId: string; trackId: string }> = [];
    const chunkIndexesByTrack = new Map<string, Set<number>>();

    const applied = applyHydratedManualCacheTasksResult({
      cancelled: false,
      result: {
        tasks: [
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
          }
        ],
        staleTasks: [
          {
            roomId: "room_1",
            trackId: "track_stale"
          }
        ],
        chunkIndexesByTrack: new Map([["track_manual", new Set([0, 1])]])
      },
      currentPlaybackTrackId: "track_playing",
      setManualCacheTasks: (updater) => {
        currentTasks = updater(currentTasks);
      },
      chunkIndexesByTrack,
      deleteManualCacheTask: (roomId, trackId) => {
        deletedTasks.push({ roomId, trackId });
      }
    });

    expect(applied).toBe(true);
    expect(currentTasks.track_manual).toMatchObject({
      trackId: "track_manual",
      status: "queued",
      fileHash: "hash_manual"
    });
    expect([...chunkIndexesByTrack.get("track_manual") ?? []]).toEqual([0, 1]);
    expect(deletedTasks).toEqual([{ roomId: "room_1", trackId: "track_stale" }]);
    expect(
      applyHydratedManualCacheTasksResult({
        cancelled: true,
        result: {
          tasks: [],
          staleTasks: [{ roomId: "room_1", trackId: "ignored" }],
          chunkIndexesByTrack: new Map()
        },
        currentPlaybackTrackId: null,
        setManualCacheTasks: () => {
          throw new Error("cancelled hydration should not update tasks");
        },
        chunkIndexesByTrack,
        deleteManualCacheTask: () => {
          throw new Error("cancelled hydration should not delete stale tasks");
        }
      })
    ).toBe(false);
  });
});
