import { describe, expect, it } from "vitest";
import { roomSnapshotSchema } from "./models";

describe("roomSnapshotSchema", () => {
  it("parses a valid room snapshot", () => {
    const result = roomSnapshotSchema.safeParse({
      room: {
        id: "room_1",
        hostId: "guest_1",
        joinCode: "ABC123",
        visibility: "private",
        members: [
          {
            id: "guest_1",
            nickname: "Host",
            role: "host",
            joinedAt: new Date().toISOString(),
            peerId: null
          }
        ],
        playback: {
          status: "paused",
          currentTrackId: null,
          currentQueueItemId: null,
          sourceSessionId: "guest_1",
          sourcePeerId: null,
          sourceTrackId: null,
          positionMs: 0,
          startedAt: null,
          queueVersion: 1,
          mediaEpoch: 0
        }
      },
      tracks: [],
      queue: [],
      playlists: []
    });

    expect(result.success).toBe(true);
  });
});
