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
          playbackRevision: 3,
          mediaEpoch: 1
        }
      })
    ).toMatchObject({
      queueVersion: 3,
      playbackRevision: 3,
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
        playbackRevision: 2,
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
    expect(record.room.playback.playbackRevision).toBe(2);
  });

  it("restores room and member permissions from the persisted playback payload", () => {
    const record = deserializeRoomRecord({
      id: "room_permissions",
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
        queueVersion: 1,
        playbackRevision: 1,
        mediaEpoch: 0,
        newMemberPermissions: { library: false, queue: true, player: false },
        memberPermissionProfiles: {
          member_1: { library: true, queue: false, player: true }
        }
      },
      members: [],
      tracks: [],
      queue: []
    } satisfies PersistedRoomRecord);

    expect(record.room.newMemberPermissions).toEqual({
      library: false,
      queue: true,
      player: false
    });
    expect(record.memberPermissionProfiles).toEqual({
      member_1: { library: true, queue: false, player: true }
    });
  });

  it("persists and restores the remaining shuffle bag", () => {
    const playback = {
      status: "paused" as const,
      currentTrackId: "track_3",
      currentQueueItemId: "queue_3",
      sourceSessionId: "host_1",
      sourcePeerId: null,
      sourceTrackId: "track_3",
      positionMs: 0,
      startedAt: null,
      queueVersion: 3,
      playbackRevision: 4,
      mediaEpoch: 1,
      playbackMode: "shuffle" as const,
      shuffleBagTrackIds: ["track_1", "track_2"]
    };
    const persisted = serializePlaybackForPersistence({
      presenceRevision: 0,
      roomRevision: 8,
      playback
    });
    const record = deserializeRoomRecord({
      id: "room_shuffle",
      hostId: "host_1",
      joinCode: "ABC123",
      visibility: "public",
      playback: persisted,
      members: [],
      tracks: [],
      queue: []
    } satisfies PersistedRoomRecord);

    expect(record.room.playback.shuffleBagTrackIds).toEqual(["track_1", "track_2"]);
  });

  it("keeps legacy rooms visible when their playback asset profile is obsolete", () => {
    const record = deserializeRoomRecord({
      id: "room_legacy",
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
        queueVersion: 1,
        playbackRevision: 1,
        mediaEpoch: 0
      },
      members: [],
      tracks: [{
        id: "track_legacy",
        title: "Legacy track",
        artist: "Artist",
        album: null,
        durationMs: 120_000,
        bitrate: 192_000,
        sizeBytes: 1_000,
        codec: "mp3",
        mimeType: "audio/mpeg",
        fileHash: "a".repeat(64),
        artworkUrl: null,
        ownerSessionId: "host_1",
        ownerNickname: "Host",
        sourceType: "local_upload",
        playbackAsset: {
          kind: "playback",
          assetId: "b".repeat(64),
          profileId: "opus-music-v2",
          codec: "opus",
          container: "audio/ogg",
          sampleRate: 48_000,
          channels: 2,
          bitrate: 192_000,
          durationMs: 120_000,
          segmentDurationMs: 2_000,
          seekPrerollMs: 80,
          unitCount: 60,
          merkleRoot: "c".repeat(64),
          encoder: { name: "@audio/opus-encode", version: "2.0.0" }
        }
      }],
      queue: [{
        id: "queue_legacy",
        trackId: "track_legacy",
        requestedBy: "Host",
        requestedById: "host_1",
        position: 0,
        createdAt: "2026-01-01T00:00:00.000Z"
      }]
    } satisfies PersistedRoomRecord);

    expect(record.room.id).toBe("room_legacy");
    expect(record.tracks).toHaveLength(1);
    expect(record.tracks[0]?.playbackAsset).toBeUndefined();
    expect(record.queue).toHaveLength(1);
  });
});
