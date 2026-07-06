import { describe, expect, it } from "vitest";
import {
  buildNextManualCacheTask,
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
