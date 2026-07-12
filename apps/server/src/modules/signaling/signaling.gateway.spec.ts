import { compactTrackAvailabilityAnnouncement } from "@music-room/shared";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";
import { MetricsService } from "../../common/metrics/metrics.service";
import { RoomRealtimeBroadcaster } from "./room-realtime.broadcaster";
import { SignalingGateway } from "./signaling.gateway";
import { TrackAvailabilityRegistry } from "./track-availability.registry";

function createAuthServiceMock() {
  return {
    assertSessionToken: jest.fn().mockResolvedValue(undefined),
    getUserOrThrow: jest.fn().mockResolvedValue({
      id: "guest_host",
      username: "host",
      nickname: "Host"
    })
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
        playbackRevision: 1,
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
  setJson: jest.Mock;
  getJson: jest.Mock;
  delete: jest.Mock;
}>) {
  return {
    isAvailable: jest.fn(() => true),
    publish: jest.fn(),
    subscribe: jest.fn(),
    setJson: jest.fn(),
    getJson: jest.fn().mockResolvedValue(null),
    delete: jest.fn(),
    ...overrides
  };
}

function createGateway(input?: {
  roomService?: ReturnType<typeof createRoomServiceMock>;
  redisService?: ReturnType<typeof createRedisServiceMock>;
}) {
  const roomService = input?.roomService ?? createRoomServiceMock();
  const redisService = input?.redisService ?? createRedisServiceMock();
  const broadcaster = new RoomRealtimeBroadcaster(redisService as never);
  const roomRealtimePublisher = new RoomRealtimePublisher(
    roomService as never,
    broadcaster as never
  );
  const authService = createAuthServiceMock();
  const metrics = new MetricsService();
  const trackAvailabilityRegistry = new TrackAvailabilityRegistry(redisService as never);
  const gateway = new SignalingGateway(
    redisService as never,
    roomService as never,
    roomRealtimePublisher as never,
    broadcaster as never,
    trackAvailabilityRegistry,
    authService as never,
    metrics
  );

  return {
    gateway,
    roomService,
    redisService,
    authService,
    broadcaster,
    roomRealtimePublisher,
    trackAvailabilityRegistry,
    metrics
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
  const server = {
    to: jest.fn().mockReturnValue({ emit }),
    sockets: {
      sockets: sockets ?? new Map()
    }
  };
  gateway.server = server as never;

  return {
    emit,
    server
  };
}

describe("SignalingGateway", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("emits the latest snapshot immediately after a room subscribe", async () => {
    jest.useFakeTimers();
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

    const response = await gateway.handleRoomSubscribe(client as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host"
    });
    jest.runAllTimers();

    expect(client.join).toHaveBeenCalledWith("room_1");
    expect(authService.assertSessionToken).toHaveBeenCalledWith("guest_host", "token");
    expect(roomService.updatePeerPresence).toHaveBeenCalledWith(
      "room_1",
      "guest_host",
      "peer_host",
      "online"
    );
    expect(roomService.getAccessibleRoomSnapshot).toHaveBeenCalledWith("room_1", [], "guest_host");
    expect(response).toEqual({
      ok: true,
      serverNow: expect.any(String),
      recoveryGeneration: expect.any(Number),
      bootstrap: {
        roomId: "room_1",
        roomRevision: 0,
        presenceRevision: 3,
        playback: snapshot.room.playback,
        members: [
          {
            id: "guest_host",
            peerId: "peer_host",
            presenceState: "online",
            role: "host"
          }
        ]
      }
    });
    expect(client.emit).toHaveBeenCalledWith("room.snapshot", snapshot);
  });

  it("builds the subscribe snapshot after marking the peer online", async () => {
    const offlineSnapshot = createSnapshot({
      members: [
        {
          id: "guest_host",
          nickname: "Host",
          role: "host",
          peerId: null,
          presenceState: "offline"
        }
      ],
      sourcePeerId: null,
      presenceRevision: 1
    });
    const onlineSnapshot = createSnapshot({
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
      presenceRevision: 2
    });
    const roomService = createRoomServiceMock(offlineSnapshot);
    roomService.updatePeerPresence.mockImplementation(async () => {
      roomService.getAccessibleRoomSnapshot.mockResolvedValue(onlineSnapshot);
    });
    const { gateway } = createGateway({ roomService });
    const client = createClient();

    const response = await gateway.handleRoomSubscribe(client as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host"
    });

    expect(response).toMatchObject({
      ok: true,
      bootstrap: {
        presenceRevision: 2,
        members: [
          {
            id: "guest_host",
            peerId: "peer_host",
            presenceState: "online"
          }
        ]
      }
    });
  });

  it("leaves the previous room and clears its presence when the same socket subscribes to another room", async () => {
    const { gateway, roomService } = createGateway();
    const { emit, server } = attachServerMock(gateway);
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
    expect(server.to).toHaveBeenCalledWith("room_old");
    expect(emit).toHaveBeenCalledWith(
      "piece.availability.clear",
      expect.objectContaining({ roomId: "room_old", ownerPeerId: "peer_old" })
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
    ).resolves.toEqual({ ok: false });

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
    const snapshot = createSnapshot();
    handlers.get("music-room:room-snapshot")?.({
      sourceId: "other-instance",
      roomId: "room_1",
      snapshot
    });

    expect(roomEmit).toHaveBeenCalledWith("room.snapshot", snapshot);
  });

  it("unsubscribes every redis realtime channel when the module is destroyed", async () => {
    const unsubscribeFns: jest.Mock[] = [];
    const { gateway } = createGateway({
      redisService: createRedisServiceMock({
        subscribe: jest.fn(async () => {
          const unsubscribe = jest.fn();
          unsubscribeFns.push(unsubscribe);
          return unsubscribe;
        })
      })
    });
    attachServerMock(gateway);

    gateway.afterInit();
    await Promise.resolve();
    await Promise.resolve();
    gateway.onModuleDestroy();

    expect(unsubscribeFns).toHaveLength(10);
    for (const unsubscribe of unsubscribeFns) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores invalid redis room snapshots before forwarding them", async () => {
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
    handlers.get("music-room:room-snapshot")?.({
      sourceId: "other-instance",
      roomId: "room_1",
      snapshot: { room: { id: "room_1" }, tracks: [], queue: [], playlists: [] }
    });
    handlers.get("music-room:room-snapshot")?.({
      sourceId: "other-instance",
      roomId: "room_1",
      snapshot: createSnapshot({ roomId: "room_2" })
    });

    expect(emit).not.toHaveBeenCalledWith("room.snapshot", expect.anything());
  });

  it("ignores invalid or mismatched redis playback patches before forwarding them", async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const { gateway } = createGateway({
      redisService: createRedisServiceMock({
        subscribe: jest.fn(async (channel: string, next: (payload: unknown) => void) => {
          handlers.set(channel, next);
        })
      })
    });
    const { emit } = attachServerMock(gateway);
    const snapshot = createSnapshot();

    gateway.afterInit();
    handlers.get("music-room:room-playback-patch")?.({
      sourceId: "other-instance",
      roomId: "room_1",
      payload: {
        roomId: "room_1",
        playback: { ...snapshot.room.playback, positionMs: -1 },
        updatedAt: new Date().toISOString()
      }
    });
    handlers.get("music-room:room-playback-patch")?.({
      sourceId: "other-instance",
      roomId: "room_1",
      payload: {
        roomId: "room_2",
        playback: snapshot.room.playback,
        updatedAt: new Date().toISOString()
      }
    });

    expect(emit).not.toHaveBeenCalledWith("room.playback.patch", expect.anything());
  });

  it.each([
    {
      channel: "music-room:room-queue-patch",
      event: "room.queue.patch",
      invalidPayload: (snapshot: ReturnType<typeof createSnapshot>) => ({
        roomId: "room_1",
        queue: [],
        playback: { ...snapshot.room.playback, positionMs: -1 },
        updatedAt: new Date().toISOString()
      }),
      mismatchedPayload: (snapshot: ReturnType<typeof createSnapshot>) => ({
        roomId: "room_2",
        queue: [],
        playback: snapshot.room.playback,
        updatedAt: new Date().toISOString()
      })
    },
    {
      channel: "music-room:room-presence-patch",
      event: "room.presence.patch",
      invalidPayload: (snapshot: ReturnType<typeof createSnapshot>) => ({
        roomId: "room_1",
        members: [{ id: "guest_host" }],
        playback: snapshot.room.playback,
        presenceRevision: 1,
        updatedAt: new Date().toISOString()
      }),
      mismatchedPayload: (snapshot: ReturnType<typeof createSnapshot>) => ({
        roomId: "room_2",
        members: snapshot.room.members,
        playback: snapshot.room.playback,
        presenceRevision: 1,
        updatedAt: new Date().toISOString()
      })
    },
    {
      channel: "music-room:room-library-patch",
      event: "room.library.patch",
      invalidPayload: (snapshot: ReturnType<typeof createSnapshot>) => ({
        roomId: "room_1",
        tracks: [{ id: "track_1" }],
        queue: [],
        playback: snapshot.room.playback,
        updatedAt: new Date().toISOString()
      }),
      mismatchedPayload: (snapshot: ReturnType<typeof createSnapshot>) => ({
        roomId: "room_2",
        tracks: [],
        queue: [],
        playback: snapshot.room.playback,
        updatedAt: new Date().toISOString()
      })
    }
  ])(
    "ignores invalid or mismatched redis $event payloads before forwarding them",
    ({ channel, event, invalidPayload, mismatchedPayload }) => {
      const handlers = new Map<string, (payload: unknown) => void>();
      const { gateway } = createGateway({
        redisService: createRedisServiceMock({
          subscribe: jest.fn(async (channelName: string, next: (payload: unknown) => void) => {
            handlers.set(channelName, next);
          })
        })
      });
      const { emit } = attachServerMock(gateway);
      const snapshot = createSnapshot();

      gateway.afterInit();
      handlers.get(channel)?.({
        sourceId: "other-instance",
        roomId: "room_1",
        payload: invalidPayload(snapshot)
      });
      handlers.get(channel)?.({
        sourceId: "other-instance",
        roomId: "room_1",
        payload: mismatchedPayload(snapshot)
      });

      expect(emit).not.toHaveBeenCalledWith(event, expect.anything());
    }
  );

  it("ignores invalid redis room deletion and snapshot-missing envelopes before cleanup", () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const { gateway, trackAvailabilityRegistry, metrics } = createGateway({
      redisService: createRedisServiceMock({
        subscribe: jest.fn(async (channel: string, next: (payload: unknown) => void) => {
          handlers.set(channel, next);
        })
      })
    });
    const { emit } = attachServerMock(gateway);
    const availability = {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_cached",
      nickname: "Cached",
      totalChunks: 4,
      chunkSize: 128 * 1024,
      availableChunks: [0, 1, 2, 3],
      source: "local_cache" as const,
      announcedAt: new Date().toISOString()
    };
    trackAvailabilityRegistry.setAnnouncement("room_1", availability);
    metrics.bindRealtimeSocket("socket_cached", "room_1");

    gateway.afterInit();
    handlers.get("music-room:room-deleted")?.({
      sourceId: "other-instance",
      roomId: "room_1",
      trackIds: "track_1"
    });
    handlers.get("music-room:room-snapshot-missing")?.({
      sourceId: "other-instance",
      roomId: ""
    });

    expect(emit).not.toHaveBeenCalledWith("room.deleted", expect.anything());
    expect(emit).not.toHaveBeenCalledWith("room.snapshot.missing", expect.anything());
    expect(trackAvailabilityRegistry.getTrackAnnouncements("room_1", "track_1")).toEqual([
      availability
    ]);
    expect(metrics.snapshot()).toEqual(expect.objectContaining({ activeRooms: 1 }));
  });

  it("ignores invalid redis peer signals before routing or queueing them", async () => {
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
        channelKind: "media",
        type: "offer",
        payload: {}
      }
    });

    expect(gateway.server.to).not.toHaveBeenCalledWith("socket_peer_b");
    expect(emit).not.toHaveBeenCalledWith("peer.signal", expect.anything());
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
    const compactPayload = compactTrackAvailabilityAnnouncement(payload);

    expect(result).toEqual(compactPayload);
    expect(client.to).toHaveBeenCalledWith("room_1");
    expect(emit).toHaveBeenCalledWith("piece.availability", compactPayload);
    expect(redisService.publish).toHaveBeenCalledWith(
      "music-room:piece-availability",
      expect.objectContaining({
        roomId: "room_1",
        payload: compactPayload
      })
    );
  });

  it("rejects invalid piece availability before broadcasting or persisting it", async () => {
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

    await expect(
      gateway.handlePieceAvailability(client as never, {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_1",
        nickname: "Host",
        totalChunks: 4,
        chunkSize: 0,
        availableChunks: [0],
        source: "live_upload",
        announcedAt: new Date().toISOString()
      } as never)
    ).rejects.toMatchObject({
      error: {
        code: "VALIDATION_FAILED"
      }
    });

    expect(emit).not.toHaveBeenCalled();
    expect(redisService.publish).not.toHaveBeenCalledWith(
      "music-room:piece-availability",
      expect.anything()
    );
  });

  it("replays registered availability and asks room sources to reannounce on demand", async () => {
    const { gateway, trackAvailabilityRegistry } = createGateway();
    const roomEmit = jest.fn();
    const client = {
      ...createClient({
        roomId: "room_1",
        peerId: "peer_listener",
        isRealtimeAuthenticated: true
      }),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: roomEmit })
    };
    const availability = {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_source",
      nickname: "Source",
      totalChunks: 2,
      chunkSize: 1024,
      availableChunks: [0, 1],
      source: "live_upload" as const,
      announcedAt: new Date().toISOString()
    };
    trackAvailabilityRegistry.setAnnouncement("room_1", availability);
    const compactAvailability = compactTrackAvailabilityAnnouncement(availability);

    await gateway.handlePieceAvailabilityRequest(client as never, {
      roomId: "room_1",
      trackId: "track_1",
      requesterPeerId: "peer_listener"
    });

    expect(client.emit).toHaveBeenCalledWith("piece.availability", compactAvailability);
    expect(roomEmit).toHaveBeenCalledWith("piece.availability.request", {
      roomId: "room_1",
      trackId: "track_1",
      requesterPeerId: "peer_listener"
    });
  });

  it("publishes peer signals so they can cross server instances", async () => {
    const { gateway, redisService } = createGateway();
    attachServerMock(gateway);
    const payload = {
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "data" as const,
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

  it("rejects invalid peer signals before routing or publishing them", async () => {
    const { gateway, redisService } = createGateway();
    const { emit } = attachServerMock(gateway);

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
          channelKind: "media",
          type: "offer",
          payload: {}
        } as never
      )
    ).rejects.toMatchObject({
      error: {
        code: "VALIDATION_FAILED"
      }
    });

    expect(emit).not.toHaveBeenCalledWith("peer.signal", expect.anything());
    expect(redisService.publish).not.toHaveBeenCalledWith(
      "music-room:peer-signal",
      expect.anything()
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

  it("derives chat sender identity from the authenticated socket session", async () => {
    const { gateway, authService } = createGateway();
    const emit = jest.fn();
    const client = {
      ...createClient({
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host",
        isRealtimeAuthenticated: true
      }),
      to: jest.fn().mockReturnValue({ emit })
    };

    const result = await gateway.handleRoomChat(client as never, {
      roomId: "room_1",
      content: " hello ",
      timestamp: 10
    });

    expect(authService.getUserOrThrow).toHaveBeenCalledWith("guest_host");
    expect(result).toEqual({
      roomId: "room_1",
      senderId: "guest_host",
      senderName: "Host",
      content: "hello",
      timestamp: 10
    });
    expect(emit).toHaveBeenCalledWith("room.chat", result);
  });

  it("rejects invalid chat payloads before broadcasting", async () => {
    const { gateway } = createGateway();
    const emit = jest.fn();
    const client = {
      ...createClient({
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: "peer_host",
        isRealtimeAuthenticated: true
      }),
      to: jest.fn().mockReturnValue({ emit })
    };

    await expect(
      gateway.handleRoomChat(client as never, {
        roomId: "room_1",
        content: ""
      })
    ).rejects.toMatchObject({
      error: {
        code: "VALIDATION_FAILED"
      }
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects invalid room subscribe payloads before mutating realtime presence", async () => {
    const { gateway, roomService } = createGateway();
    const client = createClient();

    await expect(
      gateway.handleRoomSubscribe(client as never, {
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: 123
      } as never)
    ).rejects.toMatchObject({
      error: {
        code: "VALIDATION_FAILED"
      }
    });

    expect(roomService.updatePeerPresence).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it("rejects invalid room presence payloads before refreshing presence", async () => {
    const { gateway, roomService } = createGateway();
    const client = createClient({
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host",
      isRealtimeAuthenticated: true
    });

    await expect(
      gateway.handleRoomPresence(client as never, {
        roomId: "room_1",
        sessionId: "guest_host",
        peerId: 123
      } as never)
    ).rejects.toMatchObject({
      error: {
        code: "VALIDATION_FAILED"
      }
    });

    expect(roomService.refreshRealtimePresence).not.toHaveBeenCalled();
  });

  it("rejects invalid room unsubscribe payloads before clearing local peer state", () => {
    const { gateway, trackAvailabilityRegistry } = createGateway();
    const { emit } = attachServerMock(gateway);
    const availability = {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_host",
      nickname: "Host",
      totalChunks: 4,
      chunkSize: 128 * 1024,
      availableChunks: [0, 1, 2, 3],
      source: "local_cache" as const,
      announcedAt: new Date().toISOString()
    };
    trackAvailabilityRegistry.setAnnouncement("room_1", availability);
    const client = createClient({
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host",
      isRealtimeAuthenticated: true
    });

    expect(() =>
      gateway.handleRoomUnsubscribe(client as never, { roomId: 123 } as never)
    ).toThrow(expect.objectContaining({
      error: expect.objectContaining({
        code: "VALIDATION_FAILED"
      })
    }));

    expect(client.leave).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith("piece.availability.clear", expect.anything());
    expect(trackAvailabilityRegistry.getTrackAnnouncements("room_1", "track_1")).toEqual([
      availability
    ]);
  });

  it("keeps room subscriptions available when redis realtime is unavailable", async () => {
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
    ).resolves.toMatchObject({ ok: true });
  });

  it("keeps peer signals available when redis realtime is unavailable", async () => {
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
    ).resolves.toMatchObject({
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b"
    });
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

    expect(emit).toHaveBeenCalledWith("room.snapshot", snapshot);
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
    expect(emit).toHaveBeenCalledWith("room.snapshot", snapshot);
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
        channelKind: "data",
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

  it("replays redis TTL availability when local memory is empty", async () => {
    const redisAvailability = {
      roomId: "room_1",
      trackId: "track_redis",
      ownerPeerId: "peer_host",
      nickname: "Host",
      totalChunks: 6,
      chunkSize: 128 * 1024,
      availableChunks: [0, 1, 2, 3, 4, 5],
      source: "local_cache" as const,
      announcedAt: new Date().toISOString()
    };
    const { gateway, redisService } = createGateway({
      redisService: createRedisServiceMock({
        getJson: jest.fn().mockResolvedValue([redisAvailability])
      })
    });

    const client = createClient({ id: "socket_new" });
    const compactRedisAvailability = compactTrackAvailabilityAnnouncement(redisAvailability);
    await gateway.handleRoomSubscribe(client as never, {
      roomId: "room_1",
      sessionId: "guest_new",
      peerId: "peer_guest"
    });

    expect(redisService.getJson).toHaveBeenCalledWith("music-room:availability:room_1");
    expect(client.emit).toHaveBeenCalledWith("piece.availability", compactRedisAvailability);
  });

  it("ignores invalid piece availability received from redis before broadcasting or caching it", async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const { gateway, redisService, trackAvailabilityRegistry } = createGateway({
      redisService: createRedisServiceMock({
        subscribe: jest.fn(async (channel: string, next: (payload: unknown) => void) => {
          handlers.set(channel, next);
        })
      })
    });
    const { emit } = attachServerMock(gateway);

    gateway.afterInit();
    handlers.get("music-room:piece-availability")?.({
      sourceId: "other-instance",
      roomId: "room_1",
      payload: {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_bad",
        nickname: "Bad",
        totalChunks: 4,
        chunkSize: 0,
        availableChunks: [0],
        source: "local_cache",
        announcedAt: new Date().toISOString()
      }
    });

    expect(emit).not.toHaveBeenCalledWith("piece.availability", expect.anything());
    expect(trackAvailabilityRegistry.getTrackAnnouncements("room_1", "track_1")).toEqual([]);
    expect(redisService.setJson).not.toHaveBeenCalled();
  });

  it("ignores mismatched redis availability clear events before removing cached providers", async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const { gateway, trackAvailabilityRegistry } = createGateway({
      redisService: createRedisServiceMock({
        subscribe: jest.fn(async (channel: string, next: (payload: unknown) => void) => {
          handlers.set(channel, next);
        })
      })
    });
    const { emit } = attachServerMock(gateway);
    const availability = {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_cached",
      nickname: "Cached",
      totalChunks: 4,
      chunkSize: 128 * 1024,
      availableChunks: [0, 1, 2, 3],
      source: "local_cache" as const,
      announcedAt: new Date().toISOString()
    };
    trackAvailabilityRegistry.setAnnouncement("room_1", availability);

    gateway.afterInit();
    handlers.get("music-room:piece-availability-clear")?.({
      sourceId: "other-instance",
      roomId: "room_1",
      payload: {
        roomId: "room_2",
        ownerPeerId: "peer_cached",
        updatedAt: new Date().toISOString()
      }
    });

    expect(emit).not.toHaveBeenCalledWith("piece.availability.clear", expect.anything());
    expect(trackAvailabilityRegistry.getTrackAnnouncements("room_1", "track_1")).toEqual([
      availability
    ]);
  });

  it("queues peer signals until the target peer subscribes, then flushes them with the active recovery generation", async () => {
    jest.useFakeTimers();
    const { gateway } = createGateway();
    const { emit } = attachServerMock(gateway);

    await gateway.handleRoomSubscribe(
      createClient({ id: "socket_peer_a" }) as never,
      { roomId: "room_1", sessionId: "guest_a", peerId: "peer_a" }
    );
    jest.runAllTimers();
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
        channelKind: "data",
        type: "offer",
        payload: { type: "offer", sdp: "fake" }
      }
    );

    expect(emit).not.toHaveBeenCalledWith("peer.signal", expect.anything());

    const subscribeResult = await gateway.handleRoomSubscribe(
      createClient({ id: "socket_peer_b" }) as never,
      { roomId: "room_1", sessionId: "guest_b", peerId: "peer_b" }
    );
    jest.runAllTimers();

    expect(subscribeResult).toEqual(
      expect.objectContaining({
        ok: true,
        recoveryGeneration: expect.any(Number)
      })
    );
    expect(gateway.server.to).toHaveBeenCalledWith("socket_peer_b");
    expect(emit).toHaveBeenCalledWith(
      "peer.signal",
      expect.objectContaining({
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        recoveryGeneration: subscribeResult.recoveryGeneration
      })
    );
  });

  it("drops expired queued peer signals instead of replaying them after a late subscribe", async () => {
    jest.useFakeTimers();
    const { gateway } = createGateway();
    const { emit } = attachServerMock(gateway);

    await gateway.handleRoomSubscribe(
      createClient({ id: "socket_peer_a" }) as never,
      { roomId: "room_1", sessionId: "guest_a", peerId: "peer_a" }
    );
    jest.runAllTimers();
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
        channelKind: "data",
        type: "offer",
        payload: { type: "offer", sdp: "fake" }
      }
    );
    jest.advanceTimersByTime(10_001);

    await gateway.handleRoomSubscribe(
      createClient({ id: "socket_peer_b" }) as never,
      { roomId: "room_1", sessionId: "guest_b", peerId: "peer_b" }
    );
    jest.runAllTimers();

    expect(emit).not.toHaveBeenCalledWith(
      "peer.signal",
      expect.objectContaining({
        fromPeerId: "peer_a",
        toPeerId: "peer_b"
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

  it("rejects room unsubscribe payloads for a different room before clearing peer availability", async () => {
    const { gateway, trackAvailabilityRegistry } = createGateway();
    const { emit } = attachServerMock(gateway);
    const otherRoomAvailability = {
      roomId: "room_2",
      trackId: "track_2",
      ownerPeerId: "peer_host",
      nickname: "Host",
      totalChunks: 4,
      chunkSize: 128 * 1024,
      availableChunks: [0, 1, 2, 3],
      source: "local_cache" as const,
      announcedAt: new Date().toISOString()
    };
    trackAvailabilityRegistry.setAnnouncement("room_2", otherRoomAvailability);
    const client = createClient({
      id: "socket_host",
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host",
      isRealtimeAuthenticated: true
    });

    expect(() =>
      gateway.handleRoomUnsubscribe(client as never, { roomId: "room_2" })
    ).toThrow("Unauthorized realtime request.");

    expect(emit).not.toHaveBeenCalledWith("piece.availability.clear", expect.anything());
    expect(trackAvailabilityRegistry.getTrackAnnouncements("room_2", "track_2")).toEqual([
      otherRoomAvailability
    ]);
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

  it("treats same-peer resubscribe as seamless reconnect instead of duplicate-session replacement", async () => {
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
      sourceSessionId: "guest_host",
      sourcePeerId: "peer_host"
    });
    const roomService = createRoomServiceMock(snapshot);
    const { gateway } = createGateway({ roomService });
    const oldClient = createClient({
      id: "socket_old",
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host",
      isRealtimeAuthenticated: true
    });
    const newClient = createClient({ id: "socket_new" });
    attachServerMock(gateway, new Map([["socket_old", oldClient]]));

    await gateway.handleRoomSubscribe(oldClient as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host"
    });
    roomService.handleDuplicateSessionReplacement.mockClear();

    await gateway.handleRoomSubscribe(newClient as never, {
      roomId: "room_1",
      sessionId: "guest_host",
      peerId: "peer_host"
    });

    expect(roomService.handleDuplicateSessionReplacement).not.toHaveBeenCalled();
    expect(oldClient.emit).not.toHaveBeenCalledWith(
      "room.session.replaced",
      expect.anything()
    );
    expect(oldClient.leave).toHaveBeenCalledWith("room_1");
    expect(roomService.updatePeerPresence).toHaveBeenLastCalledWith(
      "room_1",
      "guest_host",
      "peer_host",
      "online"
    );
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
    await Promise.resolve();

    expect(emit).toHaveBeenCalledWith("room.snapshot", snapshot);
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
