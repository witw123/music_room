import { SignalingGateway } from "./signaling.gateway";

function createAuthServiceMock() {
  return {
    assertSessionToken: jest.fn().mockResolvedValue(undefined)
  };
}

function createSnapshot(input?: {
  roomId?: string;
  sourceSessionId?: string | null;
  sourcePeerId?: string | null;
  members?: Array<{
    id: string;
    nickname: string;
    role: "host" | "member";
    peerId: string | null;
    presenceState: "online" | "reconnecting" | "offline";
  }>;
  presenceRevision?: number;
}) {
  const roomId = input?.roomId ?? "room_1";
  const sourceSessionId = input?.sourceSessionId ?? "guest_host";
  const sourcePeerId = input?.sourcePeerId ?? null;
  const members =
    input?.members?.map((member) => ({
      ...member,
      joinedAt: "2026-04-01T00:00:00.000Z"
    })) ?? [];

  return {
    room: {
      id: roomId,
      hostId: "guest_host",
      joinCode: "ABC123",
      visibility: "private" as const,
      members,
      presenceRevision: input?.presenceRevision ?? 1,
      playback: {
        status: "paused" as const,
        currentTrackId: null,
        currentQueueItemId: null,
        sourceSessionId,
        sourcePeerId,
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
}

function createRoomServiceMock(snapshot = createSnapshot()) {
  return {
    updatePeerPresence: jest.fn().mockResolvedValue(undefined),
    touchRealtimePresence: jest.fn().mockResolvedValue(undefined),
    refreshRealtimePresence: jest.fn().mockResolvedValue({
      room: snapshot.room,
      changed: false
    }),
    clearRealtimePresence: jest.fn().mockResolvedValue(undefined),
    getAccessibleRoomSnapshot: jest.fn().mockResolvedValue(snapshot),
    getRoomSnapshot: jest.fn().mockResolvedValue(snapshot),
    handleDuplicateSessionReplacement: jest.fn().mockResolvedValue(snapshot.room.playback)
  };
}

function createRedisServiceMock(overrides?: Partial<{
  isAvailable: () => boolean;
  publish: jest.Mock;
  subscribe: jest.Mock;
}>) {
  return {
    isAvailable: jest.fn(() => true),
    publish: jest.fn(),
    subscribe: jest.fn(),
    ...overrides
  };
}

function createGateway(input?: {
  roomService?: ReturnType<typeof createRoomServiceMock>;
  redisService?: ReturnType<typeof createRedisServiceMock>;
}) {
  const roomService = input?.roomService ?? createRoomServiceMock();
  const redisService = input?.redisService ?? createRedisServiceMock();
  const moduleRef = {
    get: jest.fn().mockReturnValue(roomService)
  };
  const authService = createAuthServiceMock();
  const gateway = new SignalingGateway(
    redisService as never,
    moduleRef as never,
    authService as never
  );

  return {
    gateway,
    roomService,
    redisService,
    authService,
    moduleRef
  };
}

function createClient(input?: Partial<{
  id: string;
  roomId: string;
  sessionId: string;
  peerId: string;
  isRealtimeAuthenticated: boolean;
}>) {
  return {
    id: input?.id ?? "socket_1",
    handshake: { auth: { sessionToken: "token" }, headers: {} },
    data: {
      roomId: input?.roomId,
      sessionId: input?.sessionId,
      peerId: input?.peerId,
      isRealtimeAuthenticated: input?.isRealtimeAuthenticated ?? false
    },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: jest.fn() })
  };
}

function attachServerMock(gateway: SignalingGateway, sockets?: Map<string, ReturnType<typeof createClient>>) {
  const emit = jest.fn();
  gateway.server = {
    to: jest.fn().mockReturnValue({ emit }),
    sockets: {
      sockets: sockets ?? new Map()
    }
  } as never;

  return {
    emit
  };
}

describe("SignalingGateway", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("emits the latest snapshot immediately after a room subscribe", async () => {
    const snapshot = createSnapshot({
      members: [
        {
          id: "guest_host",
          nickname: "Host",
          role: "host",
          peerId: "peer_host",
          presenceState: "online"
        }
      ],
      sourcePeerId: "peer_host",
      presenceRevision: 3
    });
    const { gateway, roomService, authService } = createGateway({
      roomService: createRoomServiceMock(snapshot)
    });
    const client = createClient();

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
      "peer_host",
      "online"
    );
    expect(roomService.getAccessibleRoomSnapshot).toHaveBeenCalledWith("room_1", [], "guest_host");
    expect(client.emit).toHaveBeenCalledWith("room.snapshot", snapshot);
  });

  it("leaves the previous room and clears its presence when the same socket subscribes to another room", async () => {
    const { gateway, roomService } = createGateway();
    const client = createClient({
      roomId: "room_old",
      sessionId: "guest_host",
      peerId: "peer_old",
      isRealtimeAuthenticated: true
    });

    await gateway.handleRoomSubscribe(client as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host"
    });

    expect(client.leave).toHaveBeenCalledWith("room_old");
    expect(roomService.updatePeerPresence).toHaveBeenNthCalledWith(
      1,
      "room_old",
      "guest_host",
      null,
      "offline"
    );
    expect(roomService.updatePeerPresence).toHaveBeenNthCalledWith(
      2,
      "room_1",
      "guest_host",
      "peer_host",
      "online"
    );
  });

  it("emits room.snapshot.missing when the room no longer exists", async () => {
    const { gateway } = createGateway({
      roomService: {
        ...createRoomServiceMock(),
        getAccessibleRoomSnapshot: jest.fn().mockRejectedValue(new Error("missing"))
      }
    });
    const client = createClient();

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
    const { gateway, redisService } = createGateway({
      redisService: createRedisServiceMock({
        subscribe: jest.fn(async (channel: string, next: (payload: unknown) => void) => {
          handlers.set(channel, next);
        })
      })
    });
    attachServerMock(gateway);

    gateway.afterInit();
    expect(redisService.subscribe).toHaveBeenCalled();

    const roomEmit = (gateway.server.to("room_1").emit as jest.Mock);
    handlers.get("music-room:room-snapshot")?.({
      sourceId: "other-instance",
      roomId: "room_1",
      snapshot: { room: { id: "room_1" }, tracks: [], queue: [], playlists: [] }
    });

    expect(roomEmit).toHaveBeenCalledWith("room.snapshot", {
      room: { id: "room_1" },
      tracks: [],
      queue: [],
      playlists: []
    });
  });

  it("forwards peer signals received from redis only to the subscribed target peer", async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const { gateway } = createGateway({
      redisService: createRedisServiceMock({
        subscribe: jest.fn(async (channel: string, next: (payload: unknown) => void) => {
          handlers.set(channel, next);
        })
      })
    });
    const { emit } = attachServerMock(gateway);

    gateway.afterInit();
    await gateway.handleRoomSubscribe(
      createClient({ id: "socket_peer_b" }) as never,
      {
        roomId: "room_1",
        sessionId: "guest_b",
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
    const { gateway, redisService } = createGateway();
    const emit = jest.fn();
    const client = {
      ...createClient({
        roomId: "room_1",
        peerId: "peer_1",
        isRealtimeAuthenticated: true
      }),
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
    const { gateway, redisService } = createGateway();
    attachServerMock(gateway);
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
      createClient({
        roomId: "room_1",
        peerId: "peer_a",
        isRealtimeAuthenticated: true
      }) as never,
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
    const { gateway } = createGateway();

    await gateway.handlePieceAvailability(
      {
        ...createClient({
          roomId: "room_1",
          peerId: "peer_host",
          isRealtimeAuthenticated: true
        }),
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

    const client = createClient({ id: "socket_new" });
    await gateway.handleRoomSubscribe(client as never, {
      roomId: "room_1",
      sessionId: "guest_new",
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

  it("broadcasts availability clear events when a peer leaves the room", async () => {
    const { gateway, redisService } = createGateway();
    const { emit } = attachServerMock(gateway);

    await gateway.handlePieceAvailability(
      {
        ...createClient({
          roomId: "room_1",
          peerId: "peer_host",
          isRealtimeAuthenticated: true
        }),
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

    gateway.handleRoomUnsubscribe(
      createClient({
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host",
        isRealtimeAuthenticated: true
      }) as never,
      { roomId: "room_1" }
    );

    expect(emit).toHaveBeenCalledWith(
      "piece.availability.clear",
      expect.objectContaining({
        roomId: "room_1",
        ownerPeerId: "peer_host"
      })
    );
    expect(redisService.publish).toHaveBeenCalledWith(
      "music-room:piece-availability-clear",
      expect.objectContaining({
        roomId: "room_1",
        payload: expect.objectContaining({
          roomId: "room_1",
          ownerPeerId: "peer_host"
        })
      })
    );
  });

  it("rejects realtime messages from unauthenticated clients", async () => {
    const { gateway } = createGateway();

    await expect(
      gateway.handleSignal(
        createClient() as never,
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
    const { gateway } = createGateway({
      redisService: createRedisServiceMock({
        isAvailable: jest.fn(() => false)
      })
    });

    await expect(
      gateway.handleRoomSubscribe(createClient() as never, {
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host"
      })
    ).rejects.toThrow("Realtime sync unavailable.");
  });

  it("rejects peer signals when redis realtime is unavailable", async () => {
    const { gateway } = createGateway({
      redisService: createRedisServiceMock({
        isAvailable: jest.fn(() => false)
      })
    });

    await expect(
      gateway.handleSignal(
        createClient({
          roomId: "room_1",
          peerId: "peer_a",
          isRealtimeAuthenticated: true
        }) as never,
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
    const snapshot = createSnapshot({
      members: [
        {
          id: "guest_host",
          nickname: "Host",
          role: "host",
          peerId: "peer_host",
          presenceState: "online"
        }
      ],
      sourcePeerId: "peer_host",
      presenceRevision: 4
    });
    const { gateway } = createGateway({
      roomService: createRoomServiceMock(snapshot)
    });
    const { emit } = attachServerMock(gateway);

    await gateway.handleRoomSubscribe(createClient() as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host"
    });

    expect(emit).toHaveBeenCalledWith(
      "room.presence.patch",
      expect.objectContaining({
        roomId: "room_1",
        members: snapshot.room.members,
        playback: snapshot.room.playback,
        presenceRevision: 4
      })
    );
  });

  it("uses heartbeat presence to repair stale offline members", async () => {
    const snapshot = createSnapshot({
      members: [
        {
          id: "guest_host",
          nickname: "Host",
          role: "host",
          peerId: "peer_host",
          presenceState: "online"
        }
      ],
      sourcePeerId: "peer_host",
      presenceRevision: 5
    });
    const roomService = createRoomServiceMock(snapshot);
    roomService.refreshRealtimePresence.mockResolvedValue({
      room: snapshot.room,
      changed: true
    });
    const { gateway } = createGateway({ roomService });
    const { emit } = attachServerMock(gateway);

    await gateway.handleRoomPresence(
      createClient({
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host",
        isRealtimeAuthenticated: true
      }) as never,
      {
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host"
      }
    );

    expect(roomService.refreshRealtimePresence).toHaveBeenCalledWith(
      "room_1",
      "guest_host",
      "peer_host"
    );
    expect(emit).toHaveBeenCalledWith(
      "room.presence.patch",
      expect.objectContaining({
        roomId: "room_1",
        members: snapshot.room.members,
        playback: snapshot.room.playback,
        presenceRevision: 5
      })
    );
  });

  it("routes peer signals only to the target peer sockets on the current instance", async () => {
    const { gateway } = createGateway();
    const { emit } = attachServerMock(gateway);

    await gateway.handleRoomSubscribe(
      createClient({ id: "socket_peer_a" }) as never,
      { roomId: "room_1", sessionId: "guest_a", peerId: "peer_a" }
    );
    await gateway.handleRoomSubscribe(
      createClient({ id: "socket_peer_b" }) as never,
      { roomId: "room_1", sessionId: "guest_b", peerId: "peer_b" }
    );
    (gateway.server.to as jest.Mock).mockClear();
    emit.mockClear();

    await gateway.handleSignal(
      createClient({
        id: "socket_peer_a",
        roomId: "room_1",
        peerId: "peer_a",
        isRealtimeAuthenticated: true
      }) as never,
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

  it("replaces an older socket when the same session subscribes again", async () => {
    const snapshot = createSnapshot({
      members: [
        {
          id: "guest_host",
          nickname: "Host",
          role: "host",
          peerId: "peer_host_old",
          presenceState: "online"
        }
      ],
      sourceSessionId: "guest_host",
      sourcePeerId: "peer_host_old"
    });
    const roomService = createRoomServiceMock(snapshot);
    const { gateway } = createGateway({ roomService });
    const oldClient = createClient({
      id: "socket_old",
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host_old",
      isRealtimeAuthenticated: true
    });
    const newClient = createClient({ id: "socket_new" });
    attachServerMock(gateway, new Map([["socket_old", oldClient]]));

    await gateway.handleRoomSubscribe(oldClient as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host_old"
    });
    await gateway.handleRoomSubscribe(newClient as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host_new"
    });

    expect(roomService.handleDuplicateSessionReplacement).toHaveBeenCalledWith(
      "room_1",
      "guest_host"
    );
    expect(oldClient.emit).toHaveBeenCalledWith("room.session.replaced", {
      roomId: "room_1",
      reason: "duplicate-session"
    });
    expect(oldClient.leave).toHaveBeenCalledWith("room_1");
    expect(oldClient.data.roomId).toBeUndefined();
    expect(oldClient.data.sessionId).toBeUndefined();
    expect(oldClient.data.peerId).toBeUndefined();
    expect(oldClient.data.isRealtimeAuthenticated).toBe(false);
    expect(roomService.updatePeerPresence).toHaveBeenLastCalledWith(
      "room_1",
      "guest_host",
      "peer_host_new",
      "online"
    );
  });

  it("ignores stale room unsubscribe events from an older socket after the session has moved", async () => {
    const { gateway, roomService } = createGateway();
    attachServerMock(gateway);

    await gateway.handleRoomSubscribe(createClient({ id: "socket_new" }) as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host_new"
    });
    roomService.updatePeerPresence.mockClear();

    gateway.handleRoomUnsubscribe(
      createClient({
        id: "socket_old",
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host_old",
        isRealtimeAuthenticated: true
      }) as never,
      { roomId: "room_1" }
    );

    expect(roomService.updatePeerPresence).not.toHaveBeenCalled();
  });

  it("ignores stale disconnect events from an older socket after the session has moved", async () => {
    const { gateway, roomService } = createGateway();
    attachServerMock(gateway);

    await gateway.handleRoomSubscribe(createClient({ id: "socket_new" }) as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host_new"
    });
    roomService.updatePeerPresence.mockClear();

    gateway.handleDisconnect(
      createClient({
        id: "socket_old",
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host_old",
        isRealtimeAuthenticated: true
      }) as never
    );

    expect(roomService.updatePeerPresence).not.toHaveBeenCalled();
  });

  it("keeps a disconnected member in reconnecting state during the grace window", async () => {
    jest.useFakeTimers();
    const { gateway, roomService } = createGateway();
    attachServerMock(gateway);
    const client = createClient({
      id: "socket_host",
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host",
      isRealtimeAuthenticated: true
    });

    await gateway.handleRoomSubscribe(client as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host"
    });
    roomService.updatePeerPresence.mockClear();

    gateway.handleDisconnect(
      client as never
    );

    expect(roomService.updatePeerPresence).toHaveBeenNthCalledWith(
      1,
      "room_1",
      "guest_host",
      null,
      "reconnecting"
    );

    await jest.advanceTimersByTimeAsync(20_000);
    expect(roomService.updatePeerPresence).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(6_000);
    expect(roomService.updatePeerPresence).toHaveBeenNthCalledWith(
      2,
      "room_1",
      "guest_host",
      null,
      "offline"
    );
  });

  it("emits a reconnecting presence patch with the latest playback after source disconnect", async () => {
    jest.useFakeTimers();
    const snapshot = createSnapshot({
      members: [
        {
          id: "guest_host",
          nickname: "Host",
          role: "host",
          peerId: null,
          presenceState: "reconnecting"
        }
      ],
      sourceSessionId: "guest_host",
      sourcePeerId: null,
      presenceRevision: 6
    });
    snapshot.room.playback = {
      ...snapshot.room.playback,
      status: "paused",
      currentTrackId: "track_1",
      currentQueueItemId: "queue_1",
      sourceTrackId: "track_1",
      positionMs: 18_000,
      queueVersion: 9,
      mediaEpoch: 3
    } as never;
    const roomService = createRoomServiceMock(snapshot);
    const { gateway } = createGateway({ roomService });
    const { emit } = attachServerMock(gateway);
    const client = createClient({
      id: "socket_host",
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host",
      isRealtimeAuthenticated: true
    });

    await gateway.handleRoomSubscribe(client as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host"
    });
    emit.mockClear();

    gateway.handleDisconnect(
      client as never
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(emit).toHaveBeenCalledWith(
      "room.presence.patch",
      expect.objectContaining({
        roomId: "room_1",
        members: snapshot.room.members,
        presenceRevision: 6,
        playback: expect.objectContaining({
          status: "paused",
          currentTrackId: "track_1",
          sourceSessionId: "guest_host",
          sourcePeerId: null,
          queueVersion: 9
        })
      })
    );

    gateway.onModuleDestroy();
  });

  it("cancels delayed cleanup when the same member reconnects before the grace window ends", async () => {
    jest.useFakeTimers();
    const { gateway, roomService } = createGateway();

    gateway.handleDisconnect(
      createClient({
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host",
        isRealtimeAuthenticated: true
      }) as never
    );

    await gateway.handleRoomSubscribe(createClient() as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host"
    });

    await jest.advanceTimersByTimeAsync(30_000);
    expect(roomService.updatePeerPresence).not.toHaveBeenCalledWith(
      "room_1",
      "guest_host",
      null,
      "offline"
    );
  });
});
