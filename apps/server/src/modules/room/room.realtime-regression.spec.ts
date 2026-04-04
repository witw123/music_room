import { randomUUID } from "node:crypto";
import { PlaybackController } from "../playback/playback.controller";
import { QueueController } from "../queue/queue.controller";
import { SignalingGateway } from "../signaling/signaling.gateway";
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

    async getSessionOrThrow(userId: string) {
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
      isRealtimeAuthenticated: input.isRealtimeAuthenticated ?? false
    },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: jest.fn() })
  };
}

function attachServerMock(gateway: SignalingGateway) {
  const events: Array<{ target: string; event: string; payload: unknown }> = [];
  const sockets = new Map<string, ReturnType<typeof createClient>>();
  gateway.server = {
    to: jest.fn((target: string) => ({
      emit: (event: string, payload: unknown) => {
        events.push({ target, event, payload });
      }
    })),
    sockets: {
      sockets
    }
  } as never;

  return {
    events,
    sockets
  };
}

describe("room realtime regression", () => {
  it("covers create, join, recover, realtime reconnect, room updates, leave, and delete", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = createFakeAuthService();
    const roomService = new RoomService(authService as never, prisma as never, redis as never);
    const moduleRef = {
      get: jest.fn().mockReturnValue(roomService)
    };
    const signalingGateway = new SignalingGateway(
      redis as never,
      moduleRef as never,
      authService as never
    );
    const playlistService = createPlaylistServiceMock();
    const roomController = new RoomController(
      roomService as never,
      signalingGateway as never,
      authService as never,
      playlistService as never
    );
    const queueController = new QueueController(
      roomService as never,
      signalingGateway as never,
      authService as never
    );
    const playbackController = new PlaybackController(
      roomService as never,
      signalingGateway as never,
      authService as never
    );
    const { events, sockets } = attachServerMock(signalingGateway);
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

    const track = await roomController.registerTrack(created.room.id, hostSession.token, {
      title: "Realtime Track",
      artist: "Artist",
      album: null,
      durationMs: 180000,
      bitrate: null,
      sizeBytes: 1024,
      codec: "mp3",
      mimeType: "audio/mpeg",
      fileHash: "realtime-track-hash",
      artworkUrl: null,
      sourceType: "local_upload"
    });
    expect(track.ownerSessionId).toBe(hostSession.userId);

    const queueState = await queueController.addQueueItem(created.room.id, memberSession.token, {
      trackId: track.id
    });
    expect(queueState.queue).toHaveLength(1);

    const playback = await playbackController.updatePlayback(
      created.room.id,
      hostSession.token,
      {
        action: "play",
        trackId: track.id,
        expectedVersion: queueState.playback.queueVersion
      }
    );
    expect(playback).toMatchObject({
      status: "playing",
      currentTrackId: track.id,
      sourceSessionId: hostSession.userId,
      sourcePeerId: "peer_host"
    });

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
});
