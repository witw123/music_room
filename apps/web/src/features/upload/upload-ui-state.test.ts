import { describe, expect, it } from "vitest";
import {
  buildNextManualCacheTask,
  buildRoomTrackIdsKey,
  resolveManualCachePieceReceivedAction,
  resolveManualCachePlanReceivedAction,
  resolveManualCachePlanTaskUpdate,
  selectActiveManualCacheTrackIds,
  type ManualCacheTask
} from "./upload-ui-state";

describe("buildNextManualCacheTask", () => {
  it("builds a task from track defaults and patch fields", () => {
    expect(
      buildNextManualCacheTask({
        trackId: "track_1",
        existing: null,
        track: {
          fileHash: "hash_1",
          mimeType: "audio/flac"
        },
        patch: {
          status: "queued",
          mode: "manual",
          completedChunks: 2,
          totalChunks: 8
        },
        updatedAt: "2026-07-06T00:00:00.000Z"
      })
    ).toMatchObject({
      trackId: "track_1",
      status: "queued",
      mode: "manual",
      fileHash: "hash_1",
      completedChunks: 2,
      totalChunks: 8,
      mimeType: "audio/flac",
      updatedAt: "2026-07-06T00:00:00.000Z"
    });
  });

  it("returns null when a patch callback declines the update", () => {
    expect(
      buildNextManualCacheTask({
        trackId: "track_1",
        existing: null,
        track: null,
        patch: () => null,
        updatedAt: "2026-07-06T00:00:00.000Z"
      })
    ).toBeNull();
  });
});

describe("upload page derived UI state", () => {
  it("builds a stable room track ids key from refreshed snapshot track arrays", () => {
    expect(
      buildRoomTrackIdsKey([
        { id: "track_b" },
        { id: "track_a" },
        { id: "track_b" }
      ])
    ).toBe("track_a|track_b");
  });

  it("selects active manual and current playback-demand cache task ids", () => {
    const baseTask = {
      fileHash: "hash",
      updatedAt: "2026-07-06T00:00:00.000Z",
      errorMessage: null,
      completedChunks: 0,
      totalChunks: 4,
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
      lastError: null
    } satisfies Omit<ManualCacheTask, "trackId" | "status" | "mode">;

    expect(
      selectActiveManualCacheTrackIds({
        tasks: {
          manual_ready: {
            ...baseTask,
            trackId: "manual_ready",
            status: "ready",
            mode: "manual"
          },
          manual_active: {
            ...baseTask,
            trackId: "manual_active",
            status: "downloading",
            mode: "manual"
          },
          playback_current: {
            ...baseTask,
            trackId: "playback_current",
            status: "blocked",
            mode: "playback-demand"
          },
          playback_other: {
            ...baseTask,
            trackId: "playback_other",
            status: "downloading",
            mode: "playback-demand"
          }
        },
        currentPlaybackTrackId: "playback_current"
      }).sort()
    ).toEqual(["manual_active", "playback_current"]);
  });
});

describe("resolveManualCachePlanTaskUpdate", () => {
  const plan = {
    localPieceIndexes: [0, 1],
    manifest: {
      totalChunks: 2,
      pieceMimeType: "audio/flac"
    },
    manifestSource: "snapshot",
    blockedReason: "complete",
    integrityMode: "strong",
    providerPeerIds: ["peer_a"],
    connectedProviderPeerIds: ["peer_a"],
    selectedProviderPeerId: "peer_a",
    requestableChunks: [1],
    pendingChunkCount: 0
  } as const;

  it("skips plans without an existing task when playback does not demand caching", () => {
    expect(
      resolveManualCachePlanTaskUpdate({
        current: null,
        plan,
        track: {
          fileHash: "hash_1",
          mimeType: "audio/flac"
        },
        knownChunkIndexes: new Set([0, 1]),
        isCurrentPlaybackDemand: false
      }).patch
    ).toBeNull();
  });

  it("creates playback-demand progress patches and assembly instructions", () => {
    const update = resolveManualCachePlanTaskUpdate({
      current: null,
      plan,
      track: {
        fileHash: "hash_1",
        mimeType: "audio/flac"
      },
      knownChunkIndexes: new Set([0, 1]),
      isCurrentPlaybackDemand: true
    });

    expect(update.patch).toMatchObject({
      status: "assembling",
      mode: "playback-demand",
      fileHash: "hash_1",
      completedChunks: 2,
      totalChunks: 2,
      mimeType: "audio/flac",
      manifestSource: "snapshot",
      blockedReason: null
    });
    expect(update.shouldAssemble).toBe(true);
    expect(update.assembleMimeType).toBe("audio/flac");
    expect(update.assembleTotalChunks).toBe(2);
  });
});

describe("resolveManualCachePlanReceivedAction", () => {
  const plan = {
    trackId: "track_1",
    localPieceIndexes: [0, 1],
    manifest: {
      totalChunks: 2,
      pieceMimeType: "audio/flac"
    },
    manifestSource: "snapshot",
    blockedReason: "complete",
    integrityMode: "strong" as const,
    providerPeerIds: ["peer_a"],
    connectedProviderPeerIds: ["peer_a"],
    selectedProviderPeerId: "peer_a",
    requestableChunks: [1],
    pendingChunkCount: 0
  };

  it("merges plan indexes and returns playback-demand assembly actions", () => {
    const result = resolveManualCachePlanReceivedAction({
      plan,
      currentTask: null,
      knownChunkIndexes: new Set([0]),
      track: {
        fileHash: "hash_1",
        mimeType: "audio/flac"
      },
      isCurrentPlaybackDemand: true
    });

    expect(result.nextChunkIndexes).toEqual(new Set([0, 1]));
    expect(result.taskPatch).toMatchObject({
      status: "assembling",
      mode: "playback-demand",
      completedChunks: 2,
      totalChunks: 2
    });
    expect(result.assembleRequest).toEqual({
      trackId: "track_1",
      mimeType: "audio/flac",
      totalChunks: 2
    });
  });

  it("ignores plans without current tasks when playback does not demand caching", () => {
    const result = resolveManualCachePlanReceivedAction({
      plan,
      currentTask: null,
      knownChunkIndexes: new Set(),
      track: {
        fileHash: "hash_1",
        mimeType: "audio/flac"
      },
      isCurrentPlaybackDemand: false
    });

    expect(result.taskPatch).toBeNull();
    expect(result.assembleRequest).toBeNull();
    expect(result.nextChunkIndexes).toEqual(new Set([0, 1]));
  });
});

describe("resolveManualCachePieceReceivedAction", () => {
  const currentTask = {
    trackId: "track_1",
    status: "downloading" as const,
    mode: "manual" as const,
    fileHash: "hash_1",
    updatedAt: "2026-07-06T00:00:00.000Z",
    errorMessage: null,
    completedChunks: 1,
    totalChunks: 2,
    mimeType: "audio/flac",
    manifestSource: "snapshot",
    blockedReason: null,
    integrityMode: "weak" as const,
    providerPeerIds: [],
    connectedProviderPeerIds: [],
    selectedProviderPeerId: null,
    requestableChunkCount: 0,
    pendingChunkCount: 0,
    lastRequestedChunks: [],
    lastPieceReceivedAt: null,
    lastError: null
  };

  it("builds progress patches, availability, and assemble requests for received pieces", () => {
    const result = resolveManualCachePieceReceivedAction({
      piece: {
        trackId: "track_1",
        chunkIndex: 1,
        totalChunks: 2,
        chunkSize: 1024,
        mimeType: "audio/flac"
      },
      currentTask,
      knownChunkIndexes: new Set([0]),
      track: {
        id: "track_1",
        fileHash: "hash_1",
        mimeType: "audio/flac",
        relayManifest: null,
        pieceManifest: {
          totalChunks: 2,
          chunkSize: 1024,
          pieceMimeType: "audio/flac"
        }
      },
      roomId: "room_1",
      activeSession: {
        userId: "user_1",
        nickname: "Host"
      },
      peerId: "peer_1",
      playback: null,
      hasLocalFullTrack: false,
      nowIso: "2026-07-06T00:00:00.000Z"
    });

    expect(result.nextChunkIndexes).toEqual(new Set([0, 1]));
    expect(result.taskPatch).toMatchObject({
      status: "downloading",
      completedChunks: 2,
      totalChunks: 2,
      mimeType: "audio/flac",
      lastPieceReceivedAt: "2026-07-06T00:00:00.000Z"
    });
    expect(result.availability?.availableChunks).toEqual([0, 1]);
    expect(result.assembleRequest).toEqual({
      trackId: "track_1",
      mimeType: "audio/flac",
      totalChunks: 2
    });
  });

  it("rejects pieces with incompatible manifest geometry", () => {
    const result = resolveManualCachePieceReceivedAction({
      piece: {
        trackId: "track_1",
        chunkIndex: 1,
        totalChunks: 3,
        chunkSize: 1024,
        mimeType: "audio/flac"
      },
      currentTask,
      knownChunkIndexes: new Set([0]),
      track: {
        id: "track_1",
        fileHash: "hash_1",
        mimeType: "audio/flac",
        relayManifest: null,
        pieceManifest: {
          totalChunks: 2,
          chunkSize: 1024,
          pieceMimeType: "audio/flac"
        }
      },
      roomId: "room_1",
      activeSession: {
        userId: "user_1",
        nickname: "Host"
      },
      peerId: "peer_1",
      playback: null,
      hasLocalFullTrack: false,
      nowIso: "2026-07-06T00:00:00.000Z"
    });

    expect(result.accepted).toBe(false);
    expect(result.taskPatch).toBeNull();
    expect(result.nextChunkIndexes).toEqual(new Set([0]));
  });
});
