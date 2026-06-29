import { describe, expect, it } from "vitest";
import { registerTrackRequestSchema } from "@music-room/shared";
import {
  buildManualCachePieceAvailabilityAnnouncement,
  buildCachedLibraryTrackRegisterPayload,
  buildRegisterTrackPayload,
  isManualCachePieceCompatible,
  mergeHydratedManualCacheTasks,
  mergeManualCachePieceTaskProgress,
  mergeManualCachePlanTaskProgress,
  pruneManualCacheChunkIndexesByActiveTracks,
  resolveReusableCachedPieceManifest,
  resolveMissingOwnedUploadedTracks,
  resolveAutomaticPlaybackCacheTaskMode,
  resolveStalePlaybackDemandTaskIds,
  shouldCreatePlaybackDemandTaskFromCachePiece,
  shouldIgnoreManualCachePieceTaskUpdate,
  shouldAssembleManualCachePlanProgress,
  shouldHydrateCacheTaskPieceIndexes,
  shouldAnnounceTrackAvailability,
  shouldEnsurePlaybackDemandCacheTask
} from "./use-track-uploads";

describe("buildRegisterTrackPayload", () => {
  it("does not include client-only session fields rejected by the strict server schema", () => {
    const payload = buildRegisterTrackPayload({
      id: "track_1",
      title: "Tone",
      artist: "本地上传",
      album: null,
      durationMs: 500,
      bitrate: null,
      sizeBytes: 44144,
      codec: "wav",
      mimeType: "audio/wav",
      fileHash: "hash_1",
      artworkUrl: null,
      ownerSessionId: "user_1",
      ownerNickname: "Host",
      sourceType: "local_upload"
    });

    expect(payload).not.toHaveProperty("sessionId");
    expect(payload).toMatchObject({
      ownerSessionId: "user_1",
      ownerNickname: "Host"
    });
  });
});

describe("buildCachedLibraryTrackRegisterPayload", () => {
  it("produces a strict server registration payload without client-only session fields", () => {
    const payload = buildCachedLibraryTrackRegisterPayload({
      id: "track_cached",
      title: "Cached Tone",
      artist: "本地缓存",
      album: null,
      durationMs: 500,
      bitrate: null,
      sizeBytes: 44144,
      codec: "wav",
      mimeType: "audio/wav",
      fileHash: "hash_cached",
      artworkUrl: null,
      ownerSessionId: "user_1",
      ownerNickname: "Host",
      sourceType: "local_upload",
      pieceManifest: {
        totalChunks: 1,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/wav"
      },
      relayManifest: {
        totalChunks: 1,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/wav"
      }
    });

    expect(payload).not.toHaveProperty("sessionId");
    expect(registerTrackRequestSchema.parse(payload)).toMatchObject({
      title: "Cached Tone",
      fileHash: "hash_cached",
      ownerSessionId: "user_1",
      ownerNickname: "Host"
    });
  });
});

describe("shouldAnnounceTrackAvailability", () => {
  it("depends on peer identity rather than the manual cache feature flag", () => {
    expect(
      shouldAnnounceTrackAvailability({
        peerId: "peer_1"
      })
    ).toBe(true);

    expect(
      shouldAnnounceTrackAvailability({
        peerId: null
      })
    ).toBe(false);
  });
});

describe("resolveReusableCachedPieceManifest", () => {
  it("discards a cached manifest whose geometry does not match the current room track", () => {
    expect(
      resolveReusableCachedPieceManifest({
        cachedManifest: {
          totalChunks: 673,
          chunkSize: 64 * 1024
        },
        expectedManifest: {
          totalChunks: 169,
          chunkSize: 256 * 1024
        }
      })
    ).toEqual(null);
  });

  it("keeps a cached manifest when it matches the current room track geometry", () => {
    const cachedManifest = {
      totalChunks: 169,
      chunkSize: 256 * 1024
    };

    expect(
      resolveReusableCachedPieceManifest({
        cachedManifest,
        expectedManifest: {
          totalChunks: 169,
          chunkSize: 256 * 1024
        }
      })
    ).toBe(cachedManifest);
  });
});

describe("isManualCachePieceCompatible", () => {
  it("rejects received cache pieces whose geometry does not match the current room track", () => {
    expect(
      isManualCachePieceCompatible({
        piece: {
          totalChunks: 673,
          chunkSize: 64 * 1024
        },
        expectedManifest: {
          totalChunks: 169,
          chunkSize: 256 * 1024
        }
      })
    ).toBe(false);
  });

  it("accepts received cache pieces when there is no current manifest to compare", () => {
    expect(
      isManualCachePieceCompatible({
        piece: {
          totalChunks: 2,
          chunkSize: 128 * 1024
        },
        expectedManifest: null
      })
    ).toBe(true);
  });
});

describe("buildManualCachePieceAvailabilityAnnouncement", () => {
  it("publishes partial local cache availability as soon as a playback-demand piece arrives", () => {
    const announcement = buildManualCachePieceAvailabilityAnnouncement({
      existing: {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_listener",
        nickname: "222",
        assetKind: "relay",
        assetHash: "hash_1",
        totalChunks: 169,
        chunkSize: 256 * 1024,
        availableChunks: [0, 1],
        source: "local_cache",
        announcedAt: "2026-06-28T09:00:00.000Z"
      },
      roomId: "room_1",
      trackId: "track_1",
      fileHash: "hash_1",
      peerId: "peer_listener",
      nickname: "222",
      chunkIndex: 2,
      totalChunks: 169,
      chunkSize: 256 * 1024
    });

    expect(announcement).toMatchObject({
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_listener",
      nickname: "222",
      assetKind: "relay",
      assetHash: "hash_1",
      totalChunks: 169,
      chunkSize: 256 * 1024,
      availableChunks: [0, 1, 2],
      source: "local_cache"
    });
  });
});

describe("mergeHydratedManualCacheTasks", () => {
  it("preserves a fresh playback-demand task when IndexedDB hydration returns before its async upsert", () => {
    expect(
      mergeHydratedManualCacheTasks({
        currentTasks: {
          track_1: {
            trackId: "track_1",
            status: "queued",
            mode: "playback-demand",
            fileHash: "hash_1",
            updatedAt: "2026-06-28T09:00:05.000Z",
            errorMessage: null,
            completedChunks: 0,
            totalChunks: 169,
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
            lastError: null
          }
        },
        hydratedTasks: [],
        currentPlaybackTrackId: "track_1"
      }).track_1
    ).toMatchObject({
      mode: "playback-demand",
      status: "queued",
      totalChunks: 169
    });
  });

  it("keeps newer in-memory playback-demand progress over stale IndexedDB hydration", () => {
    expect(
      mergeHydratedManualCacheTasks({
        currentTasks: {
          track_1: {
            trackId: "track_1",
            status: "downloading",
            mode: "playback-demand",
            fileHash: "hash_1",
            updatedAt: "2026-06-28T09:00:10.000Z",
            errorMessage: null,
            completedChunks: 8,
            totalChunks: 169,
            mimeType: "audio/flac",
            manifestSource: "snapshot",
            blockedReason: null,
            integrityMode: "weak",
            providerPeerIds: ["peer_uploader"],
            connectedProviderPeerIds: ["peer_uploader"],
            selectedProviderPeerId: "peer_uploader",
            requestableChunkCount: 20,
            pendingChunkCount: 2,
            lastRequestedChunks: [8, 9],
            lastPieceReceivedAt: "2026-06-28T09:00:09.000Z",
            lastError: null
          }
        },
        hydratedTasks: [
          {
            taskKey: "room_1:track_1",
            roomId: "room_1",
            trackId: "track_1",
            status: "queued",
            mode: "playback-demand",
            fileHash: "hash_1",
            updatedAt: "2026-06-28T09:00:00.000Z",
            errorMessage: null,
            completedChunks: 0,
            totalChunks: 169,
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
            lastError: null
          }
        ],
        currentPlaybackTrackId: "track_1"
      }).track_1
    ).toMatchObject({
      status: "downloading",
      completedChunks: 8,
      selectedProviderPeerId: "peer_uploader",
      lastRequestedChunks: [8, 9]
    });
  });

  it("drops playback-demand tasks for tracks that are no longer playing", () => {
    expect(
      mergeHydratedManualCacheTasks({
        currentTasks: {
          track_1: {
            trackId: "track_1",
            status: "downloading",
            mode: "playback-demand",
            fileHash: "hash_1",
            updatedAt: "2026-06-28T09:00:05.000Z",
            errorMessage: null,
            completedChunks: 4,
            totalChunks: 169,
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
            lastError: null
          }
        },
        hydratedTasks: [],
        currentPlaybackTrackId: "track_2"
      })
    ).toEqual({});
  });
});

describe("mergeManualCachePlanTaskProgress", () => {
  it("keeps received-piece progress when a slower IndexedDB plan scan reports fewer local pieces", () => {
    expect(
      mergeManualCachePlanTaskProgress({
        current: {
          completedChunks: 40,
          totalChunks: 169,
          status: "downloading",
          lastPieceReceivedAt: "2026-06-28T09:00:20.000Z",
          lastError: null,
          blockedReason: null
        },
        planLocalPieceIndexes: Array.from({ length: 12 }, (_, index) => index),
        inMemoryPieceIndexes: new Set(Array.from({ length: 41 }, (_, index) => index)),
        planTotalChunks: 169,
        planBlockedReason: "pending-window-full"
      })
    ).toMatchObject({
      completedChunks: 41,
      totalChunks: 169,
      status: "downloading",
      blockedReason: "pending-window-full",
      lastPieceReceivedAt: "2026-06-28T09:00:20.000Z",
      lastError: null
    });
  });

  it("marks the task complete only when merged known pieces reach the manifest total", () => {
    expect(
      mergeManualCachePlanTaskProgress({
        current: {
          completedChunks: 168,
          totalChunks: 169,
          status: "downloading",
          lastPieceReceivedAt: null,
          lastError: null,
          blockedReason: null
        },
        planLocalPieceIndexes: Array.from({ length: 169 }, (_, index) => index),
        inMemoryPieceIndexes: new Set([0, 1]),
        planTotalChunks: 169,
        planBlockedReason: "complete"
      })
    ).toMatchObject({
      completedChunks: 169,
      totalChunks: 169,
      blockedReason: null,
      lastError: null
    });
  });
});

describe("mergeManualCachePieceTaskProgress", () => {
  it("does not let a freshly received piece reset visible progress after in-memory indexes were pruned", () => {
    expect(
      mergeManualCachePieceTaskProgress({
        current: {
          completedChunks: 40,
          totalChunks: 169,
          status: "downloading"
        },
        knownChunkIndexes: new Set([80]),
        receivedTotalChunks: 169
      })
    ).toMatchObject({
      completedChunks: 40,
      totalChunks: 169,
      status: "downloading"
    });
  });

  it("advances visible progress when the merged known piece set is ahead of the task", () => {
    expect(
      mergeManualCachePieceTaskProgress({
        current: {
          completedChunks: 40,
          totalChunks: 169,
          status: "downloading"
        },
        knownChunkIndexes: new Set(Array.from({ length: 41 }, (_, index) => index)),
        receivedTotalChunks: 169
      })
    ).toMatchObject({
      completedChunks: 41,
      totalChunks: 169,
      status: "downloading"
    });
  });
});

describe("shouldIgnoreManualCachePieceTaskUpdate", () => {
  it("ignores late received pieces once a cache task is ready or already assembling", () => {
    expect(shouldIgnoreManualCachePieceTaskUpdate("ready")).toBe(true);
    expect(shouldIgnoreManualCachePieceTaskUpdate("assembling")).toBe(true);
    expect(shouldIgnoreManualCachePieceTaskUpdate("downloading")).toBe(false);
    expect(shouldIgnoreManualCachePieceTaskUpdate("paused")).toBe(false);
  });
});

describe("pruneManualCacheChunkIndexesByActiveTracks", () => {
  it("keeps cached chunk indexes for tracks still present in the same room snapshot", () => {
    const chunkIndexesByTrack = new Map<string, Set<number>>([
      ["track_1", new Set([0, 1, 2])],
      ["track_2", new Set([0])]
    ]);

    pruneManualCacheChunkIndexesByActiveTracks(chunkIndexesByTrack, new Set(["track_1"]));

    expect([...chunkIndexesByTrack.keys()]).toEqual(["track_1"]);
    expect([...chunkIndexesByTrack.get("track_1") ?? []]).toEqual([0, 1, 2]);
  });
});

describe("shouldAssembleManualCachePlanProgress", () => {
  it("assembles when a plan scan discovers every cached piece", () => {
    expect(
      shouldAssembleManualCachePlanProgress({
        status: "downloading",
        completedChunks: 169,
        totalChunks: 169
      })
    ).toBe(true);
  });

  it("does not assemble paused or incomplete cache tasks", () => {
    expect(
      shouldAssembleManualCachePlanProgress({
        status: "paused",
        completedChunks: 169,
        totalChunks: 169
      })
    ).toBe(false);
    expect(
      shouldAssembleManualCachePlanProgress({
        status: "downloading",
        completedChunks: 168,
        totalChunks: 169
      })
    ).toBe(false);
  });
});

describe("resolveStalePlaybackDemandTaskIds", () => {
  it("returns playback-demand tasks that no longer match the current playback track", () => {
    expect(
      resolveStalePlaybackDemandTaskIds({
        currentTasks: {
          track_1: {
            trackId: "track_1",
            status: "downloading",
            mode: "playback-demand",
            fileHash: "hash_1",
            updatedAt: "2026-06-28T09:00:05.000Z",
            errorMessage: null,
            completedChunks: 4,
            totalChunks: 169,
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
            lastError: null
          },
          track_2: {
            trackId: "track_2",
            status: "downloading",
            mode: "playback-demand",
            fileHash: "hash_2",
            updatedAt: "2026-06-28T09:00:06.000Z",
            errorMessage: null,
            completedChunks: 1,
            totalChunks: 10,
            mimeType: "audio/mpeg",
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
            lastError: null
          }
        },
        currentPlaybackTrackId: "track_2"
      })
    ).toEqual(["track_1"]);
  });
});

describe("shouldHydrateCacheTaskPieceIndexes", () => {
  it("hydrates active manual and playback-demand tasks", () => {
    expect(
      shouldHydrateCacheTaskPieceIndexes({
        mode: "manual",
        status: "downloading"
      })
    ).toBe(true);
    expect(
      shouldHydrateCacheTaskPieceIndexes({
        mode: "playback-demand",
        status: "blocked"
      })
    ).toBe(true);
    expect(
      shouldHydrateCacheTaskPieceIndexes({
        mode: "playback-demand",
        status: "ready"
      })
    ).toBe(false);
  });
});

describe("shouldCreatePlaybackDemandTaskFromCachePiece", () => {
  const remotePlayback = {
    status: "playing" as const,
    currentTrackId: "track_1",
    currentQueueItemId: "queue_1",
    sourceSessionId: "host",
    sourcePeerId: "peer_host",
    sourceTrackId: "track_1",
    positionMs: 0,
    startedAt: "2026-06-28T09:00:00.000Z",
    queueVersion: 1,
    playbackRevision: 1,
    mediaEpoch: 1
  };

  it("creates an automatic task when a current remote playback piece arrives before the task exists", () => {
    expect(
      shouldCreatePlaybackDemandTaskFromCachePiece({
        playback: remotePlayback,
        trackId: "track_1",
        peerId: "peer_listener",
        activeSessionId: "listener",
        hasCurrentTask: false
      })
    ).toBe(true);
  });

  it("does not create a task on the source device or when a task already exists", () => {
    expect(
      shouldCreatePlaybackDemandTaskFromCachePiece({
        playback: remotePlayback,
        trackId: "track_1",
        peerId: "peer_host",
        activeSessionId: "host",
        hasCurrentTask: false
      })
    ).toBe(false);
    expect(
      shouldCreatePlaybackDemandTaskFromCachePiece({
        playback: remotePlayback,
        trackId: "track_1",
        peerId: "peer_listener",
        activeSessionId: "listener",
        hasCurrentTask: true
      })
    ).toBe(false);
  });
});

describe("shouldEnsurePlaybackDemandCacheTask", () => {
  const remotePlayback = {
    status: "playing" as const,
    currentTrackId: "track_1",
    currentQueueItemId: "queue_1",
    sourceSessionId: "host",
    sourcePeerId: "peer_host",
    sourceTrackId: "track_1",
    positionMs: 0,
    startedAt: "2026-06-28T09:00:00.000Z",
    queueVersion: 1,
    playbackRevision: 1,
    mediaEpoch: 1
  };

  it("starts an automatic playback-demand cache once the remote playing track metadata is available", () => {
    expect(
      shouldEnsurePlaybackDemandCacheTask({
        enableManualTrackCaching: true,
        playback: remotePlayback,
        trackExists: true,
        peerId: "peer_listener",
        activeSessionId: "listener",
        existingTask: null
      })
    ).toBe(true);
  });

  it("waits for track metadata and does not restart an existing ready playback-demand task", () => {
    expect(
      shouldEnsurePlaybackDemandCacheTask({
        enableManualTrackCaching: true,
        playback: remotePlayback,
        trackExists: false,
        peerId: "peer_listener",
        activeSessionId: "listener",
        existingTask: null
      })
    ).toBe(false);

    expect(
      shouldEnsurePlaybackDemandCacheTask({
        enableManualTrackCaching: true,
        playback: remotePlayback,
        trackExists: true,
        peerId: "peer_listener",
        activeSessionId: "listener",
        hasLocalFullTrack: true,
        existingTask: {
          mode: "playback-demand",
          status: "ready"
        }
      })
    ).toBe(false);
  });

  it("restarts a stale ready playback-demand task when the full local file is missing", () => {
    expect(
      shouldEnsurePlaybackDemandCacheTask({
        enableManualTrackCaching: true,
        playback: remotePlayback,
        trackExists: true,
        peerId: "peer_listener",
        activeSessionId: "listener",
        hasLocalFullTrack: false,
        existingTask: {
          mode: "playback-demand",
          status: "ready"
        }
      })
    ).toBe(true);
  });

  it("restarts a stale ready manual task for the current remote playback when the full local file is missing", () => {
    expect(
      shouldEnsurePlaybackDemandCacheTask({
        enableManualTrackCaching: true,
        playback: remotePlayback,
        trackExists: true,
        peerId: "peer_listener",
        activeSessionId: "listener",
        hasLocalFullTrack: false,
        existingTask: {
          mode: "manual",
          status: "ready"
        }
      })
    ).toBe(true);
  });

  it("does not auto-cache on the source owner device", () => {
    expect(
      shouldEnsurePlaybackDemandCacheTask({
        enableManualTrackCaching: true,
        playback: remotePlayback,
        trackExists: true,
        peerId: "peer_host",
        activeSessionId: "host",
        existingTask: null
      })
    ).toBe(false);
  });

  it("creates a task from an incoming source-device piece when the full-local file is missing", () => {
    expect(
      shouldCreatePlaybackDemandTaskFromCachePiece({
        playback: remotePlayback,
        trackId: "track_1",
        peerId: "peer_host",
        activeSessionId: "host",
        hasLocalFullTrack: false,
        hasCurrentTask: false
      })
    ).toBe(true);
  });

  it("auto-caches on a selected source device when its trusted full-local file is missing", () => {
    expect(
      shouldEnsurePlaybackDemandCacheTask({
        enableManualTrackCaching: true,
        playback: remotePlayback,
        trackExists: true,
        peerId: "peer_host",
        activeSessionId: "host",
        hasLocalFullTrack: false,
        existingTask: null
      })
    ).toBe(true);
  });

  it("auto-caches on another device even when it is signed in as the source session", () => {
    expect(
      shouldEnsurePlaybackDemandCacheTask({
        enableManualTrackCaching: true,
        playback: remotePlayback,
        trackExists: true,
        peerId: "peer_listener",
        activeSessionId: "host",
        existingTask: null
      })
    ).toBe(true);
  });
});

describe("resolveAutomaticPlaybackCacheTaskMode", () => {
  it("keeps automatic playback cache as playback-demand while reusing manual cache mechanics", () => {
    expect(resolveAutomaticPlaybackCacheTaskMode()).toBe("playback-demand");
  });
});

describe("resolveMissingOwnedUploadedTracks", () => {
  it("returns only the current user's room tracks that lost their playable upload binding", () => {
    expect(
      resolveMissingOwnedUploadedTracks({
        activeSessionId: "user_a",
        roomTracks: [
          {
            id: "track_owned_missing",
            fileHash: "hash-a",
            ownerSessionId: "user_a"
          },
          {
            id: "track_owned_ready",
            fileHash: "hash-b",
            ownerSessionId: "user_a"
          },
          {
            id: "track_other_user",
            fileHash: "hash-c",
            ownerSessionId: "user_b"
          }
        ],
        uploadedTracks: {
          track_owned_ready: {
            file: new File(["ready"], "ready.mp3", { type: "audio/mpeg" }),
            objectUrl: "blob:ready",
            origin: "live-upload"
          }
        }
      })
    ).toEqual([
      {
        id: "track_owned_missing",
        fileHash: "hash-a",
        ownerSessionId: "user_a"
      }
    ]);
  });

  it("returns an empty plan when there is no active room owner session", () => {
    expect(
      resolveMissingOwnedUploadedTracks({
        activeSessionId: null,
        roomTracks: [
          {
            id: "track_owned_missing",
            fileHash: "hash-a",
            ownerSessionId: "user_a"
          }
        ],
        uploadedTracks: {}
      })
    ).toEqual([]);
  });
});
