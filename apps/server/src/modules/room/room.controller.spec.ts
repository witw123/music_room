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
          peerId: null
        }
      ],
      playback: {
        status: "paused",
        currentTrackId: null,
        sourceSessionId: "guest_host",
        sourcePeerId: null,
        sourceTrackId: null,
        positionMs: 0,
        startedAt: null,
        queueVersion: 1,
        mediaEpoch: 0
      },
      ...overrides
    },
    tracks: [],
    queue: [],
    playlists: []
  };
}

describe("RoomController", () => {
  function createAuthServiceMock() {
    return {
      assertSessionToken: jest.fn().mockResolvedValue(undefined)
    };
  }

  it("returns the recent room snapshot for a session", async () => {
    const snapshot = buildSnapshot();
    const roomService = {
      getRecentRoomSnapshotForSession: jest.fn().mockResolvedValue(snapshot)
    };
    const signalingGateway = {
      emitRoomSnapshot: jest.fn()
    };
    const authService = createAuthServiceMock();
    const controller = new RoomController(
      roomService as never,
      signalingGateway as never,
      authService as never
    );

    await expect(controller.getRecentRoom("token", "guest_host")).resolves.toEqual(snapshot);
    expect(authService.assertSessionToken).toHaveBeenCalledWith("guest_host", "token");
    expect(roomService.getRecentRoomSnapshotForSession).toHaveBeenCalledWith("guest_host");
  });

  it("returns a recoverable room snapshot for a valid member", async () => {
    const snapshot = buildSnapshot();
    const roomService = {
      getRecoverableRoomSnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const signalingGateway = {
      emitRoomSnapshot: jest.fn()
    };
    const authService = createAuthServiceMock();
    const controller = new RoomController(
      roomService as never,
      signalingGateway as never,
      authService as never
    );

    await expect(controller.recoverRoom("room_1", "token", "guest_host")).resolves.toEqual(snapshot);
    expect(authService.assertSessionToken).toHaveBeenCalledWith("guest_host", "token");
    expect(roomService.getRecoverableRoomSnapshot).toHaveBeenCalledWith("room_1", "guest_host");
  });

  it("does not emit a room snapshot after the room is deleted on leave", async () => {
    const emptyRoom = buildSnapshot({ members: [] }).room;
    const roomService = {
      leaveRoom: jest.fn().mockResolvedValue(emptyRoom),
      getRoomSnapshot: jest.fn()
    };
    const signalingGateway = {
      emitRoomSnapshot: jest.fn()
    };
    const authService = createAuthServiceMock();
    const controller = new RoomController(
      roomService as never,
      signalingGateway as never,
      authService as never
    );

    const result = await controller.leaveRoom("room_1", "token", { sessionId: "guest_host" });

    expect(result).toEqual(emptyRoom);
    expect(authService.assertSessionToken).toHaveBeenCalledWith("guest_host", "token");
    expect(roomService.getRoomSnapshot).not.toHaveBeenCalled();
    expect(signalingGateway.emitRoomSnapshot).not.toHaveBeenCalled();
  });

  it("emits a room snapshot after joining by code", async () => {
    const snapshot = buildSnapshot();
    const roomService = {
      findRoomByJoinCode: jest.fn().mockResolvedValue(snapshot.room),
      joinRoom: jest.fn().mockResolvedValue(snapshot.room),
      getRoomSnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const signalingGateway = {
      emitRoomSnapshot: jest.fn()
    };
    const authService = createAuthServiceMock();
    const controller = new RoomController(
      roomService as never,
      signalingGateway as never,
      authService as never
    );

    const result = await controller.joinRoomByCode("token", {
      sessionId: "guest_member",
      joinCode: "abc123"
    });

    expect(result).toEqual(snapshot);
    expect(authService.assertSessionToken).toHaveBeenCalledWith("guest_member", "token");
    expect(roomService.findRoomByJoinCode).toHaveBeenCalledWith("abc123");
    expect(roomService.joinRoom).toHaveBeenCalledWith(snapshot.room.id, "guest_member");
    expect(signalingGateway.emitRoomSnapshot).toHaveBeenCalledWith(snapshot.room.id, snapshot);
  });

  it("allows the host to delete a room and emits room missing", async () => {
    const roomService = {
      deleteRoom: jest.fn().mockResolvedValue({ ok: true })
    };
    const signalingGateway = {
      emitRoomSnapshot: jest.fn(),
      emitRoomMissing: jest.fn()
    };
    const authService = createAuthServiceMock();
    const controller = new RoomController(
      roomService as never,
      signalingGateway as never,
      authService as never
    );

    await expect(controller.deleteRoom("room_1", "token", "guest_host")).resolves.toEqual({
      ok: true
    });

    expect(authService.assertSessionToken).toHaveBeenCalledWith("guest_host", "token");
    expect(roomService.deleteRoom).toHaveBeenCalledWith("room_1", "guest_host");
    expect(signalingGateway.emitRoomMissing).toHaveBeenCalledWith("room_1");
  });
});
