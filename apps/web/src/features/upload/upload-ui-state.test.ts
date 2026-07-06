import { describe, expect, it } from "vitest";
import {
  buildNextManualCacheTask,
  resolveManualCachePieceReceivedAction,
  resolveManualCachePlanTaskUpdate
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
