import { describe, expect, it } from "vitest";
import {
  buildLocalPieceAvailabilityAnnouncement,
  upsertAvailabilityAnnouncement
} from "./availability-state";

describe("availability-state helpers", () => {
  it("builds the next local availability announcement incrementally", () => {
    const nextAnnouncement = buildLocalPieceAvailabilityAnnouncement({
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_local",
      nickname: "Listener",
      chunkIndex: 3,
      totalChunks: 8,
      chunkSize: 128 * 1024
    });

    expect(nextAnnouncement).toMatchObject({
      trackId: "track_1",
      ownerPeerId: "peer_local",
      totalChunks: 8,
      chunkSize: 128 * 1024,
      availableChunks: [3],
      source: "local_cache"
    });
  });

  it("reuses the previous announcement shape and appends only the new chunk", () => {
    const existing = {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_local",
      nickname: "Listener",
      totalChunks: 8,
      chunkSize: 128 * 1024,
      availableChunks: [0, 1, 2],
      source: "local_cache" as const,
      announcedAt: "2026-04-03T16:30:00.000Z"
    };

    const nextAnnouncement = buildLocalPieceAvailabilityAnnouncement({
      existing,
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_local",
      nickname: "Listener",
      chunkIndex: 3,
      totalChunks: 8,
      chunkSize: 128 * 1024
    });

    expect(nextAnnouncement.availableChunks).toEqual([0, 1, 2, 3]);
    expect(nextAnnouncement.totalChunks).toBe(8);
    expect(nextAnnouncement.source).toBe("local_cache");
  });

  it("deduplicates identical announcements by peer", () => {
    const current = {
      track_1: {
        peer_local: {
          roomId: "room_1",
          trackId: "track_1",
          ownerPeerId: "peer_local",
          nickname: "Listener",
          totalChunks: 8,
          chunkSize: 128 * 1024,
          availableChunks: [0, 1, 2, 3],
          source: "local_cache" as const,
          announcedAt: "2026-04-03T16:30:00.000Z"
        }
      }
    };

    const next = upsertAvailabilityAnnouncement(current, current.track_1.peer_local);
    expect(next).toBe(current);
  });
});
