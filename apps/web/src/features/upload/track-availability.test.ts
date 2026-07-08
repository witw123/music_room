import { describe, expect, it } from "vitest";
import type { TrackMeta } from "@music-room/shared";
import { announceRoomTrackAvailability } from "./track-availability";

const track = {
  id: "track_1",
  title: "Cached",
  artist: "Artist",
  album: null,
  durationMs: 120_000,
  bitrate: null,
  sizeBytes: 4096,
  codec: "flac",
  mimeType: "audio/flac",
  fileHash: "hash_1",
  artworkUrl: null,
  ownerSessionId: "user_1",
  ownerNickname: "Host",
  sourceType: "local_upload" as const,
  pieceManifest: {
    totalChunks: 2,
    chunkSize: 1024,
    pieceMimeType: "audio/flac"
  },
  relayManifest: null
} satisfies TrackMeta;

describe("announceRoomTrackAvailability", () => {
  it("publishes uploaded file availability and records a ttl key", async () => {
    const file = new File(["cached"], "cached.flac", { type: "audio/flac" });
    const published: string[] = [];
    const ttl = new Map<string, number>();

    await announceRoomTrackAvailability({
      roomId: "room_1",
      roomTracks: [track],
      activeSession: { nickname: "Host" },
      peerId: "peer_1",
      trackId: "track_1",
      uploadedTrack: { file, objectUrl: "blob:uploaded", origin: "live-upload" },
      inFlightAnnouncements: new Set(),
      announcementTtl: ttl,
      nowMs: 10_000,
      getCachedLibraryTrackSummary: async () => null,
      getCachedLibraryTrack: async () => null,
      getTrackPieceManifestByFileHash: async () => null,
      getTrackPieceManifest: async () => null,
      buildTrackAvailabilityFromCache: async () => null,
      buildTrackAvailabilityFromManifest: (input) => ({
        roomId: input.roomId,
        trackId: input.trackId,
        ownerPeerId: input.peerId,
        nickname: input.nickname,
        totalChunks: 2,
        chunkSize: 1024,
        availableChunks: [0, 1],
        source: "live_upload",
        announcedAt: "2026-07-04T00:00:00.000Z"
      }),
      publishAvailability: (availability) => {
        published.push(`${availability.roomId}:${availability.trackId}`);
      }
    });

    expect(published).toEqual(["room_1:track_1"]);
    expect(ttl.get("room_1|track_1|hash_1|peer_1")).toBe(10_000);
  });

  it("skips repeated announcements inside the ttl window", async () => {
    const published: string[] = [];
    const ttl = new Map([["room_1|track_1|hash_1|peer_1", 8_000]]);

    await announceRoomTrackAvailability({
      roomId: "room_1",
      roomTracks: [track],
      activeSession: { nickname: "Host" },
      peerId: "peer_1",
      trackId: "track_1",
      uploadedTrack: null,
      inFlightAnnouncements: new Set(),
      announcementTtl: ttl,
      nowMs: 10_000,
      getCachedLibraryTrackSummary: async () => null,
      getCachedLibraryTrack: async () => null,
      getTrackPieceManifestByFileHash: async () => null,
      getTrackPieceManifest: async () => null,
      buildTrackAvailabilityFromCache: async () => {
        throw new Error("should not rebuild duplicate availability");
      },
      buildTrackAvailabilityFromManifest: () => {
        throw new Error("should not rebuild duplicate availability");
      },
      publishAvailability: (availability) => {
        published.push(`${availability.roomId}:${availability.trackId}`);
      }
    });

    expect(published).toEqual([]);
  });

  it("publishes partial cached-piece availability so room peers can relay cached chunks", async () => {
    const published: Array<{ chunks: number[]; totalChunks: number }> = [];
    const ttl = new Map<string, number>();

    const didPublish = await announceRoomTrackAvailability({
      roomId: "room_1",
      roomTracks: [track],
      activeSession: { nickname: "Listener" },
      peerId: "peer_listener",
      trackId: "track_1",
      uploadedTrack: null,
      inFlightAnnouncements: new Set(),
      announcementTtl: ttl,
      nowMs: 10_000,
      getCachedLibraryTrackSummary: async () => null,
      getCachedLibraryTrack: async () => null,
      getTrackPieceManifestByFileHash: async () => ({
        trackId: "track_1",
        fileHash: "hash_1",
        mimeType: "audio/flac",
        codec: "flac",
        sizeBytes: 4096,
        durationMs: 120_000,
        totalChunks: 2,
        chunkSize: 1024,
        updatedAt: "2026-07-08T00:00:00.000Z"
      }),
      getTrackPieceManifest: async () => null,
      buildTrackAvailabilityFromCache: async () => ({
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_listener",
        nickname: "Listener",
        totalChunks: 2,
        chunkSize: 1024,
        availableChunks: [0],
        source: "local_cache",
        announcedAt: "2026-07-08T00:00:00.000Z"
      }),
      buildTrackAvailabilityFromManifest: () => {
        throw new Error("partial cache should not require full-file fallback");
      },
      publishAvailability: (availability) => {
        published.push({
          chunks: availability.availableChunks,
          totalChunks: availability.totalChunks
        });
      }
    });

    expect(didPublish).toBe(true);
    expect(published).toEqual([{ chunks: [0], totalChunks: 2 }]);
    expect(ttl.get("room_1|track_1|hash_1|peer_listener")).toBe(10_000);
  });
});
