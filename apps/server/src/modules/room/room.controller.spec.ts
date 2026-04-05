import type { Room, RoomSnapshot } from "@music-room/shared";
import { RoomController } from "./room.controller";

function buildSnapshot(overrides?: Partial<Room>): RoomSnapshot {
  return {
    room: {
      id: "room_1",
      hostId: "guest_host",
      joinCode: "ABC123",
      visibility: "private",
      members: [
        {
          id: "guest_host",
          nickname: "Host",
          role: "host",
          joinedAt: new Date().toISOString(),
          peerId: null,
          presenceState: "offline"
        }
      ],
      presenceRevision: 0,
      roomRevision: 0,
      playback: {
        status: "paused",
        currentTrackId: null,
        currentQueueItemId: null,
        sourceSessionId: "guest_host",
        sourcePeerId: null,
        sourceTrackId: null,
        positionMs: 0,
        startedAt: null,
        queueVersion: 1,
        playbackRevision: 1,
        mediaEpoch: 0
      },
      ...overrides
    },
    tracks: [],
    queue: [],
    playlists: []
  };
}

function createRoomRealtimePublisherMock() {
  return {
    emitSnapshot: jest.fn(),
    emitTopologySnapshot: jest.fn(),
    emitRoomDeleted: jest.fn(),
    emitRoomMissing: jest.fn(),
    emitLibrarySnapshot: jest.fn()
  };
}

describe("RoomController", () => {
  function createAuthServiceMock() {
    return {
      getAuthSessionByTokenOrThrow: jest.fn().mockResolvedValue({
        id: "guest_host",
        userId: "guest_host",
        username: "host",
        nickname: "Host",
        token: "token",
        createdAt: new Date().toISOString()
      })
    };
  }

  function createPlaylistServiceMock() {
    return {
      listPlaylistsForRoom: jest.fn().mockResolvedValue([]),
      deletePlaylistsForRoom: jest.fn().mockResolvedValue(undefined),
      removeTrackFromPlaylists: jest.fn().mockResolvedValue(undefined)
    };
  }

  it("returns the recent room snapshot for a session", async () => {
    const snapshot = buildSnapshot();
    const roomService = {
      getRecentRoomSnapshotForSession: jest.fn().mockResolvedValue(snapshot)
    };
    const roomRealtimePublisher = createRoomRealtimePublisherMock();
    const authService = createAuthServiceMock();
    const playlistService = createPlaylistServiceMock();
    const controller = new RoomController(
      roomService as never,
      roomRealtimePublisher as never,
      authService as never,
      playlistService as never
    );

    await expect(controller.getRecentRoom("token")).resolves.toEqual(snapshot);
    expect(authService.getAuthSessionByTokenOrThrow).toHaveBeenCalledWith("token");
    expect(roomService.getRecentRoomSnapshotForSession).toHaveBeenCalledWith("guest_host");
  });

  it("returns a recoverable room snapshot for a valid member", async () => {
    const snapshot = buildSnapshot();
    const roomService = {
      getRecoverableRoomSnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const roomRealtimePublisher = createRoomRealtimePublisherMock();
    const authService = createAuthServiceMock();
    const playlistService = createPlaylistServiceMock();
    const controller = new RoomController(
      roomService as never,
      roomRealtimePublisher as never,
      authService as never,
      playlistService as never
    );

    await expect(controller.recoverRoom("room_1", "token")).resolves.toEqual(snapshot);
    expect(authService.getAuthSessionByTokenOrThrow).toHaveBeenCalledWith("token");
    expect(roomService.getRecoverableRoomSnapshot).toHaveBeenCalledWith("room_1", "guest_host");
  });

  it("emits a topology snapshot after leave even when only the offline host remains", async () => {
    const emptyRoom = buildSnapshot({ members: [] }).room;
    const roomService = {
      leaveRoom: jest.fn().mockResolvedValue(emptyRoom)
    };
    const roomRealtimePublisher = createRoomRealtimePublisherMock();
    const authService = createAuthServiceMock();
    const playlistService = createPlaylistServiceMock();
    const controller = new RoomController(
      roomService as never,
      roomRealtimePublisher as never,
      authService as never,
      playlistService as never
    );

    const result = await controller.leaveRoom("room_1", "token");

    expect(result).toEqual(emptyRoom);
    expect(authService.getAuthSessionByTokenOrThrow).toHaveBeenCalledWith("token");
    expect(roomRealtimePublisher.emitTopologySnapshot).toHaveBeenCalledWith("room_1");
  });

  it("emits a topology snapshot after joining by code", async () => {
    const snapshot = buildSnapshot();
    const roomService = {
      findRoomByJoinCode: jest.fn().mockResolvedValue(snapshot.room),
      joinRoom: jest.fn().mockResolvedValue(snapshot.room)
    };
    const roomRealtimePublisher = {
      ...createRoomRealtimePublisherMock(),
      emitTopologySnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const authService = createAuthServiceMock();
    const playlistService = createPlaylistServiceMock();
    const controller = new RoomController(
      roomService as never,
      roomRealtimePublisher as never,
      authService as never,
      playlistService as never
    );

    const result = await controller.joinRoomByCode("token", {
      joinCode: "abc123"
    });

    expect(result).toEqual(snapshot);
    expect(authService.getAuthSessionByTokenOrThrow).toHaveBeenCalledWith("token");
    expect(roomService.findRoomByJoinCode).toHaveBeenCalledWith("abc123");
    expect(roomService.joinRoom).toHaveBeenCalledWith(snapshot.room.id, "guest_host");
    expect(roomRealtimePublisher.emitTopologySnapshot).toHaveBeenCalledWith(snapshot.room.id);
  });

  it("emits a topology snapshot after a member leaves an existing room", async () => {
    const snapshot = buildSnapshot({
      members: [
        {
          id: "guest_host",
          nickname: "Host",
          role: "host",
          joinedAt: new Date().toISOString(),
          peerId: "peer_host",
          presenceState: "online"
        }
      ],
      presenceRevision: 3,
      roomRevision: 5
    });
    const roomService = {
      leaveRoom: jest.fn().mockResolvedValue(snapshot.room)
    };
    const roomRealtimePublisher = {
      ...createRoomRealtimePublisherMock(),
      emitTopologySnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const authService = createAuthServiceMock();
    const playlistService = createPlaylistServiceMock();
    const controller = new RoomController(
      roomService as never,
      roomRealtimePublisher as never,
      authService as never,
      playlistService as never
    );

    const result = await controller.leaveRoom("room_1", "token");

    expect(result).toEqual(snapshot.room);
    expect(roomRealtimePublisher.emitTopologySnapshot).toHaveBeenCalledWith("room_1");
  });

  it("allows the host to delete a room and emits room missing", async () => {
    const snapshot = buildSnapshot();
    const roomService = {
      getRoomSnapshot: jest.fn().mockResolvedValue(snapshot),
      deleteRoom: jest.fn().mockResolvedValue({ ok: true })
    };
    const roomRealtimePublisher = createRoomRealtimePublisherMock();
    const authService = createAuthServiceMock();
    const playlistService = createPlaylistServiceMock();
    const controller = new RoomController(
      roomService as never,
      roomRealtimePublisher as never,
      authService as never,
      playlistService as never
    );

    await expect(controller.deleteRoom("room_1", "token")).resolves.toEqual({
      ok: true
    });

    expect(authService.getAuthSessionByTokenOrThrow).toHaveBeenCalledWith("token");
    expect(playlistService.listPlaylistsForRoom).toHaveBeenCalledWith("room_1");
    expect(playlistService.deletePlaylistsForRoom).toHaveBeenCalledWith("room_1");
    expect(roomService.deleteRoom).toHaveBeenCalledWith("room_1", "guest_host");
    expect(roomRealtimePublisher.emitRoomDeleted).toHaveBeenCalledWith("room_1", []);
    expect(roomRealtimePublisher.emitRoomMissing).toHaveBeenCalledWith("room_1");
  });
});
