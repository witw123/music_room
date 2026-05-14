import { describe, expect, it, vi } from "vitest";
import type { RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import {
  ChunkScheduler,
  deriveTrackStreamProfile,
  getBackgroundChunks,
  getCurrentPlaybackWindowChunks,
  getUpcomingWindowChunks,
  selectChunkPeer
} from "./chunk-scheduler";

function buildAnnouncement(overrides: Partial<TrackAvailabilityAnnouncement>): TrackAvailabilityAnnouncement {
  const announcement: TrackAvailabilityAnnouncement = {
    roomId: "room_1",
    trackId: "track_1",
    ownerPeerId: "peer_a",
    nickname: "Peer A",
    totalChunks: 12,
    chunkSize: 128 * 1024,
    availableChunks: [0, 1, 2, 3, 4, 5],
    source: "local_cache",
    announcedAt: "2026-03-31T10:00:00.000Z",
    ...overrides
  };

  return {
    ...announcement,
    chunkSize: announcement.chunkSize ?? 128 * 1024
  };
}

function buildRoomSnapshot(): RoomSnapshot {
  return {
    room: {
      id: "room_1",
      hostId: "host_1",
      joinCode: "123456",
      visibility: "private",
      members: [
        {
          id: "host_1",
          nickname: "Host",
          role: "host",
          joinedAt: "2026-03-31T10:00:00.000Z",
          peerId: "peer_host",
          presenceState: "online"
        },
        {
          id: "member_1",
          nickname: "Member",
          role: "member",
          joinedAt: "2026-03-31T10:00:00.000Z",
          peerId: "peer_member",
          presenceState: "online"
        }
      ],
      presenceRevision: 1,
      playback: {
        status: "playing",
        currentTrackId: "track_1",
        currentQueueItemId: "queue_1",
        sourceSessionId: "host_1",
        sourcePeerId: "peer_host",
        sourceTrackId: "track_1",
        positionMs: 30_000,
        startedAt: "2026-03-31T10:00:00.000Z",
        queueVersion: 1,
        playbackRevision: 1,
        mediaEpoch: 1
      }
    },
    tracks: [
      {
        id: "track_1",
        title: "Current",
        artist: "Artist",
        album: null,
        durationMs: 120_000,
        bitrate: null,
        fileHash: "hash-current",
        artworkUrl: null,
        ownerSessionId: "host_1",
        ownerNickname: "Host",
        sourceType: "local_upload"
      },
      {
        id: "track_2",
        title: "Upcoming",
        artist: "Artist",
        album: null,
        durationMs: 180_000,
        bitrate: null,
        fileHash: "hash-upcoming",
        artworkUrl: null,
        ownerSessionId: "host_1",
        ownerNickname: "Host",
        sourceType: "local_upload"
      }
    ],
    queue: [
      { id: "queue_1", trackId: "track_1", requestedBy: "Host", requestedById: "host_1", position: 0, createdAt: "2026-03-31T10:00:00.000Z" },
      { id: "queue_2", trackId: "track_2", requestedBy: "Host", requestedById: "host_1", position: 1, createdAt: "2026-03-31T10:01:00.000Z" }
    ],
    playlists: []
  };
}

describe("chunk scheduler helpers", () => {
  it("builds a playback window around the current position", () => {
    expect(
      getCurrentPlaybackWindowChunks({
        durationMs: 120_000,
        totalChunks: 12,
        playbackPositionMs: 30_000,
        lookBehindMs: 5_000,
        lookAheadMs: 20_000
      })
    ).toEqual([2, 3, 4, 5]);
  });

  it("builds an upcoming prefetch window from the start of the track", () => {
    expect(
      getUpcomingWindowChunks({
        durationMs: 180_000,
        totalChunks: 18,
        prefetchMs: 12_000
      })
    ).toEqual([0, 1]);
  });

  it("builds a background batch from the earliest missing chunks", () => {
    expect(
      getBackgroundChunks({
        totalChunks: 8,
        ownedChunks: new Set([0, 1, 4]),
        pendingChunks: new Map([[2, { peerId: "peer_a", requestedAt: 1 }]]),
        batchSize: 3
      })
    ).toEqual([3, 5, 6]);
  });

  it("prefers the designated source peer when it can serve the chunk", () => {
    const selectedPeerId = selectChunkPeer({
      announcements: [
        buildAnnouncement({ ownerPeerId: "peer_a", availableChunks: [2, 3] }),
        buildAnnouncement({ ownerPeerId: "peer_host", availableChunks: [2, 3, 4] })
      ],
      chunkIndex: 2,
      connectedPeerIds: new Set(["peer_a", "peer_host"]),
      excludedPeerIds: new Set(["peer_local"]),
      preferredPeerId: "peer_host",
      peerLoads: new Map(),
      peerInFlightBytes: new Map(),
      chunkSize: 128 * 1024,
      maxConcurrentPerPeer: 3
    });

    expect(selectedPeerId).toBe("peer_host");
  });

  it("prefers canonical availability totals over stale snapshot piece manifests when scheduling", () => {
    const roomSnapshot = buildRoomSnapshot();
    roomSnapshot.tracks[0] = {
      ...roomSnapshot.tracks[0],
      pieceManifest: {
        totalChunks: 673,
        chunkSize: 64 * 1024,
        pieceMimeType: "audio/mpeg"
      }
    };
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      requestPiece: vi.fn(() => true)
    });

    scheduler.sync({
      roomSnapshot,
      availabilityByTrack: {
        track_1: {
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            totalChunks: 169,
            chunkSize: 256 * 1024,
            availableChunks: [0]
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 30_000
    });

    expect((scheduler as unknown as { getTotalChunks: (trackId: string) => number }).getTotalChunks("track_1")).toBe(169);
    expect((scheduler as unknown as { getTrackChunkSize: (trackId: string) => number }).getTrackChunkSize("track_1")).toBe(256 * 1024);
  });

  it("classifies large flac tracks as large-lossless", () => {
    expect(
      deriveTrackStreamProfile({
        id: "track_flac",
        title: "Lossless",
        artist: "Artist",
        album: null,
        durationMs: 180_000,
        bitrate: null,
        sizeBytes: 60 * 1024 * 1024,
        codec: "flac",
        fileHash: "hash-flac",
        artworkUrl: null,
        ownerSessionId: "host_1",
        ownerNickname: "Host",
        sourceType: "local_upload"
      })
    ).toBe("large-lossless");
  });
});

describe("ChunkScheduler", () => {
  it("prioritizes current playback chunks and respects per-peer concurrency", () => {
    const requestPiece = vi.fn(
      (args: { peerId: string; trackId: string; chunkIndex: number; totalChunks: number; priority: string }) =>
        true
    );
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      maxConcurrentCurrentTrack: 3,
      maxConcurrentUpcomingTrack: 1,
      maxConcurrentPerPeer: 2,
      requestPiece
    });

    scheduler.sync({
      roomSnapshot: buildRoomSnapshot(),
      availabilityByTrack: {
        track_1: {
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: [2, 3, 4, 5],
            totalChunks: 12
          })
        },
        track_2: {
          peer_host: buildAnnouncement({
            trackId: "track_2",
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: [0, 1, 2],
            totalChunks: 9
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 30_000
    });

    expect(requestPiece).toHaveBeenCalledTimes(3);
    expect(requestPiece.mock.calls.map(([call]) => call)).toEqual([
      expect.objectContaining({
        trackId: "track_1",
        priority: "current"
      }),
      expect.objectContaining({
        trackId: "track_1",
        priority: "current"
      }),
      expect.objectContaining({
        trackId: "track_1",
        priority: "current"
      })
    ]);
  });

  it("cools down timed-out peers before retrying on another source", async () => {
    vi.useFakeTimers();
    const requestPiece = vi.fn(
      (args: { peerId: string; trackId: string; chunkIndex: number; totalChunks: number; priority: string }) =>
        true
    );
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      peerCooldownMs: 10_000,
      maxConcurrentCurrentTrack: 1,
      maxConcurrentPerPeer: 1,
      requestPiece
    });

    scheduler.sync({
      roomSnapshot: buildRoomSnapshot(),
      availabilityByTrack: {
        track_1: {
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: [2, 3, 4]
          }),
          peer_seed: buildAnnouncement({
            ownerPeerId: "peer_seed",
            nickname: "Seed",
            availableChunks: [2, 3, 4],
            announcedAt: "2026-03-31T10:00:02.000Z"
          })
        }
      },
      connectedPeerIds: ["peer_host", "peer_seed"],
      uploadedTrackIds: [],
      playbackPositionMs: 30_000
    });

    expect(requestPiece).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: "peer_host", trackId: "track_1" })
    );

    scheduler.markRequestTimeout("track_1", 3, "peer_host");
    await vi.advanceTimersByTimeAsync(200);

    expect(requestPiece).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: "peer_seed", trackId: "track_1" })
    );
    vi.useRealTimers();
  });

  it("suppresses upcoming and background requests when buffer health is low", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      maxConcurrentCurrentTrack: 3,
      maxConcurrentUpcomingTrack: 2,
      maxConcurrentBackgroundTrack: 2,
      requestPiece
    });

    scheduler.sync({
      roomSnapshot: buildRoomSnapshot(),
      availabilityByTrack: {
        track_1: {
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: [2, 3, 4, 5, 6],
            totalChunks: 12
          })
        },
        track_2: {
          peer_host: buildAnnouncement({
            trackId: "track_2",
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: [0, 1, 2, 3],
            totalChunks: 9
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 30_000,
      bufferHealth: "low",
      playbackClockSource: "remote"
    });

    expect(requestPiece).toHaveBeenCalled();
    const priorities = (requestPiece.mock.calls as unknown as Array<[{
      priority: string;
    }]>).map(([call]) => call.priority);
    expect(priorities.every((priority) => priority === "current")).toBe(true);
  });

  it("uses startup current-track fetching for remote FLAC before startup is ready", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      requestPiece
    });
    const roomSnapshot = buildRoomSnapshot();
    roomSnapshot.tracks[0] = {
      ...roomSnapshot.tracks[0],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 60 * 1024 * 1024
    };
    roomSnapshot.tracks[1] = {
      ...roomSnapshot.tracks[1],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 48 * 1024 * 1024
    };

    scheduler.sync({
      roomSnapshot,
      availabilityByTrack: {
        track_1: {
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          })
        },
        track_2: {
          peer_host: buildAnnouncement({
            trackId: "track_2",
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 15_000,
      policy: "steady",
      bufferHealth: "healthy",
      playbackClockSource: "remote"
    });

    const requests = (requestPiece.mock.calls as unknown as Array<[{
      trackId: string;
      priority: string;
    }]>).map(([call]) => call);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.trackId === "track_1")).toBe(true);
    expect(requests.every((request) => request.priority === "current")).toBe(true);
  });

  it("prefetches the next queued track during steady playback when the current track is comfortably buffered", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      maxConcurrentCurrentTrack: 3,
      maxConcurrentUpcomingTrack: 3,
      maxConcurrentPerPeer: 3,
      requestPiece
    });
    const roomSnapshot = buildRoomSnapshot();
    roomSnapshot.tracks[0] = {
      ...roomSnapshot.tracks[0],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 60 * 1024 * 1024
    };
    roomSnapshot.tracks[1] = {
      ...roomSnapshot.tracks[1],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 48 * 1024 * 1024
    };

    scheduler.sync({
      roomSnapshot,
      availabilityByTrack: {
        track_1: {
          peer_member: buildAnnouncement({
            ownerPeerId: "peer_member",
            nickname: "Member",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          }),
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          })
        },
        track_2: {
          peer_host: buildAnnouncement({
            trackId: "track_2",
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 15_000,
      policy: "steady",
      bufferHealth: "healthy"
    });

    const requestedTrackIds = (requestPiece.mock.calls as unknown as Array<[{
      trackId: string;
      priority: string;
    }]>).map(([call]) => `${call.trackId}:${call.priority}`);
    expect(requestedTrackIds).toContain("track_2:upcoming");
  });

  it("allows a weak next-track prefetch once local playback is comfortably buffered", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      maxConcurrentCurrentTrack: 4,
      maxConcurrentUpcomingTrack: 3,
      maxConcurrentPerPeer: 4,
      requestPiece
    });
    const roomSnapshot = buildRoomSnapshot();
    roomSnapshot.tracks[0] = {
      ...roomSnapshot.tracks[0],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 60 * 1024 * 1024
    };
    roomSnapshot.tracks[1] = {
      ...roomSnapshot.tracks[1],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 48 * 1024 * 1024
    };

    scheduler.sync({
      roomSnapshot,
      availabilityByTrack: {
        track_1: {
          peer_member: buildAnnouncement({
            ownerPeerId: "peer_member",
            nickname: "Member",
            availableChunks: Array.from({ length: 10 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          }),
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          })
        },
        track_2: {
          peer_host: buildAnnouncement({
            trackId: "track_2",
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 15_000,
      policy: "steady",
      bufferHealth: "healthy",
      playbackClockSource: "remote"
    });

    const requestedTrackIds = (requestPiece.mock.calls as unknown as Array<[{
      trackId: string;
      priority: string;
    }]>).map(([call]) => `${call.trackId}:${call.priority}`);
    expect(requestedTrackIds).toContain("track_2:upcoming");
  });

  it("keeps remote bootstrap bounded while allowing deeper current-track fill", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      requestPiece
    });
    const roomSnapshot = buildRoomSnapshot();
    roomSnapshot.tracks[0] = {
      ...roomSnapshot.tracks[0],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 60 * 1024 * 1024
    };

    scheduler.sync({
      roomSnapshot,
      availabilityByTrack: {
        track_1: {
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 24 }, (_, index) => index),
            totalChunks: 24,
            chunkSize: 256 * 1024
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 15_000,
      policy: "startup",
      bufferHealth: "healthy",
      playbackClockSource: "remote",
      mode: "conservative"
    });

    expect(requestPiece.mock.calls.length).toBeGreaterThan(7);
    expect(requestPiece.mock.calls.length).toBeLessThanOrEqual(18);
    const requestedTrackIds = (requestPiece.mock.calls as unknown as Array<[{
      trackId: string;
      priority: string;
    }]>).map(([call]) => `${call.trackId}:${call.priority}`);
    expect(requestedTrackIds.every((item) => item === "track_1:current")).toBe(true);
  });

  it("suppresses next-track prefetch while outrun-recovery is active", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      maxConcurrentCurrentTrack: 4,
      maxConcurrentUpcomingTrack: 3,
      maxConcurrentPerPeer: 4,
      requestPiece
    });
    const roomSnapshot = buildRoomSnapshot();
    roomSnapshot.tracks[0] = {
      ...roomSnapshot.tracks[0],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 60 * 1024 * 1024
    };
    roomSnapshot.tracks[1] = {
      ...roomSnapshot.tracks[1],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 48 * 1024 * 1024
    };

    scheduler.sync({
      roomSnapshot,
      availabilityByTrack: {
        track_1: {
          peer_member: buildAnnouncement({
            ownerPeerId: "peer_member",
            nickname: "Member",
            availableChunks: Array.from({ length: 9 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          }),
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          })
        },
        track_2: {
          peer_host: buildAnnouncement({
            trackId: "track_2",
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 45_000,
      policy: "outrun-recovery",
      bufferHealth: "healthy"
    });

    const requestedTrackIds = (requestPiece.mock.calls as unknown as Array<[{
      trackId: string;
      priority: string;
    }]>).map(([call]) => `${call.trackId}:${call.priority}`);
    expect(requestedTrackIds.length).toBeGreaterThan(0);
    expect(requestedTrackIds.every((entry) => entry === "track_1:current")).toBe(true);
  });

  it("keeps downloading the full current FLAC once startup is satisfied and progressive local is unavailable", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      maxConcurrentCurrentTrack: 3,
      maxConcurrentPerPeer: 3,
      requestPiece
    });
    const roomSnapshot = buildRoomSnapshot();
    roomSnapshot.tracks[0] = {
      ...roomSnapshot.tracks[0],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 60 * 1024 * 1024
    };

    scheduler.sync({
      roomSnapshot,
      availabilityByTrack: {
        track_1: {
          peer_member: buildAnnouncement({
            ownerPeerId: "peer_member",
            nickname: "Member",
            availableChunks: [0, 1, 2, 3, 4, 5, 6, 7],
            totalChunks: 12,
            chunkSize: 256 * 1024
          }),
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 30_000,
      policy: "steady"
    });

    expect(requestPiece).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: "track_1",
        chunkIndex: 8,
        priority: "current"
      })
    );
  });

  it("continues backfilling the current track once steady playback is comfortably buffered", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      maxConcurrentCurrentTrack: 3,
      maxConcurrentPerPeer: 3,
      requestPiece
    });
    const roomSnapshot = buildRoomSnapshot();
    roomSnapshot.tracks[0] = {
      ...roomSnapshot.tracks[0],
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 60 * 1024 * 1024
    };

    scheduler.sync({
      roomSnapshot,
      availabilityByTrack: {
        track_1: {
          peer_member: buildAnnouncement({
            ownerPeerId: "peer_member",
            nickname: "Member",
            availableChunks: Array.from({ length: 10 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          }),
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 256 * 1024
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 15_000,
      policy: "steady",
      bufferHealth: "healthy"
    });

    const requestedCurrentChunks = (requestPiece.mock.calls as unknown as Array<[{
      trackId: string;
      chunkIndex: number;
      priority: string;
    }]>)
      .map(([call]) => call)
      .filter((call) => call.trackId === "track_1" && call.priority === "current")
      .map((call) => call.chunkIndex);

    expect(requestedCurrentChunks).toEqual(expect.arrayContaining([10, 11]));
  });

  it("does not schedule manual cache chunks because manual cache owns its downloader", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_listener", {
      now: () => 1_000,
      requestPiece
    });
    const roomSnapshot = buildRoomSnapshot();

    scheduler.sync({
      roomSnapshot,
      availabilityByTrack: {
        track_2: {
          peer_provider: buildAnnouncement({
            trackId: "track_2",
            ownerPeerId: "peer_provider",
            nickname: "Provider",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12,
            chunkSize: 128 * 1024
          })
        }
      },
      connectedPeerIds: ["peer_provider"],
      uploadedTrackIds: [],
      manualTrackIds: ["track_2"],
      playbackPositionMs: 0,
      mode: "idle"
    });

    expect(requestPiece).not.toHaveBeenCalled();
  });

  it("releases pending chunks and switches peer when a peer becomes unavailable", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      maxConcurrentCurrentTrack: 1,
      maxConcurrentPerPeer: 1,
      requestPiece
    });

    scheduler.sync({
      roomSnapshot: buildRoomSnapshot(),
      availabilityByTrack: {
        track_1: {
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: [2, 3, 4]
          }),
          peer_seed: buildAnnouncement({
            ownerPeerId: "peer_seed",
            nickname: "Seed",
            availableChunks: [2, 3, 4],
            announcedAt: "2026-03-31T10:00:02.000Z"
          })
        }
      },
      connectedPeerIds: ["peer_host", "peer_seed"],
      uploadedTrackIds: [],
      playbackPositionMs: 30_000
    });

    expect(requestPiece).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: "peer_host", trackId: "track_1" })
    );

    scheduler.markPeerUnavailable("peer_host");

    expect(requestPiece).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: "peer_seed", trackId: "track_1" })
    );
  });

  it("avoids unstable peers for current playback and prefers healthy low-buffer peers", () => {
    const selectedPeerId = selectChunkPeer({
      announcements: [
        buildAnnouncement({
          ownerPeerId: "peer_unstable",
          availableChunks: [2, 3, 4],
          announcedAt: "2026-03-31T10:00:03.000Z"
        }),
        buildAnnouncement({
          ownerPeerId: "peer_healthy",
          availableChunks: [2],
          announcedAt: "2026-03-31T10:00:01.000Z"
        })
      ],
      chunkIndex: 2,
      connectedPeerIds: new Set(["peer_unstable", "peer_healthy"]),
      excludedPeerIds: new Set(["peer_member"]),
      preferredPeerId: "peer_unstable",
      peerLoads: new Map(),
      peerInFlightBytes: new Map(),
      chunkSize: 128 * 1024,
      maxConcurrentPerPeer: 3,
      priority: "current",
      resolvePeerRequestWindow: (peerId) =>
        peerId === "peer_unstable"
          ? { transportScore: "unstable", bufferedAmountBytes: 900 * 1024 }
          : { transportScore: "healthy", bufferedAmountBytes: 0, downloadRateKbps: 3_000 }
    });

    expect(selectedPeerId).toBe("peer_healthy");
  });

  it("keeps background hidden playback focused on current chunks", () => {
    const requestPiece = vi.fn(() => true);
    const scheduler = new ChunkScheduler("peer_member", {
      now: () => 1_000,
      maxConcurrentCurrentTrack: 2,
      maxConcurrentPerPeer: 2,
      requestPiece
    });
    const roomSnapshot = buildRoomSnapshot();
    roomSnapshot.tracks.push({
      id: "track_3",
      title: "Background",
      artist: "Artist",
      album: null,
      durationMs: 180_000,
      bitrate: null,
      fileHash: "hash-background",
      artworkUrl: null,
      ownerSessionId: "host_1",
      ownerNickname: "Host",
      sourceType: "local_upload"
    });

    scheduler.sync({
      roomSnapshot,
      availabilityByTrack: {
        track_1: {
          peer_host: buildAnnouncement({
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12
          })
        },
        track_2: {
          peer_host: buildAnnouncement({
            trackId: "track_2",
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12
          })
        },
        track_3: {
          peer_host: buildAnnouncement({
            trackId: "track_3",
            ownerPeerId: "peer_host",
            nickname: "Host",
            availableChunks: Array.from({ length: 12 }, (_, index) => index),
            totalChunks: 12
          })
        }
      },
      connectedPeerIds: ["peer_host"],
      uploadedTrackIds: [],
      playbackPositionMs: 30_000,
      playbackStatus: "playing",
      pageVisible: false,
      policy: "background",
      bufferHealth: "healthy"
    });

    const priorities = (requestPiece.mock.calls as unknown as Array<[{
      priority: string;
    }]>).map(([call]) => call.priority);

    expect(priorities.length).toBeGreaterThan(0);
    expect(priorities.every((priority) => priority === "current")).toBe(true);
  });
});
