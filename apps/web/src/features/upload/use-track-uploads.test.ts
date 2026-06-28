import { describe, expect, it } from "vitest";
import { registerTrackRequestSchema } from "@music-room/shared";
import {
  buildManualCachePieceAvailabilityAnnouncement,
  buildCachedLibraryTrackRegisterPayload,
  buildRegisterTrackPayload,
  isManualCachePieceCompatible,
  mergeHydratedManualCacheTasks,
  resolveReusableCachedPieceManifest,
  resolveMissingOwnedUploadedTracks,
  resolveAutomaticPlaybackCacheTaskMode,
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
  it("uses the same manual cache task mode as the cache download button", () => {
    expect(resolveAutomaticPlaybackCacheTaskMode()).toBe("manual");
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
