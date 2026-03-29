import { SignalingGateway } from "./signaling.gateway";

describe("SignalingGateway", () => {
  it("emits the latest snapshot immediately after a room subscribe", async () => {
    const snapshot = {
      room: {
        id: "room_1",
        hostId: "guest_host",
        joinCode: "ABC123",
        visibility: "private",
        members: [],
        playback: {
          status: "paused",
          currentTrackId: null,
          positionMs: 0,
          startedAt: null,
          queueVersion: 1
        }
      },
      tracks: [],
      queue: [],
      playlists: []
    };
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const roomService = {
      getRoomSnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const gateway = new SignalingGateway(redisService as never, moduleRef as never);
    const client = {
      data: {},
      join: jest.fn(),
      emit: jest.fn()
    };

    gateway.handleRoomSubscribe(client as never, { roomId: "room_1" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(client.join).toHaveBeenCalledWith("room_1");
    expect(roomService.getRoomSnapshot).toHaveBeenCalledWith("room_1", []);
    expect(client.emit).toHaveBeenCalledWith("room.snapshot", snapshot);
  });

  it("emits room.snapshot.missing when the room no longer exists", async () => {
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const roomService = {
      getRoomSnapshot: jest.fn().mockRejectedValue(new Error("missing"))
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const gateway = new SignalingGateway(redisService as never, moduleRef as never);
    const client = {
      data: {},
      join: jest.fn(),
      emit: jest.fn()
    };

    gateway.handleRoomSubscribe(client as never, { roomId: "room_404" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(client.emit).toHaveBeenCalledWith("room.snapshot.missing", { roomId: "room_404" });
  });

  it("forwards room snapshots received from redis when they come from another instance", async () => {
    let handler: ((payload: unknown) => void) | undefined;
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn(async (_channel: string, next: (payload: unknown) => void) => {
        handler = next;
      })
    };
    const moduleRef = {
      get: jest.fn()
    };
    const gateway = new SignalingGateway(redisService as never, moduleRef as never);
    gateway.server = {
      to: jest.fn().mockReturnValue({
        emit: jest.fn()
      })
    } as never;

    gateway.afterInit();
    expect(redisService.subscribe).toHaveBeenCalled();

    const serverRoom = gateway.server.to("room_1");
    const emit = serverRoom.emit as jest.Mock;

    handler?.({
      sourceId: "other-instance",
      roomId: "room_1",
      snapshot: { room: { id: "room_1" }, tracks: [], queue: [], playlists: [] }
    });

    expect(emit).toHaveBeenCalledWith("room.snapshot", {
      room: { id: "room_1" },
      tracks: [],
      queue: [],
      playlists: []
    });
  });

  it("broadcasts piece availability updates to the rest of the room", () => {
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const moduleRef = {
      get: jest.fn()
    };
    const gateway = new SignalingGateway(redisService as never, moduleRef as never);
    const emit = jest.fn();
    const client = {
      to: jest.fn().mockReturnValue({ emit })
    };
    const payload = {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_1",
      nickname: "Host",
      totalChunks: 4,
      availableChunks: [0, 1, 2, 3],
      source: "live_upload" as const,
      announcedAt: new Date().toISOString()
    };

    const result = gateway.handlePieceAvailability(client as never, payload);

    expect(result).toEqual(payload);
    expect(client.to).toHaveBeenCalledWith("room_1");
    expect(emit).toHaveBeenCalledWith("piece.availability", payload);
  });
});
