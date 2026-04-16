import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@music-room/shared";
import {
  buildManualCacheSchedulerAvailability,
  resolveManualCacheTrackPlan,
  resolveManualCacheTrackProviderPeerId,
  shouldRestartManualCacheProviderPeer,
  shouldRetryManualCacheProviderBootstrap
} from "./use-manual-cache-downloader";

describe("buildManualCacheSchedulerAvailability", () => {
  it("synthesizes current online uploader availability from the room manifest", () => {
    const roomSnapshot = buildManualCacheRoomSnapshot({
      ownerPeerId: "peer_owner"
    });

    const availability = buildManualCacheSchedulerAvailability({
      availabilityByTrack: {},
      manualCacheTrackIds: ["track_a"],
      roomSnapshot,
      localPeerId: "peer_local"
    });

    expect(availability.track_a?.peer_owner).toMatchObject({
      roomId: "room_1",
      trackId: "track_a",
      ownerPeerId: "peer_owner",
      totalChunks: 4,
      chunkSize: 128 * 1024,
      availableChunks: [0, 1, 2, 3],
      source: "live_upload"
    });
  });

  it("drops stale availability from peers that are no longer active room members", () => {
    const roomSnapshot = buildManualCacheRoomSnapshot({
      ownerPeerId: "peer_owner"
    });

    const availability = buildManualCacheSchedulerAvailability({
      availabilityByTrack: {
        track_a: {
          peer_stale: {
            roomId: "room_1",
            trackId: "track_a",
            ownerPeerId: "peer_stale",
            nickname: "stale",
            totalChunks: 4,
            chunkSize: 128 * 1024,
            availableChunks: [0, 1, 2, 3],
            source: "local_cache",
            announcedAt: new Date(0).toISOString()
          }
        }
      },
      manualCacheTrackIds: ["track_a"],
      roomSnapshot,
      localPeerId: "peer_local"
    });

    expect(availability.track_a?.peer_stale).toBeUndefined();
    expect(availability.track_a?.peer_owner).toBeDefined();
  });

  it("does not synthesize uploader availability when the uploader is offline", () => {
    const roomSnapshot = buildManualCacheRoomSnapshot({
      ownerPeerId: "peer_owner",
      ownerPresenceState: "offline"
    });

    expect(
      buildManualCacheSchedulerAvailability({
        availabilityByTrack: {},
        manualCacheTrackIds: ["track_a"],
        roomSnapshot,
        localPeerId: "peer_local"
      })
    ).toEqual({});
  });
});

describe("resolveManualCacheTrackPlan", () => {
  it("uses availability manifest when the snapshot manifest is absent", () => {
    const roomSnapshot = buildManualCacheRoomSnapshot({
      ownerPeerId: "peer_owner",
      omitTrackManifest: true
    });
    const track = roomSnapshot.tracks[0];

    const plan = resolveManualCacheTrackPlan({
      track,
      roomId: "room_1",
      localPeerId: "peer_local",
      availabilityByTrack: {
        track_a: {
          peer_owner: {
            roomId: "room_1",
            trackId: "track_a",
            ownerPeerId: "peer_owner",
            nickname: "owner",
            totalChunks: 4,
            chunkSize: 128 * 1024,
            availableChunks: [0, 1, 2, 3],
            source: "live_upload",
            announcedAt: new Date(0).toISOString()
          }
        }
      },
      connectedPeerIds: ["peer_owner"],
      cachedManifest: null,
      localPieceIndexes: [0],
      pendingChunkIndexes: []
    });

    expect(plan.manifestSource).toBe("availability");
    expect(plan.selectedProviderPeerId).toBe("peer_owner");
    expect(plan.requestableChunks).toEqual([1, 2, 3]);
    expect(plan.blockedReason).toBeNull();
  });

  it("only requests chunks that the selected provider announced", () => {
    const roomSnapshot = buildManualCacheRoomSnapshot({
      ownerPeerId: "peer_owner"
    });
    const track = roomSnapshot.tracks[0];

    const plan = resolveManualCacheTrackPlan({
      track,
      roomId: "room_1",
      localPeerId: "peer_local",
      availabilityByTrack: {
        track_a: {
          peer_owner: {
            roomId: "room_1",
            trackId: "track_a",
            ownerPeerId: "peer_owner",
            nickname: "owner",
            totalChunks: 4,
            chunkSize: 128 * 1024,
            availableChunks: [1, 3],
            source: "live_upload",
            announcedAt: new Date(0).toISOString()
          }
        }
      },
      connectedPeerIds: ["peer_owner"],
      cachedManifest: null,
      localPieceIndexes: [],
      pendingChunkIndexes: [1]
    });

    expect(plan.requestableChunks).toEqual([3]);
  });
});

describe("resolveManualCacheTrackProviderPeerId", () => {
  it("prefers the live uploader peer before secondary availability providers", () => {
    const roomSnapshot = buildManualCacheRoomSnapshot({
      ownerPeerId: "peer_owner"
    });

    expect(
      resolveManualCacheTrackProviderPeerId({
        trackId: "track_a",
        roomSnapshot,
        availabilityByTrack: {
          track_a: {
            peer_other: {
              roomId: "room_1",
              trackId: "track_a",
              ownerPeerId: "peer_other",
              nickname: "other",
              availableChunks: [0, 1, 2, 3],
              totalChunks: 4,
              chunkSize: 128 * 1024,
              source: "local_cache",
              announcedAt: new Date(0).toISOString()
            }
          }
        },
        connectedPeerIds: ["peer_other", "peer_owner"],
        localPeerId: "peer_local"
      })
    ).toBe("peer_owner");
  });

  it("falls back to the best announced provider when the uploader is offline or disconnected", () => {
    const roomSnapshot = buildManualCacheRoomSnapshot({
      ownerPeerId: "peer_owner",
      ownerPresenceState: "offline"
    });

    expect(
      resolveManualCacheTrackProviderPeerId({
        trackId: "track_a",
        roomSnapshot,
        availabilityByTrack: {
          track_a: {
            peer_low: {
              roomId: "room_1",
              trackId: "track_a",
              ownerPeerId: "peer_low",
              nickname: "low",
              availableChunks: [0],
              totalChunks: 4,
              chunkSize: 128 * 1024,
              source: "local_cache",
              announcedAt: new Date(0).toISOString()
            },
            peer_high: {
              roomId: "room_1",
              trackId: "track_a",
              ownerPeerId: "peer_high",
              nickname: "high",
              availableChunks: [0, 1, 2],
              totalChunks: 4,
              chunkSize: 128 * 1024,
              source: "local_cache",
              announcedAt: new Date(1_000).toISOString()
            }
          }
        },
        connectedPeerIds: ["peer_low", "peer_high"],
        localPeerId: "peer_local"
      })
    ).toBe("peer_high");
  });
});

describe("shouldRetryManualCacheProviderBootstrap", () => {
  it("retries bootstrap when a cache task exists but no provider peer is connected", () => {
    expect(
      shouldRetryManualCacheProviderBootstrap({
        manualCacheTrackIds: ["track_a"],
        providerPeerIds: ["peer_owner"],
        connectedPeerIds: [],
        lastBootstrapAttemptAt: null,
        now: 10_000
      })
    ).toBe(true);
  });

  it("does not retry while a provider is already connected", () => {
    expect(
      shouldRetryManualCacheProviderBootstrap({
        manualCacheTrackIds: ["track_a"],
        providerPeerIds: ["peer_owner"],
        connectedPeerIds: ["peer_owner"],
        lastBootstrapAttemptAt: null,
        now: 10_000
      })
    ).toBe(false);
  });

  it("respects the retry cooldown before re-bootstrap", () => {
    expect(
      shouldRetryManualCacheProviderBootstrap({
        manualCacheTrackIds: ["track_a"],
        providerPeerIds: ["peer_owner"],
        connectedPeerIds: [],
        lastBootstrapAttemptAt: 9_500,
        now: 10_000
      })
    ).toBe(false);

    expect(
      shouldRetryManualCacheProviderBootstrap({
        manualCacheTrackIds: ["track_a"],
        providerPeerIds: ["peer_owner"],
        connectedPeerIds: [],
        lastBootstrapAttemptAt: 8_000,
        now: 10_000
      })
    ).toBe(true);
  });
});

describe("shouldRestartManualCacheProviderPeer", () => {
  it("restarts a provider peer after it stays unavailable for too long", () => {
    expect(
      shouldRestartManualCacheProviderPeer({
        providerPeerId: "peer_owner",
        connectedPeerIds: [],
        unavailableSinceAt: 1_000,
        lastRestartAt: null,
        now: 7_100
      })
    ).toBe(true);
  });

  it("does not restart a provider peer before the unavailable window is long enough", () => {
    expect(
      shouldRestartManualCacheProviderPeer({
        providerPeerId: "peer_owner",
        connectedPeerIds: [],
        unavailableSinceAt: 2_000,
        lastRestartAt: null,
        now: 7_000
      })
    ).toBe(false);
  });

  it("does not restart a provider peer while the restart cooldown is still active", () => {
    expect(
      shouldRestartManualCacheProviderPeer({
        providerPeerId: "peer_owner",
        connectedPeerIds: [],
        unavailableSinceAt: 0,
        lastRestartAt: 4_000,
        now: 8_000
      })
    ).toBe(false);
  });

  it("does not restart a provider peer that is already connected", () => {
    expect(
      shouldRestartManualCacheProviderPeer({
        providerPeerId: "peer_owner",
        connectedPeerIds: ["peer_owner"],
        unavailableSinceAt: 0,
        lastRestartAt: null,
        now: 10_000
      })
    ).toBe(false);
  });
});

function buildManualCacheRoomSnapshot(input: {
  ownerPeerId: string | null;
  ownerPresenceState?: "online" | "reconnecting" | "offline";
  omitTrackManifest?: boolean;
}): RoomSnapshot {
  return {
    room: {
      id: "room_1",
      hostId: "owner_1",
      joinCode: "ABCD12",
      visibility: "private",
      members: [
        {
          id: "owner_1",
          nickname: "owner",
          role: "host",
          joinedAt: new Date(0).toISOString(),
          peerId: input.ownerPeerId,
          presenceState: input.ownerPresenceState ?? "online"
        },
        {
          id: "listener_1",
          nickname: "listener",
          role: "member",
          joinedAt: new Date(0).toISOString(),
          peerId: "peer_local",
          presenceState: "online"
        }
      ],
      playback: {
        status: "paused",
        currentTrackId: null,
        currentQueueItemId: null,
        sourceSessionId: null,
        sourcePeerId: null,
        sourceTrackId: null,
        positionMs: 0,
        startedAt: null,
        queueVersion: 1,
        playbackRevision: 1,
        mediaEpoch: 0
      },
      presenceRevision: 1,
      roomRevision: 1
    },
    tracks: [
      {
        id: "track_a",
        title: "Track A",
        artist: "Artist",
        album: null,
        durationMs: 120_000,
        bitrate: null,
        sizeBytes: 4 * 128 * 1024,
        codec: null,
        mimeType: "audio/mpeg",
        fileHash: "hash_a",
        artworkUrl: null,
        ownerSessionId: "owner_1",
        ownerNickname: "owner",
        sourceType: "local_upload",
        pieceManifest: input.omitTrackManifest
          ? undefined
          : {
              totalChunks: 4,
              chunkSize: 128 * 1024,
              pieceMimeType: "audio/mpeg"
            },
        relayManifest: input.omitTrackManifest
          ? undefined
          : {
              totalChunks: 4,
              chunkSize: 128 * 1024,
              pieceMimeType: "audio/mpeg"
            }
      }
    ],
    queue: [],
    playlists: []
  };
}
