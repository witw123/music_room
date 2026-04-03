import { SignalingGateway } from "./signaling.gateway";

describe("SignalingGateway", () => {
  function createAuthServiceMock() {
    return {
      assertSessionToken: jest.fn().mockResolvedValue(undefined)
    };
  }

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
          currentQueueItemId: null,
          sourceSessionId: "guest_host",
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
    };
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const roomService = {
      updatePeerPresence: jest.fn().mockResolvedValue(undefined),
      getAccessibleRoomSnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const authService = createAuthServiceMock();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );
    const client = {
      handshake: { auth: { sessionToken: "token" }, headers: {} },
      data: {},
      join: jest.fn(),
      emit: jest.fn()
    };

    await gateway.handleRoomSubscribe(client as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host"
    });

    expect(client.join).toHaveBeenCalledWith("room_1");
    expect(authService.assertSessionToken).toHaveBeenCalledWith("guest_host", "token");
    expect(roomService.updatePeerPresence).toHaveBeenCalledWith(
      "room_1",
      "guest_host",
      "peer_host"
    );
    expect(roomService.getAccessibleRoomSnapshot).toHaveBeenCalledWith("room_1", [], "guest_host");
    expect(client.emit).toHaveBeenCalledWith("room.snapshot", snapshot);
  });

  it("emits room.snapshot.missing when the room no longer exists", async () => {
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const roomService = {
      updatePeerPresence: jest.fn().mockResolvedValue(undefined),
      getAccessibleRoomSnapshot: jest.fn().mockRejectedValue(new Error("missing"))
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const authService = createAuthServiceMock();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );
    const client = {
      handshake: { auth: { sessionToken: "token" }, headers: {} },
      data: {},
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn()
    };

    await expect(
      gateway.handleRoomSubscribe(client as never, {
        roomId: "room_404",
        sessionId: "guest_host",
        peerId: "peer_host"
      })
    ).resolves.toEqual({ ok: true });

    expect(client.emit).toHaveBeenCalledWith("room.snapshot.missing", { roomId: "room_404" });
    expect(client.leave).not.toHaveBeenCalled();
  });

  it("forwards room snapshots received from redis when they come from another instance", async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn(async (channel: string, next: (payload: unknown) => void) => {
        handlers.set(channel, next);
      })
    };
    const moduleRef = {
      get: jest.fn()
    };
    const authService = createAuthServiceMock();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );
    gateway.server = {
      to: jest.fn().mockReturnValue({
        emit: jest.fn()
      })
    } as never;

    gateway.afterInit();
    expect(redisService.subscribe).toHaveBeenCalled();

    const serverRoom = gateway.server.to("room_1");
    const emit = serverRoom.emit as jest.Mock;

    handlers.get("music-room:room-snapshot")?.({
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

  it("forwards peer signals received from redis only to the subscribed target peer", async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn(async (channel: string, next: (payload: unknown) => void) => {
        handlers.set(channel, next);
      })
    };
    const roomSnapshot = {
      room: {
        id: "room_1",
        hostId: "guest_host",
        joinCode: "ABC123",
        visibility: "private",
        members: [],
        playback: {
          status: "paused" as const,
          currentTrackId: null,
          currentQueueItemId: null,
          sourceSessionId: "guest_host",
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
    };
    const roomService = {
      updatePeerPresence: jest.fn().mockResolvedValue(undefined),
      touchRealtimePresence: jest.fn().mockResolvedValue(undefined),
      clearRealtimePresence: jest.fn().mockResolvedValue(undefined),
      getAccessibleRoomSnapshot: jest.fn().mockResolvedValue(roomSnapshot),
      getRoomSnapshot: jest.fn().mockResolvedValue(roomSnapshot)
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const authService = createAuthServiceMock();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );
    const emit = jest.fn();
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit })
    } as never;

    gateway.afterInit();
    await gateway.handleRoomSubscribe(
      {
        id: "socket_peer_b",
        handshake: { auth: { sessionToken: "token" }, headers: {} },
        data: {},
        join: jest.fn(),
        emit: jest.fn()
      } as never,
      {
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_b"
      }
    );
    (gateway.server.to as jest.Mock).mockClear();
    emit.mockClear();

    handlers.get("music-room:peer-signal")?.({
      sourceId: "other-instance",
      roomId: "room_1",
      payload: {
        roomId: "room_1",
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        channelKind: "data",
        type: "offer",
        payload: { type: "offer", sdp: "fake" }
      }
    });

    expect(gateway.server.to).toHaveBeenCalledWith("socket_peer_b");
    expect(gateway.server.to).not.toHaveBeenCalledWith("room_1");
    expect(emit).toHaveBeenCalledWith(
      "peer.signal",
      expect.objectContaining({
        roomId: "room_1",
        fromPeerId: "peer_a",
        toPeerId: "peer_b"
      })
    );
  });

  it("broadcasts piece availability updates to the rest of the room", async () => {
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const moduleRef = {
      get: jest.fn()
    };
    const authService = createAuthServiceMock();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );
    const emit = jest.fn();
    const client = {
      data: {
        roomId: "room_1",
        peerId: "peer_1",
        isRealtimeAuthenticated: true
      },
      to: jest.fn().mockReturnValue({ emit })
    };
    const payload = {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_1",
      nickname: "Host",
      totalChunks: 4,
      chunkSize: 128 * 1024,
      availableChunks: [0, 1, 2, 3],
      source: "live_upload" as const,
      announcedAt: new Date().toISOString()
    };

    const result = await gateway.handlePieceAvailability(client as never, payload);

    expect(result).toEqual(payload);
    expect(client.to).toHaveBeenCalledWith("room_1");
    expect(emit).toHaveBeenCalledWith("piece.availability", payload);
    expect(redisService.publish).toHaveBeenCalledWith(
      "music-room:piece-availability",
      expect.objectContaining({
        roomId: "room_1",
        payload
      })
    );
  });

  it("publishes peer signals so they can cross server instances", async () => {
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const moduleRef = {
      get: jest.fn()
    };
    const authService = createAuthServiceMock();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );
    gateway.server = {
      to: jest.fn().mockReturnValue({
        emit: jest.fn()
      })
    } as never;

    const payload = {
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "media" as const,
      mediaEpoch: 1,
      type: "offer" as const,
      payload: { type: "offer", sdp: "fake" }
    };

    const result = await gateway.handleSignal(
      {
        data: {
          roomId: "room_1",
          peerId: "peer_a",
          isRealtimeAuthenticated: true
        }
      } as never,
      payload
    );

    expect(result).toEqual(expect.objectContaining(payload));
    expect(redisService.publish).toHaveBeenCalledWith(
      "music-room:peer-signal",
      expect.objectContaining({
        roomId: "room_1",
        payload: expect.objectContaining({
          ...payload,
          sequence: expect.any(Number)
        })
      })
    );
  });

  it("replays cached availability to a newly subscribed client", async () => {
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const roomService = {
      updatePeerPresence: jest.fn().mockResolvedValue(undefined),
      getAccessibleRoomSnapshot: jest.fn().mockResolvedValue({
        room: {
          id: "room_1",
          hostId: "guest_host",
          joinCode: "ABC123",
          visibility: "private",
          members: [],
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
            mediaEpoch: 0
          }
        },
        tracks: [],
        queue: [],
        playlists: []
      })
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const authService = createAuthServiceMock();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );

    await gateway.handlePieceAvailability(
      {
        data: {
          roomId: "room_1",
          peerId: "peer_host",
          isRealtimeAuthenticated: true
        },
        to: jest.fn().mockReturnValue({ emit: jest.fn() })
      } as never,
      {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_host",
        nickname: "Host",
        totalChunks: 8,
        chunkSize: 128 * 1024,
        availableChunks: [0, 1, 2],
        source: "live_upload",
        announcedAt: new Date().toISOString()
      }
    );

    const client = {
      handshake: { auth: { sessionToken: "token" }, headers: {} },
      data: {},
      join: jest.fn(),
      emit: jest.fn()
    };

    await gateway.handleRoomSubscribe(client as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_guest"
    });

    expect(client.emit).toHaveBeenCalledWith(
      "piece.availability",
      expect.objectContaining({
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_host"
      })
    );
  });

  it("rejects realtime messages from unauthenticated clients", async () => {
    const redisService = {
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const moduleRef = {
      get: jest.fn()
    };
    const authService = createAuthServiceMock();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );

    await expect(
      gateway.handleSignal(
        {
          data: {}
        } as never,
        {
          roomId: "room_1",
          fromPeerId: "peer_a",
          toPeerId: "peer_b",
          channelKind: "data",
          type: "offer",
          payload: {}
        }
      )
    ).rejects.toThrow("Unauthorized realtime request.");
  });

  it("rejects room subscriptions when redis realtime is unavailable", async () => {
    const redisService = {
      isAvailable: jest.fn(() => false),
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const moduleRef = {
      get: jest.fn()
    };
    const authService = createAuthServiceMock();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );

    await expect(
      gateway.handleRoomSubscribe(
        {
          handshake: { auth: { sessionToken: "token" }, headers: {} },
          data: {},
          join: jest.fn()
        } as never,
        { roomId: "room_1", sessionId: "guest_host", peerId: "peer_host" }
      )
    ).rejects.toThrow("Realtime sync unavailable.");
  });

  it("rejects peer signals when redis realtime is unavailable", async () => {
    const redisService = {
      isAvailable: jest.fn(() => false),
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const moduleRef = {
      get: jest.fn()
    };
    const authService = createAuthServiceMock();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );

    await expect(
      gateway.handleSignal(
        {
          data: {
            roomId: "room_1",
            peerId: "peer_a",
            isRealtimeAuthenticated: true
          }
        } as never,
        {
          roomId: "room_1",
          fromPeerId: "peer_a",
          toPeerId: "peer_b",
          channelKind: "data",
          type: "offer",
          payload: {}
        }
      )
    ).rejects.toThrow("Realtime sync unavailable.");
  });

  it("emits a presence patch after a successful room subscribe", async () => {
    const snapshot = {
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
            joinedAt: "2026-04-01T00:00:00.000Z",
            peerId: "peer_host"
          }
        ],
        playback: {
          status: "paused",
          currentTrackId: null,
          currentQueueItemId: null,
          sourceSessionId: "guest_host",
          sourcePeerId: "peer_host",
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
    };
    const redisService = {
      isAvailable: jest.fn(() => true),
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const roomService = {
      updatePeerPresence: jest.fn().mockResolvedValue(undefined),
      touchRealtimePresence: jest.fn().mockResolvedValue(undefined),
      clearRealtimePresence: jest.fn().mockResolvedValue(undefined),
      getAccessibleRoomSnapshot: jest.fn().mockResolvedValue(snapshot),
      getRoomSnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const authService = createAuthServiceMock();
    const emit = jest.fn();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit })
    } as never;

    await gateway.handleRoomSubscribe(
      {
        handshake: { auth: { sessionToken: "token" }, headers: {} },
        data: {},
        join: jest.fn(),
        emit: jest.fn()
      } as never,
      { roomId: "room_1", sessionId: "guest_host", peerId: "peer_host" }
    );

    expect(emit).toHaveBeenCalledWith(
      "room.presence.patch",
      expect.objectContaining({
        roomId: "room_1",
        members: snapshot.room.members,
        playback: snapshot.room.playback
      })
    );
  });

  it("routes peer signals only to the target peer sockets on the current instance", async () => {
    const roomSnapshot = {
      room: {
        id: "room_1",
        hostId: "guest_host",
        joinCode: "ABC123",
        visibility: "private",
        members: [],
        playback: {
          status: "paused" as const,
          currentTrackId: null,
          currentQueueItemId: null,
          sourceSessionId: "guest_host",
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
    };
    const redisService = {
      isAvailable: jest.fn(() => true),
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const roomService = {
      updatePeerPresence: jest.fn().mockResolvedValue(undefined),
      touchRealtimePresence: jest.fn().mockResolvedValue(undefined),
      clearRealtimePresence: jest.fn().mockResolvedValue(undefined),
      getAccessibleRoomSnapshot: jest.fn().mockResolvedValue(roomSnapshot),
      getRoomSnapshot: jest.fn().mockResolvedValue(roomSnapshot)
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const authService = createAuthServiceMock();
    const emit = jest.fn();
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      authService as never
    );
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit })
    } as never;

    await gateway.handleRoomSubscribe(
      {
        id: "socket_peer_a",
        handshake: { auth: { sessionToken: "token" }, headers: {} },
        data: {},
        join: jest.fn(),
        emit: jest.fn()
      } as never,
      { roomId: "room_1", sessionId: "guest_host", peerId: "peer_a" }
    );
    await gateway.handleRoomSubscribe(
      {
        id: "socket_peer_b",
        handshake: { auth: { sessionToken: "token" }, headers: {} },
        data: {},
        join: jest.fn(),
        emit: jest.fn()
      } as never,
      { roomId: "room_1", sessionId: "guest_host", peerId: "peer_b" }
    );
    (gateway.server.to as jest.Mock).mockClear();
    emit.mockClear();

    await gateway.handleSignal(
      {
        id: "socket_peer_a",
        data: {
          roomId: "room_1",
          peerId: "peer_a",
          isRealtimeAuthenticated: true
        }
      } as never,
      {
        roomId: "room_1",
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        channelKind: "media",
        mediaEpoch: 1,
        type: "offer",
        payload: { type: "offer", sdp: "fake" }
      }
    );

    expect(gateway.server.to).toHaveBeenCalledWith("socket_peer_b");
    expect(gateway.server.to).not.toHaveBeenCalledWith("room_1");
    expect(emit).toHaveBeenCalledWith(
      "peer.signal",
      expect.objectContaining({
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        type: "offer"
      })
    );
  });

  it("keeps a disconnected member online during the reconnect grace window", async () => {
    jest.useFakeTimers();
    const redisService = {
      isAvailable: jest.fn(() => true),
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const roomService = {
      updatePeerPresence: jest.fn().mockResolvedValue(undefined),
      touchRealtimePresence: jest.fn().mockResolvedValue(undefined),
      clearRealtimePresence: jest.fn().mockResolvedValue(undefined),
      getAccessibleRoomSnapshot: jest.fn().mockResolvedValue({
        room: {
          id: "room_1",
          hostId: "guest_host",
          joinCode: "ABC123",
          visibility: "private",
          members: [],
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
            mediaEpoch: 0
          }
        },
        tracks: [],
        queue: [],
        playlists: []
      }),
      getRoomSnapshot: jest.fn().mockResolvedValue({
        room: {
          id: "room_1",
          hostId: "guest_host",
          joinCode: "ABC123",
          visibility: "private",
          members: [],
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
            mediaEpoch: 0
          }
        },
        tracks: [],
        queue: [],
        playlists: []
      })
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      createAuthServiceMock() as never
    );

    gateway.handleDisconnect({
      data: {
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host"
      }
    } as never);

    await jest.advanceTimersByTimeAsync(20_000);
    expect(roomService.updatePeerPresence).not.toHaveBeenCalledWith("room_1", "guest_host", null);

    await jest.advanceTimersByTimeAsync(6_000);
    expect(roomService.updatePeerPresence).toHaveBeenCalledWith("room_1", "guest_host", null);
    jest.useRealTimers();
  });

  it("cancels delayed cleanup when the same member reconnects before the grace window ends", async () => {
    jest.useFakeTimers();
    const snapshot = {
      room: {
        id: "room_1",
        hostId: "guest_host",
        joinCode: "ABC123",
        visibility: "private",
        members: [],
        playback: {
          status: "paused" as const,
          currentTrackId: null,
          currentQueueItemId: null,
          sourceSessionId: "guest_host",
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
    };
    const redisService = {
      isAvailable: jest.fn(() => true),
      publish: jest.fn(),
      subscribe: jest.fn()
    };
    const roomService = {
      updatePeerPresence: jest.fn().mockResolvedValue(undefined),
      touchRealtimePresence: jest.fn().mockResolvedValue(undefined),
      clearRealtimePresence: jest.fn().mockResolvedValue(undefined),
      getAccessibleRoomSnapshot: jest.fn().mockResolvedValue(snapshot),
      getRoomSnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const gateway = new SignalingGateway(
      redisService as never,
      moduleRef as never,
      createAuthServiceMock() as never
    );

    gateway.handleDisconnect({
      data: {
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host"
      }
    } as never);

    await gateway.handleRoomSubscribe(
      {
        handshake: { auth: { sessionToken: "token" }, headers: {} },
        data: {},
        join: jest.fn(),
        emit: jest.fn()
      } as never,
      { roomId: "room_1", sessionId: "guest_host", peerId: "peer_host" }
    );

    await jest.advanceTimersByTimeAsync(30_000);
    expect(roomService.updatePeerPresence).not.toHaveBeenCalledWith("room_1", "guest_host", null);
    jest.useRealTimers();
  });
});
