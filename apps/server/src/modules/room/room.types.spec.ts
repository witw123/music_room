import {
  deserializeRoomRecord,
  serializePlaybackForPersistence,
  type PersistedRoomRecord
} from "./room.types";

describe("room.types persistence helpers", () => {
  it("serializes presenceRevision into the persisted playback payload", () => {
    expect(
      serializePlaybackForPersistence({
        presenceRevision: 7,
        roomRevision: 11,
        playback: {
          status: "paused",
          currentTrackId: null,
          currentQueueItemId: null,
          sourceSessionId: "host_1",
          sourcePeerId: null,
          sourceTrackId: null,
          positionMs: 0,
          startedAt: null,
          queueVersion: 3,
          mediaEpoch: 1
        }
      })
    ).toMatchObject({
      queueVersion: 3,
      mediaEpoch: 1,
      presenceRevision: 7,
      roomRevision: 11
    });
  });

  it("restores presenceRevision from persisted playback when the top-level field is absent", () => {
    const record = deserializeRoomRecord({
      id: "room_1",
      hostId: "host_1",
      joinCode: "ABC123",
      visibility: "public",
      playback: {
        status: "paused",
        currentTrackId: null,
        currentQueueItemId: null,
        sourceSessionId: "host_1",
        sourcePeerId: null,
        sourceTrackId: null,
        positionMs: 0,
        startedAt: null,
        queueVersion: 2,
        mediaEpoch: 0,
        presenceRevision: 5,
        roomRevision: 9
      },
      members: [],
      tracks: [],
      queue: []
    } satisfies PersistedRoomRecord);

    expect(record.room.presenceRevision).toBe(5);
    expect(record.room.roomRevision).toBe(9);
  });
});
