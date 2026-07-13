import { randomUUID } from "node:crypto";
import { computeAssetId } from "@music-room/shared";
import { PlaybackController } from "../playback/playback.controller";
import { MetricsService } from "../../common/metrics/metrics.service";
import { QueueController } from "../queue/queue.controller";
import { RoomRealtimePublisher } from "./services/room-realtime.publisher";
import { SignalingGateway } from "../signaling/signaling.gateway";
import { RoomRealtimeBroadcaster } from "../signaling/room-realtime.broadcaster";
import { TrackAvailabilityRegistry } from "../signaling/track-availability.registry";
import { RoomController } from "./room.controller";
import { RoomService } from "./room.service";

type FakeAuthSession = {
  id: string;
  userId: string;
  username: string;
  nickname: string;
  token: string;
  createdAt: string;
};

function createPrismaMock() {
  return {
    isAvailable: jest.fn(() => false),
    ensureAvailable: jest.fn(async () => false)
  };
}

function createRedisMock() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  return {
    isAvailable: jest.fn(() => true),
    setJson: jest.fn(async (key: string, payload: unknown) => {
      store.set(key, JSON.stringify(payload));
    }),
    getJson: jest.fn(async (key: string) => {
      const value = store.get(key);
      return value ? JSON.parse(value) : null;
    }),
    setString: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getString: jest.fn(async (key: string) => store.get(key) ?? null),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    addToSet: jest.fn(async (key: string, value: string) => {
      const current = sets.get(key) ?? new Set<string>();
      current.add(value);
      sets.set(key, current);
    }),
    removeFromSet: jest.fn(async (key: string, value: string) => {
      const current = sets.get(key);
      current?.delete(value);
    }),
    getSetMembers: jest.fn(async (key: string) => [...(sets.get(key) ?? new Set<string>())]),
    publish: jest.fn(async () => undefined),
    subscribe: jest.fn(async () => undefined)
  };
}

function createFakeAuthService() {
  const sessionsByToken = new Map<string, FakeAuthSession>();
  const usersById = new Map<
    string,
    {
      id: string;
      username: string;
      nickname: string;
    }
  >();

  return {
    async createGuestSession(nickname: string): Promise<FakeAuthSession> {
      const normalizedNickname = nickname.trim() || "User";
      const id = `user_${randomUUID()}`;
      const token = `token_${randomUUID()}`;
      const session: FakeAuthSession = {
        id,
        userId: id,
        username: `${normalizedNickname.toLowerCase().replace(/\s+/g, "-")}-${id.slice(-6)}`,
        nickname: normalizedNickname,
        token,
        createdAt: new Date().toISOString()
      };
      sessionsByToken.set(token, session);
      usersById.set(id, {
        id,
        username: session.username,
        nickname: session.nickname
      });
      return session;
    },

    async getAuthSessionByTokenOrThrow(token?: string) {
      if (!token) {
        throw new Error("Invalid session token.");
      }

      const session = sessionsByToken.get(token);
      if (!session) {
        throw new Error("Invalid session token.");
      }

      return session;
    },

    async assertSessionToken(userId: string, token?: string) {
      const session = await this.getAuthSessionByTokenOrThrow(token);
      if (session.userId !== userId) {
        throw new Error("Invalid session token.");
      }
      return session;
    },

    async getUserOrThrow(userId: string) {
      const user = usersById.get(userId);
      if (!user) {
        throw new Error(`Unknown user: ${userId}`);
      }

      return user;
    }
  };
}

function createPlaylistServiceMock() {
  return {
    listPlaylistsForRoom: jest.fn(async () => []),
    deletePlaylistsForRoom: jest.fn(async () => undefined),
    removeTrackFromPlaylists: jest.fn(async () => undefined)
  };
}

function createClient(input: {
  id: string;
  sessionToken: string;
  roomId?: string;
  sessionId?: string;
  peerId?: string;
  isRealtimeAuthenticated?: boolean;
}) {
  return {
    id: input.id,
    handshake: {
      auth: {
        sessionToken: input.sessionToken
      },
      headers: {}
    },
    data: {
      roomId: input.roomId,
      sessionId: input.sessionId,
      peerId: input.peerId,
      protocolVersion: 4,
      capabilities: ["segmented-opus-v1"],
      isRealtimeAuthenticated: input.isRealtimeAuthenticated ?? false
    },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: jest.fn() })
  };
}

function attachServerMock(
  gateway: SignalingGateway,
  broadcaster: RoomRealtimeBroadcaster
) {
  const events: Array<{ target: string; event: string; payload: unknown }> = [];
  const sockets = new Map<string, ReturnType<typeof createClient>>();
  const server = {
    to: jest.fn((target: string) => ({
      emit: (event: string, payload: unknown) => {
        events.push({ target, event, payload });
      }
    })),
    sockets: {
      sockets
    }
  } as never;
  gateway.server = server;
  broadcaster.setServer(server);

  return {
    events,
    sockets
  };
}

function createRealtimeHarness() {
  const prisma = createPrismaMock();
  const redis = createRedisMock();
  const authService = createFakeAuthService();
  const roomService = new RoomService(authService as never, prisma as never, redis as never);
  const broadcaster = new RoomRealtimeBroadcaster(redis as never);
  const trackAvailabilityRegistry = new TrackAvailabilityRegistry(redis as never);
  const metrics = new MetricsService();
  const roomRealtimePublisher = new RoomRealtimePublisher(
    roomService as never,
    broadcaster as never
  );
  const signalingGateway = new SignalingGateway(
    redis as never,
    roomService as never,
    roomRealtimePublisher as never,
    broadcaster as never,
    trackAvailabilityRegistry,
    authService as never,
    metrics
  );
  const playlistService = createPlaylistServiceMock();
  const roomController = new RoomController(
    roomService as never,
    roomRealtimePublisher as never,
    authService as never,
    playlistService as never
  );
  const queueController = new QueueController(
    roomService as never,
    roomRealtimePublisher as never,
    authService as never
  );
  const playbackController = new PlaybackController(
    roomService as never,
    roomRealtimePublisher as never,
    authService as never,
    metrics
  );

  return {
    prisma,
    redis,
    authService,
    roomService,
    broadcaster,
    trackAvailabilityRegistry,
    roomRealtimePublisher,
    metrics,
    signalingGateway,
    playlistService,
    roomController,
    queueController,
    playbackController
  };
}

describe("room realtime regression", () => {
  it("covers create, join, recover, realtime reconnect, room updates, leave, and delete", async () => {
    const {
      authService,
      roomService,
      broadcaster,
      signalingGateway,
      roomController,
      queueController,
      playbackController
    } = createRealtimeHarness();
    const { events, sockets } = attachServerMock(signalingGateway, broadcaster);
    const hostSession = await authService.createGuestSession("Host");
    const memberSession = await authService.createGuestSession("Member");

    const created = await roomController.createRoom(hostSession.token, {
      visibility: "public"
    });
    expect(created.room.hostId).toBe(hostSession.userId);
    expect(created.room.members).toHaveLength(1);

    const joinedSnapshot = await roomController.joinRoomByCode(memberSession.token, {
      joinCode: created.room.joinCode
    });
    expect(joinedSnapshot.room.members.map((member) => member.id)).toContain(memberSession.userId);

    const recentRoom = await roomController.getRecentRoom(memberSession.token);
    expect(recentRoom?.room.id).toBe(created.room.id);

    const recoveredRoom = await roomController.recoverRoom(created.room.id, memberSession.token);
    expect(recoveredRoom?.room.id).toBe(created.room.id);

    const hostClient = createClient({
      id: "socket_host",
      sessionToken: hostSession.token
    });
    const memberClient = createClient({
      id: "socket_member",
      sessionToken: memberSession.token
    });
    sockets.set(hostClient.id, hostClient);
    sockets.set(memberClient.id, memberClient);

    await signalingGateway.handleRoomSubscribe(hostClient as never, {
      roomId: created.room.id,
      sessionId: hostSession.userId,
      peerId: "peer_host"
    });
    await signalingGateway.handleRoomSubscribe(memberClient as never, {
      roomId: created.room.id,
      sessionId: memberSession.userId,
      peerId: "peer_member"
    });

    const originalManifest = {
      kind: "original" as const,
      fileHash: "a".repeat(64),
      mimeType: "audio/mpeg",
      sizeBytes: 1024,
      unitSize: 1_048_576 as const,
      unitCount: 1,
      merkleRoot: "c".repeat(64)
    };
    const playbackManifest = {
      kind: "playback" as const,
      sourceFileHash: "a".repeat(64),
      profileId: "opus-music-v2" as const,
      codec: "opus" as const,
      container: "audio/ogg" as const,
      sampleRate: 48_000 as const,
      channels: 2 as const,
      bitrate: 192_000 as const,
      durationMs: 180_000,
      segmentDurationMs: 2_000 as const,
      seekPrerollMs: 80 as const,
      unitCount: 90,
      merkleRoot: "e".repeat(64),
      encoder: { name: "@audio/opus-encode" as const, version: "2.0.0" as const }
    };
    const originalAssetId = await computeAssetId(originalManifest);
    const playbackAssetId = await computeAssetId(playbackManifest);
    const track = await roomController.registerTrack(created.room.id, hostSession.token, {
      title: "Realtime Track",
      artist: "Artist",
      album: null,
      durationMs: 180000,
      bitrate: null,
      sizeBytes: 1024,
      codec: "mp3",
      mimeType: "audio/mpeg",
      fileHash: "a".repeat(64),
      artworkUrl: null,
      sourceType: "local_upload",
      originalAsset: {
        ...originalManifest,
        assetId: originalAssetId
      },
      playbackAsset: {
        ...playbackManifest,
        assetId: playbackAssetId
      }
    });
    expect(track.ownerSessionId).toBe(hostSession.userId);

    await signalingGateway.handleAssetAvailability(hostClient as never, {
      protocolVersion: 4,
      roomId: created.room.id,
      assetId: playbackAssetId,
      assetKind: "playback",
      ownerPeerId: "peer_host",
      nickname: "Host",
      totalUnits: 90,
      availableRanges: [{ start: 0, end: 89 }],
      complete: true,
      source: "live_upload",
      announcedAt: new Date().toISOString()
    });

    const queueState = await queueController.addQueueItem(created.room.id, memberSession.token, {
      trackId: track.id
    });
    expect(queueState.queue).toHaveLength(1);

    const playbackRequestedAt = Date.now();
    const playback = await playbackController.updatePlayback(
      created.room.id,
      hostSession.token,
      {
        action: "play",
        trackId: track.id,
        expectedVersion: queueState.playback.playbackRevision
      }
    );
    expect(playback).toMatchObject({
      status: "playing",
      currentTrackId: track.id,
      playbackAssetId,
      sourceSessionId: null,
      sourcePeerId: null,
      startAt: expect.any(String)
    });
    expect(Date.parse(playback.startAt ?? "")).toBeGreaterThanOrEqual(playbackRequestedAt);
    expect(Date.parse(playback.startAt ?? "")).toBeLessThanOrEqual(Date.now());

    const seekRequestedAt = Date.now();
    const seekedPlayback = await playbackController.updatePlayback(
      created.room.id,
      hostSession.token,
      {
        action: "seek",
        positionMs: 60_000,
        playbackAssetId,
        expectedVersion: playback.playbackRevision
      }
    );
    expect(seekedPlayback.positionMs).toBe(60_000);
    expect(Date.parse(seekedPlayback.startAt ?? "")).toBeGreaterThanOrEqual(seekRequestedAt);
    expect(Date.parse(seekedPlayback.startAt ?? "")).toBeLessThanOrEqual(Date.now());

    signalingGateway.handleDisconnect(
      createClient({
        id: memberClient.id,
        sessionToken: memberSession.token,
        roomId: created.room.id,
        sessionId: memberSession.userId,
        peerId: "peer_member",
        isRealtimeAuthenticated: true
      }) as never
    );

    const reconnectedMemberClient = createClient({
      id: "socket_member_reconnected",
      sessionToken: memberSession.token
    });
    sockets.set(reconnectedMemberClient.id, reconnectedMemberClient);
    await signalingGateway.handleRoomSubscribe(reconnectedMemberClient as never, {
      roomId: created.room.id,
      sessionId: memberSession.userId,
      peerId: "peer_member_reconnected"
    });

    const snapshotAfterReconnect = await roomService.getRoomSnapshot(created.room.id, []);
    expect(snapshotAfterReconnect.tracks).toHaveLength(1);
    expect(snapshotAfterReconnect.queue).toHaveLength(1);
    expect(snapshotAfterReconnect.room.playback).toMatchObject({
      status: "playing",
      currentTrackId: track.id
    });
    expect(
      snapshotAfterReconnect.room.members.find((member) => member.id === memberSession.userId)
    ).toMatchObject({
      peerId: "peer_member_reconnected",
      presenceState: "online"
    });

    const leaveResult = await roomController.leaveRoom(created.room.id, memberSession.token);
    expect(leaveResult.members.some((member) => member.id === memberSession.userId)).toBe(false);
    await expect(roomController.getRecentRoom(memberSession.token)).resolves.toBeNull();

    await expect(roomController.deleteRoom(created.room.id, hostSession.token)).resolves.toEqual({
      ok: true
    });
    await expect(roomController.getRecentRoom(hostSession.token)).resolves.toBeNull();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: created.room.id,
          event: "room.library.patch",
          payload: expect.objectContaining({
            roomId: created.room.id,
            tracks: expect.arrayContaining([expect.objectContaining({ id: track.id })])
          })
        }),
        expect.objectContaining({
          target: created.room.id,
          event: "room.queue.patch",
          payload: expect.objectContaining({
            roomId: created.room.id,
            queue: expect.arrayContaining([expect.objectContaining({ trackId: track.id })])
          })
        }),
        expect.objectContaining({
          target: created.room.id,
          event: "room.playback.patch",
          payload: expect.objectContaining({
            roomId: created.room.id,
            playback: expect.objectContaining({
              currentTrackId: track.id,
              status: "playing"
            })
          })
        }),
        expect.objectContaining({
          target: created.room.id,
          event: "room.deleted",
          payload: {
            roomId: created.room.id,
            trackIds: [track.id]
          }
        }),
        expect.objectContaining({
          target: created.room.id,
          event: "room.snapshot.missing",
          payload: {
            roomId: created.room.id
          }
        })
      ])
    );
  });

  it("keeps join and leave presence revisions monotonic across presence patches", async () => {
    const {
      authService,
      broadcaster,
      signalingGateway,
      roomController
    } = createRealtimeHarness();
    const { events, sockets } = attachServerMock(signalingGateway, broadcaster);
    const hostSession = await authService.createGuestSession("Host");
    const memberSession = await authService.createGuestSession("Member");

    const created = await roomController.createRoom(hostSession.token, {
      visibility: "public"
    });
    const hostClient = createClient({
      id: "socket_host_join_leave",
      sessionToken: hostSession.token
    });
    const memberClient = createClient({
      id: "socket_member_join_leave",
      sessionToken: memberSession.token
    });
    sockets.set(hostClient.id, hostClient);
    sockets.set(memberClient.id, memberClient);

    await signalingGateway.handleRoomSubscribe(hostClient as never, {
      roomId: created.room.id,
      sessionId: hostSession.userId,
      peerId: "peer_host"
    });

    await roomController.joinRoomByCode(memberSession.token, {
      joinCode: created.room.joinCode
    });

    const joinPatchEvent = [...events]
      .reverse()
      .find(
        (event) =>
          event.target === created.room.id &&
          event.event === "room.presence.patch" &&
          (event.payload as { members?: Array<{ id: string }> }).members?.some(
            (member) => member.id === memberSession.userId
          )
      );

    expect(joinPatchEvent).toBeDefined();
    expect((joinPatchEvent?.payload as { presenceRevision: number }).presenceRevision)
      .toBeGreaterThan(0);
    expect(
      (joinPatchEvent?.payload as {
        members: Array<{ id: string; peerId: string | null; presenceState: string }>;
      }).members.find((member) => member.id === memberSession.userId)
    ).toMatchObject({
      id: memberSession.userId,
      peerId: null,
      presenceState: "offline"
    });

    await signalingGateway.handleRoomSubscribe(memberClient as never, {
      roomId: created.room.id,
      sessionId: memberSession.userId,
      peerId: "peer_member"
    });

    const joinPresencePatchEvent = [...events]
      .reverse()
      .find(
        (event) =>
          event.target === created.room.id &&
          event.event === "room.presence.patch" &&
          (event.payload as { members?: Array<{ id: string }> }).members?.some(
            (member) => member.id === memberSession.userId
          )
      );

    expect(joinPresencePatchEvent).toBeDefined();
    expect(
      (joinPresencePatchEvent?.payload as { presenceRevision: number }).presenceRevision
    ).toBeGreaterThan(
      (joinPatchEvent?.payload as { presenceRevision: number }).presenceRevision
    );
    expect(
      (joinPresencePatchEvent?.payload as {
        members: Array<{ id: string; peerId: string | null; presenceState: string }>;
      }).members.find((member) => member.id === memberSession.userId)
    ).toMatchObject({
      id: memberSession.userId,
      peerId: "peer_member",
      presenceState: "online"
    });

    await roomController.leaveRoom(created.room.id, memberSession.token);

    const leavePatchEvent = [...events]
      .reverse()
      .find(
        (event) =>
          event.target === created.room.id &&
          event.event === "room.presence.patch" &&
          !(event.payload as { members?: Array<{ id: string }> }).members?.some(
            (member) => member.id === memberSession.userId
          )
      );

    expect(leavePatchEvent).toBeDefined();
    expect((leavePatchEvent?.payload as { presenceRevision: number }).presenceRevision)
      .toBeGreaterThan(
        (joinPresencePatchEvent?.payload as { presenceRevision: number }).presenceRevision
      );
    expect(
      (leavePatchEvent?.payload as { members: Array<{ id: string }> }).members.some(
        (member) => member.id === memberSession.userId
      )
    ).toBe(false);
  });

  it("broadcasts a fresh online presence patch when a member rejoins after leaving", async () => {
    const {
      authService,
      broadcaster,
      signalingGateway,
      roomController
    } = createRealtimeHarness();
    const { events, sockets } = attachServerMock(signalingGateway, broadcaster);
    const hostSession = await authService.createGuestSession("Host");
    const memberSession = await authService.createGuestSession("Member");

    const created = await roomController.createRoom(hostSession.token, {
      visibility: "public"
    });
    const hostClient = createClient({
      id: "socket_host_rejoin",
      sessionToken: hostSession.token
    });
    const memberClient = createClient({
      id: "socket_member_rejoin",
      sessionToken: memberSession.token
    });
    sockets.set(hostClient.id, hostClient);
    sockets.set(memberClient.id, memberClient);

    await signalingGateway.handleRoomSubscribe(hostClient as never, {
      roomId: created.room.id,
      sessionId: hostSession.userId,
      peerId: "peer_host"
    });

    await roomController.joinRoomByCode(memberSession.token, {
      joinCode: created.room.joinCode
    });
    await signalingGateway.handleRoomSubscribe(memberClient as never, {
      roomId: created.room.id,
      sessionId: memberSession.userId,
      peerId: "peer_member"
    });

    await roomController.leaveRoom(created.room.id, memberSession.token);

    const rejoined = await roomController.joinRoomByCode(memberSession.token, {
      joinCode: created.room.joinCode
    });
    await signalingGateway.handleRoomSubscribe(memberClient as never, {
      roomId: rejoined.room.id,
      sessionId: memberSession.userId,
      peerId: "peer_member_rejoined"
    });

    const finalPresencePatchEvent = [...events]
      .reverse()
      .find(
        (event) =>
          event.target === created.room.id &&
          event.event === "room.presence.patch" &&
          (event.payload as { members?: Array<{ id: string; peerId: string | null; presenceState: string }> })
            .members?.some(
              (member) =>
                member.id === memberSession.userId &&
                member.peerId === "peer_member_rejoined" &&
                member.presenceState === "online"
            )
      );

    expect(finalPresencePatchEvent).toBeDefined();
    expect(
      (
        finalPresencePatchEvent?.payload as {
          members: Array<{ id: string; peerId: string | null; presenceState: string }>;
        }
      ).members.filter((member) => member.presenceState === "online" && !!member.peerId)
    ).toHaveLength(2);
  });
});
