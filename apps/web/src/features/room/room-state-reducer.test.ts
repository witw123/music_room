import { describe, expect, it } from "vitest";
import type { PlaybackSnapshot, RoomSnapshot } from "@music-room/shared";
import {
  initialRoomStateStore,
  roomStateReducer,
  type RoomStateStore
} from "./room-state-reducer";

function createPlaybackSnapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
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
    mediaEpoch: 1,
    ...overrides
  };
}

function createRoomSnapshot(
  overrides: {
    room?: Partial<RoomSnapshot["room"]>;
    tracks?: RoomSnapshot["tracks"];
    queue?: RoomSnapshot["queue"];
    playlists?: RoomSnapshot["playlists"];
  } = {}
): RoomSnapshot {
  const { room: roomOverrides, tracks, queue, playlists } = overrides;
  const playback = createPlaybackSnapshot(roomOverrides?.playback);

  return {
    room: {
      id: "room_1",
      hostId: "host",
      joinCode: "ABC123",
      visibility: "public",
      members: [
        {
          id: "host",
          nickname: "Host",
          role: "host",
          joinedAt: "2026-04-04T00:00:00.000Z",
          peerId: "peer-host",
          presenceState: "online"
        },
        {
          id: "member",
          nickname: "Member",
          role: "member",
          joinedAt: "2026-04-04T00:01:00.000Z",
          peerId: null,
          presenceState: "offline"
        }
      ],
      presenceRevision: 1,
      roomRevision: 1,
      playback,
      ...roomOverrides
    },
    tracks: tracks ?? [
      {
        id: "track_1",
        ownerSessionId: "host",
        title: "Track 1",
        artist: "Artist 1",
        album: null,
        durationMs: 120_000,
        bitrate: 320_000,
        fileHash: "hash_1",
        mimeType: "audio/mpeg",
        codec: null,
        sizeBytes: 1024,
        artworkUrl: null,
        ownerNickname: "Host",
        sourceType: "local_upload"
      }
    ],
    queue: queue ?? [
      {
        id: "queue_1",
        trackId: "track_1",
        requestedBy: "Host",
        requestedById: "host",
        position: 0,
        createdAt: "2026-04-04T00:00:00.000Z"
      }
    ],
    playlists: playlists ?? []
  };
}

function applyEvents(...events: Parameters<typeof roomStateReducer>[1][]) {
  return events.reduce<RoomStateStore>(roomStateReducer, initialRoomStateStore);
}

describe("roomStateReducer", () => {
  it("applies subscribe bootstrap playback and minimal topology before the authoritative snapshot arrives", () => {
    const initial = createRoomSnapshot({
      room: {
        roomRevision: 3,
        presenceRevision: 3,
        members: [
          {
            id: "host",
            nickname: "Host",
            role: "host",
            joinedAt: "2026-04-04T00:00:00.000Z",
            peerId: "peer-host",
            presenceState: "online"
          },
          {
            id: "member",
            nickname: "Member",
            role: "member",
            joinedAt: "2026-04-04T00:01:00.000Z",
            peerId: null,
            presenceState: "offline"
          }
        ]
      }
    });

    const state = applyEvents(
      {
        type: "server-snapshot",
        snapshot: initial
      },
      {
        type: "subscribe-bootstrap",
        roomId: "room_1",
        members: [
          {
            id: "host",
            nickname: "Host",
            role: "host",
            joinedAt: "2026-04-04T00:00:00.000Z",
            peerId: "peer-host",
            presenceState: "online"
          },
          {
            id: "member",
            nickname: "Member",
            role: "member",
            joinedAt: "2026-04-04T00:01:00.000Z",
            peerId: "peer-member",
            presenceState: "online"
          }
        ],
        playback: createPlaybackSnapshot({
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer-host",
          positionMs: 32_000,
          startedAt: "2026-04-04T00:02:00.000Z",
          queueVersion: 2,
          playbackRevision: 2,
          mediaEpoch: 2
        }),
        presenceRevision: 4,
        roomRevision: 4
      }
    );

    expect(state.snapshot?.room.playback.status).toBe("playing");
    expect(state.snapshot?.room.playback.positionMs).toBe(32_000);
    expect(state.snapshot?.room.members[1]?.peerId).toBe("peer-member");
    expect(state.snapshot?.room.presenceRevision).toBe(4);
    expect(state.snapshot?.room.roomRevision).toBe(4);
  });

  it("uses bootstrap handoff as placeholder but lets the first authoritative snapshot replace it", () => {
    const bootstrap = createRoomSnapshot({
      room: {
        roomRevision: 2
      },
      queue: []
    });
    const authoritative = createRoomSnapshot({
      room: {
        roomRevision: 2
      }
    });

    const state = applyEvents(
      {
        type: "bootstrap-handoff",
        snapshot: bootstrap
      },
      {
        type: "server-snapshot",
        snapshot: authoritative
      }
    );

    expect(state.source).toBe("authoritative");
    expect(state.snapshot?.queue).toHaveLength(1);
  });

  it("ignores stale full snapshots by roomRevision", () => {
    const current = createRoomSnapshot({
      room: {
        roomRevision: 5
      }
    });
    const stale = createRoomSnapshot({
      room: {
        roomRevision: 4,
        members: [
          {
            id: "host",
            nickname: "Host",
            role: "host",
            joinedAt: "2026-04-04T00:00:00.000Z",
            peerId: null,
            presenceState: "offline"
          }
        ]
      }
    });

    const state = applyEvents(
      {
        type: "server-snapshot",
        snapshot: current
      },
      {
        type: "server-snapshot",
        snapshot: stale
      }
    );

    expect(state.snapshot?.room.roomRevision).toBe(5);
    expect(state.snapshot?.room.members).toHaveLength(2);
  });

  it("does not let an older authoritative snapshot rewind a newer playback patch", () => {
    const initial = createRoomSnapshot({
      room: {
        roomRevision: 5,
        playback: createPlaybackSnapshot({
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer-host",
          sourceTrackId: "track_1",
          positionMs: 10_000,
          startedAt: "2026-04-17T00:00:00.000Z",
          queueVersion: 4,
          playbackRevision: 4,
          mediaEpoch: 2
        })
      }
    });
    const seekPatch = createPlaybackSnapshot({
      status: "playing",
      currentTrackId: "track_1",
      currentQueueItemId: "queue_1",
      sourceSessionId: "host",
      sourcePeerId: "peer-host",
      sourceTrackId: "track_1",
      positionMs: 60_000,
      startedAt: "2026-04-17T00:00:05.000Z",
      queueVersion: 5,
      playbackRevision: 5,
      mediaEpoch: 2
    });
    const staleSnapshot = createRoomSnapshot({
      room: {
        roomRevision: 5,
        playback: initial.room.playback
      }
    });

    const state = applyEvents(
      {
        type: "server-snapshot",
        snapshot: initial
      },
      {
        type: "server-playback-patch",
        roomId: "room_1",
        playback: seekPatch
      },
      {
        type: "recover-snapshot",
        snapshot: staleSnapshot
      }
    );

    expect(state.snapshot?.room.playback.positionMs).toBe(60_000);
    expect(state.snapshot?.room.playback.playbackRevision).toBe(5);
  });

  it("applies only newer presence patches and advances roomRevision", () => {
    const state = applyEvents(
      {
        type: "server-snapshot",
        snapshot: createRoomSnapshot({
          room: {
            roomRevision: 7,
            presenceRevision: 9
          }
        })
      },
      {
        type: "server-presence-patch",
        roomId: "room_1",
        members: [
          {
            id: "host",
            nickname: "Host",
            role: "host",
            joinedAt: "2026-04-04T00:00:00.000Z",
            peerId: "peer-host",
            presenceState: "online"
          },
          {
            id: "member",
            nickname: "Member",
            role: "member",
            joinedAt: "2026-04-04T00:01:00.000Z",
            peerId: "peer-member",
            presenceState: "online"
          }
        ],
        playback: createPlaybackSnapshot({
          queueVersion: 2,
          sourceSessionId: "member"
        }),
        presenceRevision: 10,
        roomRevision: 8
      }
    );

    expect(state.snapshot?.room.presenceRevision).toBe(10);
    expect(state.snapshot?.room.roomRevision).toBe(8);
    expect(state.snapshot?.room.members.filter((member) => member.presenceState === "online")).toHaveLength(2);
  });

  it("ignores stale presence patches even if they arrive after a newer authoritative snapshot", () => {
    const state = applyEvents(
      {
        type: "server-snapshot",
        snapshot: createRoomSnapshot({
          room: {
            roomRevision: 11,
            presenceRevision: 12,
            members: [
              {
                id: "host",
                nickname: "Host",
                role: "host",
                joinedAt: "2026-04-04T00:00:00.000Z",
                peerId: "peer-host",
                presenceState: "online"
              },
              {
                id: "member",
                nickname: "Member",
                role: "member",
                joinedAt: "2026-04-04T00:01:00.000Z",
                peerId: "peer-member",
                presenceState: "online"
              }
            ]
          }
        })
      },
      {
        type: "server-presence-patch",
        roomId: "room_1",
        members: [
          {
            id: "host",
            nickname: "Host",
            role: "host",
            joinedAt: "2026-04-04T00:00:00.000Z",
            peerId: "peer-host",
            presenceState: "online"
          },
          {
            id: "member",
            nickname: "Member",
            role: "member",
            joinedAt: "2026-04-04T00:01:00.000Z",
            peerId: null,
            presenceState: "offline"
          }
        ],
        playback: createPlaybackSnapshot({
          queueVersion: 1
        }),
        presenceRevision: 11,
        roomRevision: 10
      }
    );

    expect(state.snapshot?.room.members[1]?.presenceState).toBe("online");
    expect(state.snapshot?.room.presenceRevision).toBe(12);
  });

  it("updates queue and library only when patch roomRevision is not stale", () => {
    const state = applyEvents(
      {
        type: "server-snapshot",
        snapshot: createRoomSnapshot({
          room: {
            roomRevision: 3
          }
        })
      },
      {
        type: "server-queue-patch",
        roomId: "room_1",
        queue: [],
        playback: createPlaybackSnapshot({
          queueVersion: 2
        }),
        roomRevision: 2
      },
      {
        type: "server-library-patch",
        roomId: "room_1",
        tracks: [
          {
            id: "track_2",
            ownerSessionId: "member",
            title: "Track 2",
            artist: "Artist 2",
            album: null,
            durationMs: 240_000,
            bitrate: 256_000,
            fileHash: "hash_2",
            mimeType: "audio/mpeg",
            codec: null,
            sizeBytes: 2048,
            artworkUrl: null,
            ownerNickname: "Member",
            sourceType: "local_upload"
          }
        ],
        queue: [],
        playback: createPlaybackSnapshot({
          currentTrackId: "track_2",
          queueVersion: 3
        }),
        roomRevision: 4
      }
    );

    expect(state.snapshot?.room.roomRevision).toBe(4);
    expect(state.snapshot?.tracks[0]?.id).toBe("track_2");
    expect(state.snapshot?.queue).toHaveLength(0);
  });

  it("keeps playback patches ordered by playbackRevision", () => {
    const state = applyEvents(
      {
        type: "server-snapshot",
        snapshot: createRoomSnapshot({
          room: {
            roomRevision: 2,
            playback: createPlaybackSnapshot({
              status: "paused",
              queueVersion: 3,
              playbackRevision: 3
            })
          }
        })
      },
      {
        type: "server-playback-patch",
        roomId: "room_1",
        playback: createPlaybackSnapshot({
          status: "playing",
          queueVersion: 4,
          playbackRevision: 2
        })
      },
      {
        type: "server-playback-patch",
        roomId: "room_1",
        playback: createPlaybackSnapshot({
          status: "playing",
          queueVersion: 3,
          playbackRevision: 4
        })
      }
    );

    expect(state.snapshot?.room.playback.status).toBe("playing");
    expect(state.snapshot?.room.playback.queueVersion).toBe(3);
    expect(state.snapshot?.room.playback.playbackRevision).toBe(4);
  });
});
