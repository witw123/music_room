import { describe, expect, it, vi } from "vitest";
import type { RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import {
  ChunkScheduler,
  getBackgroundChunks,
  getCurrentPlaybackWindowChunks,
  getUpcomingWindowChunks,
  selectChunkPeer
} from "./chunk-scheduler";

function buildAnnouncement(overrides: Partial<TrackAvailabilityAnnouncement>): TrackAvailabilityAnnouncement {
  return {
    roomId: "room_1",
    trackId: "track_1",
    ownerPeerId: "peer_a",
    nickname: "Peer A",
    totalChunks: 12,
    availableChunks: [0, 1, 2, 3, 4, 5],
    source: "local_cache",
    announcedAt: "2026-03-31T10:00:00.000Z",
    ...overrides
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
        { id: "host_1", nickname: "Host", role: "host", joinedAt: "2026-03-31T10:00:00.000Z", peerId: "peer_host" },
        { id: "member_1", nickname: "Member", role: "member", joinedAt: "2026-03-31T10:00:00.000Z", peerId: "peer_member" }
      ],
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
      maxConcurrentPerPeer: 3
    });

    expect(selectedPeerId).toBe("peer_host");
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

    expect(requestPiece).toHaveBeenCalledTimes(2);
    expect(requestPiece.mock.calls.map(([call]) => call)).toEqual([
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

  it("cools down timed-out peers before retrying on another source", () => {
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

    scheduler.markRequestTimeout("track_1", 2, "peer_host");

    expect(requestPiece).toHaveBeenLastCalledWith(
      expect.objectContaining({ peerId: "peer_seed", trackId: "track_1" })
    );
  });
});
