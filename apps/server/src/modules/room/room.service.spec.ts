import { AuthService } from "../auth/auth.service";
import { RoomService } from "./room.service";

function createPrismaMock() {
  return {
    isAvailable: jest.fn(() => false),
    ensureAvailable: jest.fn(async () => false),
    guestSessions: {
      upsert: jest.fn(),
      findUnique: jest.fn()
    },
    roomStates: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn()
    },
    playlists: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn()
    }
  };
}

function createRedisMock() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
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
      const existing = sets.get(key) ?? new Set<string>();
      existing.add(value);
      sets.set(key, existing);
    }),
    removeFromSet: jest.fn(async (key: string, value: string) => {
      const existing = sets.get(key);
      existing?.delete(value);
    }),
    getSetMembers: jest.fn(async (key: string) => [...(sets.get(key) ?? new Set<string>())]),
    publish: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined)
  };
}

function createSignalingGatewayMock() {
  const availabilityByRoom = new Map<string, Map<string, unknown[]>>();
  return {
    setTrackAvailability(roomId: string, trackId: string, announcements: unknown[]) {
      const roomAvailability = availabilityByRoom.get(roomId) ?? new Map<string, unknown[]>();
      roomAvailability.set(trackId, announcements);
      availabilityByRoom.set(roomId, roomAvailability);
    },
    getTrackAvailabilityAnnouncements(roomId: string, trackId: string) {
      return (availabilityByRoom.get(roomId)?.get(trackId) ?? []) as Array<{
        roomId: string;
        trackId: string;
        ownerPeerId: string;
        nickname: string;
        totalChunks: number;
        chunkSize: number;
        availableChunks: number[];
        source: "live_upload" | "local_cache";
        announcedAt: string;
      }>;
    }
  };
}

describe("RoomService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows any room member to control playback and uses the track owner as source", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track One",
      artist: "Local Upload",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "abc123",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });
    await roomService.addQueueItem(snapshot.room.id, member.id, track.id);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "pause",
        actorSessionId: member.id
      })
    ).resolves.toMatchObject({
      status: "paused"
    });

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: track.id,
        actorSessionId: host.id,
        positionMs: 5000
      })
    ).resolves.toMatchObject({
      status: "playing",
      positionMs: 5000,
      sourceSessionId: host.id,
      sourceTrackId: track.id,
      sourcePeerId: "peer-host"
    });
  });

  it("uses the actor peer as source when the uploader starts playback before presence settles", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Immediate Playback",
      artist: "Local Upload",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "immediate-playback",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: track.id,
        actorSessionId: host.id,
        actorPeerId: "peer-host"
      } as Parameters<typeof roomService.updatePlayback>[1] & { actorPeerId: string })
    ).resolves.toMatchObject({
      status: "playing",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: "peer-host"
    });
  });

  it("increments room revision when playback changes", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Revision Track",
      artist: "Local Upload",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "revision-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });
    const beforePlayback = await roomService.getRoomSnapshot(snapshot.room.id, []);

    await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: host.id,
      actorPeerId: "peer-host"
    });

    const afterPlayback = await roomService.getRoomSnapshot(snapshot.room.id, []);
    expect(afterPlayback.room.roomRevision).toBe((beforePlayback.room.roomRevision ?? 0) + 1);
    expect(afterPlayback.room.playback.status).toBe("playing");
  });

  it("only allows the host or requester to remove a queue item", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const requester = await authService.createGuestSession("Requester");
    const otherMember = await authService.createGuestSession("Other");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, requester.id);
    await roomService.joinRoom(snapshot.room.id, otherMember.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track Two",
      artist: "Local Upload",
      album: null,
      durationMs: 90000,
      bitrate: null,
      fileHash: "def456",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const queueItem = await roomService.addQueueItem(snapshot.room.id, requester.id, track.id);

    await expect(
      roomService.removeQueueItem(snapshot.room.id, queueItem.id, otherMember.id)
    ).rejects.toThrow("Only the host or the requester can remove this queue item.");

    await expect(
      roomService.removeQueueItem(snapshot.room.id, queueItem.id, requester.id)
    ).resolves.toEqual([]);
  });

  it("keeps the host record offline and preserves host ownership when the host leaves", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const roomAfterLeave = await roomService.leaveRoom(snapshot.room.id, host.id);

    expect(roomAfterLeave.hostId).toBe(host.id);
    expect(roomAfterLeave.members).toHaveLength(2);
    expect(roomAfterLeave.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: host.id,
          role: "host"
        }),
        expect.objectContaining({
          id: member.id,
          role: "member"
        })
      ])
    );

    const snapshotAfterLeave = await roomService.getRoomSnapshot(snapshot.room.id, []);
    expect(
      snapshotAfterLeave.room.members.find((trackedMember) => trackedMember.id === host.id)
    ).toMatchObject({
      id: host.id,
      role: "host",
      presenceState: "offline",
      peerId: null
    });
  });

  it("clears the recent room record after a member leaves an existing room", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.leaveRoom(snapshot.room.id, member.id);

    const recentRoom = await roomService.getRecentRoomSnapshotForSession(member.id);

    expect(recentRoom).toBeNull();
  });

  it("keeps the room recoverable when the last active member leaves and only the offline host remains", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.leaveRoom(snapshot.room.id, member.id);

    const recovered = await roomService.getRecoverableRoomSnapshot(snapshot.room.id, host.id);
    expect(recovered).not.toBeNull();
    expect(recovered?.room.hostId).toBe(host.id);
    expect(recovered?.room.members).toHaveLength(1);
    expect(recovered?.room.members[0]).toMatchObject({
      id: host.id,
      role: "host",
      presenceState: "offline"
    });
  });

  it("imports a playlist back into the room queue when tracks exist in the room", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track Three",
      artist: "Local Upload",
      album: null,
      durationMs: 180000,
      bitrate: null,
      fileHash: "ghi789",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const queue = await roomService.importPlaylistToQueue(snapshot.room.id, member.id, [track.id]);

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      trackId: track.id,
      requestedById: member.id
    });

    const roomAfterImport = await roomService.getRoomSnapshot(snapshot.room.id, []);
    expect(roomAfterImport.room.playback).toMatchObject({
      status: "paused",
      currentTrackId: null,
      currentQueueItemId: null
    });
  });

  it("keeps playback paused when the first track is only added to queue", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Queued Only",
      artist: "Artist",
      album: null,
      durationMs: 100000,
      bitrate: null,
      fileHash: "queued-only",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const queueItem = await roomService.addQueueItem(snapshot.room.id, member.id, track.id);
    const roomAfterQueue = await roomService.getRoomSnapshot(snapshot.room.id, []);

    expect(queueItem.trackId).toBe(track.id);
    expect(roomAfterQueue.queue).toHaveLength(1);
    expect(roomAfterQueue.room.playback).toMatchObject({
      status: "paused",
      currentTrackId: null,
      currentQueueItemId: null
    });
  });

  it("allows the host to reorder the queue and jump to a queue item", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    const firstTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "First",
      artist: "Local Upload",
      album: null,
      durationMs: 100000,
      bitrate: null,
      fileHash: "first",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });
    const secondTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Second",
      artist: "Local Upload",
      album: null,
      durationMs: 100000,
      bitrate: null,
      fileHash: "second",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const firstQueueItem = await roomService.addQueueItem(snapshot.room.id, member.id, firstTrack.id);
    const secondQueueItem = await roomService.addQueueItem(snapshot.room.id, member.id, secondTrack.id);

    const reordered = await roomService.reorderQueue(snapshot.room.id, host.id, [
      secondQueueItem.id,
      firstQueueItem.id
    ]);
    expect(reordered[0]?.id).toBe(secondQueueItem.id);
    expect(reordered[1]?.position).toBe(1);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        queueItemId: secondQueueItem.id,
        actorSessionId: host.id
      })
    ).resolves.toMatchObject({
      currentTrackId: secondTrack.id,
      currentQueueItemId: secondQueueItem.id,
      status: "playing",
      sourceSessionId: host.id
    });
  });

  it("keeps the active queue item stable when the same track appears multiple times", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Repeat",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "repeat-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const firstQueueItem = await roomService.addQueueItem(snapshot.room.id, member.id, track.id);
    const secondQueueItem = await roomService.addQueueItem(snapshot.room.id, member.id, track.id);

    await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      queueItemId: firstQueueItem.id,
      actorSessionId: host.id
    });

    const nextPlayback = await roomService.updatePlayback(snapshot.room.id, {
      action: "next",
      actorSessionId: host.id
    });

    expect(nextPlayback.currentTrackId).toBe(track.id);
    expect(nextPlayback.currentQueueItemId).toBe(secondQueueItem.id);

    const previousPlayback = await roomService.updatePlayback(snapshot.room.id, {
      action: "prev",
      actorSessionId: host.id
    });

    expect(previousPlayback.currentTrackId).toBe(track.id);
    expect(previousPlayback.currentQueueItemId).toBe(firstQueueItem.id);
  });

  it("allows the original uploader to delete a track and removes it from queue and playback", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");

    const track = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Member Track",
      artist: "Artist",
      album: null,
      durationMs: 90000,
      bitrate: null,
      fileHash: "member-track-delete",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload"
    });

    await roomService.addQueueItem(snapshot.room.id, member.id, track.id);
    await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: member.id
    });

    await expect(
      roomService.removeTrack(snapshot.room.id, member.id, track.id)
    ).resolves.toEqual({ ok: true });

    const roomAfterDelete = await roomService.getRoomSnapshot(snapshot.room.id, []);
    expect(roomAfterDelete.tracks).toHaveLength(0);
    expect(roomAfterDelete.queue).toHaveLength(0);
    expect(roomAfterDelete.room.playback.currentTrackId).toBeNull();
  });

  it("blocks other members from deleting someone else's uploaded track", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Host Track",
      artist: "Artist",
      album: null,
      durationMs: 90000,
      bitrate: null,
      fileHash: "host-track-delete",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    await expect(
      roomService.removeTrack(snapshot.room.id, member.id, track.id)
    ).rejects.toThrow("Only the original uploader can delete this track.");
  });

  it("rejects playback when the track owner is offline", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    const memberTrack = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Member Track",
      artist: "Local Upload",
      album: null,
      durationMs: 60000,
      bitrate: null,
      fileHash: "member-track",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload"
    });

    await roomService.clearRealtimePresence(snapshot.room.id, member.id);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: memberTrack.id,
        actorSessionId: host.id
      })
    ).rejects.toThrow("Track owner is not online, so this song cannot be played right now.");
  });

  it("allows playback from an online cached peer when the uploader is offline", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const signalingGateway = createSignalingGatewayMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(
      authService,
      prisma as never,
      redis as never,
      signalingGateway as never
    );

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    const memberTrack = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Member Track",
      artist: "Local Upload",
      album: null,
      durationMs: 60_000,
      bitrate: null,
      fileHash: "member-track-cache-failover",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload",
      pieceManifest: {
        totalChunks: 4,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/mpeg"
      }
    });

    signalingGateway.setTrackAvailability(snapshot.room.id, memberTrack.id, [
      {
        roomId: snapshot.room.id,
        trackId: memberTrack.id,
        ownerPeerId: "peer-host",
        nickname: host.nickname,
        totalChunks: 4,
        chunkSize: 128 * 1024,
        availableChunks: [0, 1, 2, 3],
        source: "local_cache",
        announcedAt: new Date().toISOString()
      }
    ]);

    await roomService.clearRealtimePresence(snapshot.room.id, member.id);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: memberTrack.id,
        actorSessionId: host.id
      })
    ).resolves.toMatchObject({
      status: "playing",
      currentTrackId: memberTrack.id,
      sourceSessionId: host.id,
      sourcePeerId: "peer-host"
    });
  });

  it("rejects playback from a partial local-cache peer when the uploader is offline", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const signalingGateway = createSignalingGatewayMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(
      authService,
      prisma as never,
      redis as never,
      signalingGateway as never
    );

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    const memberTrack = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Partial Cache Track",
      artist: "Local Upload",
      album: null,
      durationMs: 60_000,
      bitrate: null,
      fileHash: "member-track-partial-cache",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload",
      pieceManifest: {
        totalChunks: 4,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/mpeg"
      }
    });

    signalingGateway.setTrackAvailability(snapshot.room.id, memberTrack.id, [
      {
        roomId: snapshot.room.id,
        trackId: memberTrack.id,
        ownerPeerId: "peer-host",
        nickname: host.nickname,
        totalChunks: 4,
        chunkSize: 128 * 1024,
        availableChunks: [0, 1],
        source: "local_cache",
        announcedAt: new Date().toISOString()
      }
    ]);

    await roomService.clearRealtimePresence(snapshot.room.id, member.id);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: memberTrack.id,
        actorSessionId: host.id
      })
    ).rejects.toThrow("Track owner is not online, so this song cannot be played right now.");
  });

  it("rejects playback from a cached peer whose full-looking chunks are duplicated or out of range", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const signalingGateway = createSignalingGatewayMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(
      authService,
      prisma as never,
      redis as never,
      signalingGateway as never
    );

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    const memberTrack = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Invalid Chunk Cache Track",
      artist: "Local Upload",
      album: null,
      durationMs: 60_000,
      bitrate: null,
      fileHash: "member-track-invalid-chunks",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload",
      pieceManifest: {
        totalChunks: 4,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/mpeg"
      }
    });

    signalingGateway.setTrackAvailability(snapshot.room.id, memberTrack.id, [
      {
        roomId: snapshot.room.id,
        trackId: memberTrack.id,
        ownerPeerId: "peer-host",
        nickname: host.nickname,
        totalChunks: 4,
        chunkSize: 128 * 1024,
        availableChunks: [0, 0, 0, 99],
        source: "local_cache",
        announcedAt: new Date().toISOString()
      }
    ]);

    await roomService.clearRealtimePresence(snapshot.room.id, member.id);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: memberTrack.id,
        actorSessionId: host.id
      })
    ).rejects.toThrow("Track owner is not online, so this song cannot be played right now.");
  });

  it("rejects playback from a partial live-upload announcement when the uploader is offline", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const signalingGateway = createSignalingGatewayMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(
      authService,
      prisma as never,
      redis as never,
      signalingGateway as never
    );

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    const memberTrack = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Partial Live Upload Track",
      artist: "Local Upload",
      album: null,
      durationMs: 60_000,
      bitrate: null,
      fileHash: "member-track-partial-live-upload",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload",
      pieceManifest: {
        totalChunks: 4,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/mpeg"
      }
    });

    signalingGateway.setTrackAvailability(snapshot.room.id, memberTrack.id, [
      {
        roomId: snapshot.room.id,
        trackId: memberTrack.id,
        ownerPeerId: "peer-host",
        nickname: host.nickname,
        totalChunks: 4,
        chunkSize: 128 * 1024,
        availableChunks: [0, 1],
        source: "live_upload",
        announcedAt: new Date().toISOString()
      }
    ]);

    await roomService.clearRealtimePresence(snapshot.room.id, member.id);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: memberTrack.id,
        actorSessionId: host.id
      })
    ).rejects.toThrow("Track owner is not online, so this song cannot be played right now.");
  });

  it("rejects playback from a full cached peer when the announced asset hash does not match the track", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const signalingGateway = createSignalingGatewayMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(
      authService,
      prisma as never,
      redis as never,
      signalingGateway as never
    );

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    const memberTrack = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Mismatched Cache Track",
      artist: "Local Upload",
      album: null,
      durationMs: 60_000,
      bitrate: null,
      fileHash: "member-track-good-hash",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload",
      pieceManifest: {
        totalChunks: 4,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/mpeg"
      }
    });

    signalingGateway.setTrackAvailability(snapshot.room.id, memberTrack.id, [
      {
        roomId: snapshot.room.id,
        trackId: memberTrack.id,
        ownerPeerId: "peer-host",
        nickname: host.nickname,
        assetKind: "relay",
        assetHash: "different-track-hash",
        totalChunks: 4,
        chunkSize: 128 * 1024,
        availableChunks: [0, 1, 2, 3],
        source: "local_cache",
        announcedAt: new Date().toISOString()
      }
    ]);

    await roomService.clearRealtimePresence(snapshot.room.id, member.id);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: memberTrack.id,
        actorSessionId: host.id
      })
    ).rejects.toThrow("Track owner is not online, so this song cannot be played right now.");
  });

  it("keeps playback snapshot consistent when a member pauses and seeks", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");

    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track Four",
      artist: "Local Upload",
      album: null,
      durationMs: 150000,
      bitrate: null,
      fileHash: "track-four",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: member.id,
      positionMs: 4000
    });

    const paused = await roomService.updatePlayback(snapshot.room.id, {
      action: "pause",
      actorSessionId: member.id,
      positionMs: 12000
    });

    expect(paused).toMatchObject({
      status: "paused",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: "peer-host",
      sourceTrackId: track.id,
      positionMs: 12000,
      startedAt: null
    });

    const seeked = await roomService.updatePlayback(snapshot.room.id, {
      action: "seek",
      actorSessionId: member.id,
      positionMs: 30000
    });

    expect(seeked).toMatchObject({
      status: "paused",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: "peer-host",
      sourceTrackId: track.id,
      positionMs: 30000,
      startedAt: null
    });
  });

  it("rejects stale playback writes with a version conflict", async () => {
    const prisma = createPrismaMock();
    const redis = {
      ...createRedisMock(),
      isAvailable: jest.fn(() => true)
    };
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Conflict",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "conflict-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const firstPlayback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: host.id,
      expectedVersion: snapshot.room.playback.playbackRevision
    });

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "pause",
        actorSessionId: host.id,
        expectedVersion: firstPlayback.playbackRevision - 1
      })
    ).rejects.toThrow("Playback state version conflict.");
  });

  it("reassigns the active source when the host leaves but the current track owner stays online", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");

    const memberTrack = await roomService.registerTrack(snapshot.room.id, member.id, {
      title: "Member Source",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "member-source",
      artworkUrl: null,
      ownerSessionId: member.id,
      ownerNickname: member.nickname,
      sourceType: "local_upload"
    });

    const playback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: memberTrack.id,
      actorSessionId: host.id,
      expectedVersion: snapshot.room.playback.playbackRevision
    });
    const roomAfterLeave = await roomService.leaveRoom(snapshot.room.id, host.id);

    expect(playback.sourceSessionId).toBe(member.id);
    expect(roomAfterLeave.hostId).toBe(host.id);
    expect(roomAfterLeave.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: host.id,
          role: "host"
        }),
        expect.objectContaining({
          id: member.id,
          role: "member"
        })
      ])
    );
    expect(roomAfterLeave.playback).toMatchObject({
      status: "playing",
      currentTrackId: memberTrack.id,
      sourceSessionId: member.id,
      sourcePeerId: "peer-member",
      sourceTrackId: memberTrack.id
    });
    expect(roomAfterLeave.playback.queueVersion).toBe(playback.queueVersion);
  });

  it("starts a different track from the beginning when play switches songs", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");

    const firstTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "First",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "first-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });
    const secondTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Second",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "second-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: firstTrack.id,
      actorSessionId: member.id,
      positionMs: 45000
    });

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: secondTrack.id,
        actorSessionId: member.id
      })
    ).resolves.toMatchObject({
      currentTrackId: secondTrack.id,
      positionMs: 0
    });
  });

  it("bumps the media epoch when switching tracks owned by the same online source", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

    const firstTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "First",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "same-owner-1",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });
    const secondTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Second",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "same-owner-2",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const firstPlayback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: firstTrack.id,
      actorSessionId: host.id
    });
    const secondPlayback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: secondTrack.id,
      actorSessionId: host.id
    });

    expect(secondPlayback.mediaEpoch).toBe(firstPlayback.mediaEpoch + 1);
  });

  it("keeps the same media epoch for pause, seek, and resume on the same source track", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.joinRoom(snapshot.room.id, member.id);

    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Stable Epoch",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "stable-epoch-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const playing = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: member.id
    });
    const paused = await roomService.updatePlayback(snapshot.room.id, {
      action: "pause",
      actorSessionId: member.id,
      positionMs: 5000
    });
    const seeked = await roomService.updatePlayback(snapshot.room.id, {
      action: "seek",
      actorSessionId: member.id,
      positionMs: 20000
    });
    const resumed = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      actorSessionId: member.id
    });

    expect(paused.mediaEpoch).toBe(playing.mediaEpoch);
    expect(seeked.mediaEpoch).toBe(playing.mediaEpoch);
    expect(resumed.mediaEpoch).toBe(playing.mediaEpoch);
  });

  it("pauses at the effective playback position when no client position is supplied", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-04T00:00:00.000Z"));
    try {
      const prisma = createPrismaMock();
      const redis = createRedisMock();
      const authService = new AuthService(prisma as never);
      const roomService = new RoomService(authService, prisma as never, redis as never);

      const host = await authService.createGuestSession("Host");
      const snapshot = await roomService.createRoom(host.id);
      await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

      const track = await roomService.registerTrack(snapshot.room.id, host.id, {
        title: "Pause Effective",
        artist: "Artist",
        album: null,
        durationMs: 120000,
        bitrate: null,
        fileHash: "pause-effective-track",
        artworkUrl: null,
        ownerSessionId: host.id,
        ownerNickname: host.nickname,
        sourceType: "local_upload"
      });

      await roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: track.id,
        actorSessionId: host.id,
        positionMs: 4000
      });

      jest.setSystemTime(new Date("2026-04-04T00:00:09.500Z"));

      const paused = await roomService.updatePlayback(snapshot.room.id, {
        action: "pause",
        actorSessionId: host.id
      });

      expect(paused.positionMs).toBe(13500);
      expect(paused.startedAt).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("clears playback with a single playback revision bump when next has no queue item", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "No Queue",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "no-queue-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const playing = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: host.id
    });

    const cleared = await roomService.updatePlayback(snapshot.room.id, {
      action: "next",
      actorSessionId: host.id
    });

    expect(cleared.currentTrackId).toBeNull();
    expect(cleared.playbackRevision).toBe(playing.playbackRevision + 1);
  });

  it("does not rewind an already playing track when play is submitted again", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-04T00:00:00.000Z"));
    try {
      const prisma = createPrismaMock();
      const redis = createRedisMock();
      const authService = new AuthService(prisma as never);
      const roomService = new RoomService(authService, prisma as never, redis as never);

      const host = await authService.createGuestSession("Host");
      const member = await authService.createGuestSession("Member");
      const snapshot = await roomService.createRoom(host.id);
      await roomService.joinRoom(snapshot.room.id, member.id);
      await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

      const track = await roomService.registerTrack(snapshot.room.id, host.id, {
        title: "No Rewind",
        artist: "Artist",
        album: null,
        durationMs: 120000,
        bitrate: null,
        fileHash: "no-rewind-track",
        artworkUrl: null,
        ownerSessionId: host.id,
        ownerNickname: host.nickname,
        sourceType: "local_upload"
      });

      const playing = await roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        trackId: track.id,
        actorSessionId: member.id
      });

      jest.setSystemTime(new Date("2026-04-04T00:00:05.000Z"));

      const repeatedPlay = await roomService.updatePlayback(snapshot.room.id, {
        action: "play",
        actorSessionId: member.id
      });

      expect(playing.positionMs).toBe(0);
      expect(repeatedPlay.currentTrackId).toBe(track.id);
      expect(repeatedPlay.positionMs).toBe(5000);
      expect(repeatedPlay.mediaEpoch).toBe(playing.mediaEpoch);
    } finally {
      jest.useRealTimers();
    }
  });

  it("restores the recent active room for a session from redis", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);

    const restored = await roomService.getRecentRoomSnapshotForSession(host.id);

    expect(restored).not.toBeNull();
    expect(restored?.room.id).toBe(snapshot.room.id);
    expect(redis.setString).toHaveBeenCalled();
  });

  it("refreshes the recent room when a member recovers an older room again", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const hostOne = await authService.createGuestSession("Host One");
    const hostTwo = await authService.createGuestSession("Host Two");
    const member = await authService.createGuestSession("Member");
    const firstRoom = await roomService.createRoom(hostOne.id);
    const secondRoom = await roomService.createRoom(hostTwo.id);

    await roomService.joinRoom(firstRoom.room.id, member.id);
    await roomService.joinRoom(secondRoom.room.id, member.id);

    await roomService.getRecoverableRoomSnapshot(firstRoom.room.id, member.id);
    const recentRoom = await roomService.getRecentRoomSnapshotForSession(member.id);

    expect(recentRoom).not.toBeNull();
    expect(recentRoom?.room.id).toBe(firstRoom.room.id);
  });

  it("drops a stale recent room when the session is no longer a member", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const firstRoom = await roomService.createRoom(host.id);
    const secondRoom = await roomService.createRoom(host.id);

    await roomService.joinRoom(firstRoom.room.id, member.id);
    await roomService.joinRoom(secondRoom.room.id, member.id);
    await roomService.leaveRoom(secondRoom.room.id, member.id);

    await roomService.rememberRecentRoom(secondRoom.room.id, host.id);
    await roomService.rememberRecentRoom(firstRoom.room.id, member.id);
    await (redis as ReturnType<typeof createRedisMock>).setString(
      "music-room:session:" + member.id + ":recent-room",
      secondRoom.room.id
    );

    const recentRoom = await roomService.getRecentRoomSnapshotForSession(member.id);

    expect(recentRoom).not.toBeNull();
    expect(recentRoom?.room.id).toBe(firstRoom.room.id);
  });

  it("creates a six-character uppercase join code", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);
    const host = await authService.createGuestSession("Host");

    const snapshot = await roomService.createRoom(host.id);

    expect(snapshot.room.joinCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("lists rooms from the redis registry when memory state is empty", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    const restoredService = new RoomService(authService, prisma as never, redis as never);

    const rooms = await restoredService.listRoomsForSession(host.id);

    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.room.id).toBe(snapshot.room.id);
    expect(redis.addToSet).toHaveBeenCalled();
  });

  it("only recovers a room for members of that room", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const outsider = await authService.createGuestSession("Outsider");
    const snapshot = await roomService.createRoom(host.id);

    await expect(
      roomService.getRecoverableRoomSnapshot(snapshot.room.id, outsider.id)
    ).resolves.toBeNull();
    await expect(
      roomService.getRecoverableRoomSnapshot(snapshot.room.id, host.id)
    ).resolves.toMatchObject({
      room: { id: snapshot.room.id }
    });
  });

  it("lists public rooms only when they still have active online members", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await expect(roomService.listPublicRooms()).resolves.toEqual([]);

    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await expect(roomService.listPublicRooms()).resolves.toHaveLength(1);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    await expect(roomService.listPublicRooms()).resolves.toHaveLength(1);

    await roomService.clearRealtimePresence(snapshot.room.id, member.id);
    await expect(roomService.listPublicRooms()).resolves.toHaveLength(1);

    await roomService.clearRealtimePresence(snapshot.room.id, host.id);
    await expect(roomService.listPublicRooms()).resolves.toEqual([]);
  });

  it("rejects joining a room with a duplicate nickname", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const duplicate = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);

    await expect(roomService.joinRoom(snapshot.room.id, duplicate.id)).rejects.toThrow(
      "Nickname already exists in this room."
    );
  });

  it("deduplicates repeated track registration by file hash for the same uploader", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);

    const firstTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Same",
      artist: "Artist",
      album: null,
      durationMs: 180_000,
      bitrate: null,
      sizeBytes: 1024,
      codec: "mp3",
      fileHash: "same-hash",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: "Host",
      sourceType: "local_upload"
    });

    const secondTrack = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Same",
      artist: "Artist",
      album: null,
      durationMs: 180_000,
      bitrate: null,
      sizeBytes: 1024,
      codec: "mp3",
      fileHash: "same-hash",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: "Host",
      sourceType: "local_upload"
    });

    const latestSnapshot = await roomService.getRoomSnapshot(snapshot.room.id, []);

    expect(secondTrack.id).toBe(firstTrack.id);
    expect(latestSnapshot.tracks.filter((track) => track.fileHash === "same-hash")).toHaveLength(1);
  });

  it("keeps the full room roster in snapshots even when some members are offline", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");

    const nextSnapshot = await roomService.getRoomSnapshot(snapshot.room.id, []);
    const hostEntry = nextSnapshot.room.members.find((entry) => entry.id === host.id);
    const memberEntry = nextSnapshot.room.members.find((entry) => entry.id === member.id);

    expect(nextSnapshot.room.members).toHaveLength(2);
    expect(hostEntry).toMatchObject({
      id: host.id,
      peerId: "peer-host",
      presenceState: "online"
    });
    expect(memberEntry).toMatchObject({
      id: member.id,
      peerId: null,
      presenceState: "offline"
    });
  });

  it("repairs stale offline presence on heartbeat refresh", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);

    const refreshed = await roomService.refreshRealtimePresence(
      snapshot.room.id,
      host.id,
      "peer-host"
    );
    const nextSnapshot = await roomService.getRoomSnapshot(snapshot.room.id, []);

    expect(refreshed.changed).toBe(true);
    expect(nextSnapshot.room.presenceRevision).toBe(1);
    expect(nextSnapshot.room.members.find((entry) => entry.id === host.id)).toMatchObject({
      id: host.id,
      peerId: "peer-host",
      presenceState: "online"
    });
  });

  it("keeps playback running while the active source is reconnecting", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Disconnect Source",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "disconnect-source-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const playback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: host.id
    });

    const roomAfterDisconnect = await roomService.updatePeerPresence(
      snapshot.room.id,
      host.id,
      null,
      "reconnecting"
    );
    const nextSnapshot = await roomService.getRoomSnapshot(snapshot.room.id, []);

    expect(playback.status).toBe("playing");
    expect(roomAfterDisconnect.playback).toMatchObject({
      status: "playing",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: "peer-host"
    });
    expect(roomAfterDisconnect.playback.positionMs).toBeGreaterThanOrEqual(0);
    expect(roomAfterDisconnect.playback.mediaEpoch).toBe(playback.mediaEpoch);
    expect(roomAfterDisconnect.playback.queueVersion).toBe(playback.queueVersion);
    expect(roomAfterDisconnect.playback.playbackRevision).toBe(playback.playbackRevision);
    expect(nextSnapshot.room.members.find((entry) => entry.id === host.id)).toMatchObject({
      id: host.id,
      peerId: null,
      presenceState: "reconnecting"
    });
    expect(nextSnapshot.room.playback).toMatchObject({
      status: "playing",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: "peer-host"
    });
  });

  it("bumps media epoch when the current source session reconnects with a new peer id", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.updatePeerPresence(snapshot.room.id, host.id, "peer-host", "online");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Source Peer Refresh",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "source-peer-refresh",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload",
      pieceManifest: {
        totalChunks: 2,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/mpeg"
      }
    });

    const playback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: host.id
    });
    const roomAfterReconnect = await roomService.updatePeerPresence(
      snapshot.room.id,
      host.id,
      "peer-host-reconnected",
      "online"
    );

    expect(roomAfterReconnect.playback.sourcePeerId).toBe("peer-host-reconnected");
    expect(roomAfterReconnect.playback.mediaEpoch).toBe(playback.mediaEpoch + 1);
    expect(roomAfterReconnect.playback.playbackRevision).toBe(playback.playbackRevision + 1);
    expect(roomAfterReconnect.playback.queueVersion).toBe(playback.queueVersion);
  });

  it("re-elects an online cached peer when the current source goes offline", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const signalingGateway = createSignalingGatewayMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(
      authService,
      prisma as never,
      redis as never,
      signalingGateway as never
    );

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.joinRoom(snapshot.room.id, member.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    await roomService.touchRealtimePresence(snapshot.room.id, member.id, "peer-member");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Disconnect Source",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "disconnect-source-reselect",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload",
      pieceManifest: {
        totalChunks: 6,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/mpeg"
      }
    });

    signalingGateway.setTrackAvailability(snapshot.room.id, track.id, [
      {
        roomId: snapshot.room.id,
        trackId: track.id,
        ownerPeerId: "peer-member",
        nickname: member.nickname,
        totalChunks: 6,
        chunkSize: 128 * 1024,
        availableChunks: [0, 1, 2, 3, 4, 5],
        source: "local_cache",
        announcedAt: new Date().toISOString()
      }
    ]);

    const playback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: host.id
    });

    const roomAfterDisconnect = await roomService.updatePeerPresence(
      snapshot.room.id,
      host.id,
      null,
      "offline"
    );
    const nextSnapshot = await roomService.getRoomSnapshot(snapshot.room.id, []);

    expect(playback.status).toBe("playing");
    expect(roomAfterDisconnect.playback).toMatchObject({
      status: "playing",
      currentTrackId: track.id,
      sourceSessionId: member.id,
      sourcePeerId: "peer-member",
      sourceTrackId: track.id
    });
    expect(roomAfterDisconnect.playback.playbackRevision).toBeGreaterThan(playback.playbackRevision);
    expect(nextSnapshot.room.playback).toMatchObject({
      status: "playing",
      currentTrackId: track.id,
      sourceSessionId: member.id,
      sourcePeerId: "peer-member"
    });
  });

  it("pauses playback and bumps media epoch when the active source session is replaced", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.touchRealtimePresence(snapshot.room.id, host.id, "peer-host");
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Active Source",
      artist: "Artist",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "active-source-track",
      artworkUrl: null,
      ownerSessionId: host.id,
      ownerNickname: host.nickname,
      sourceType: "local_upload"
    });

    const playback = await roomService.updatePlayback(snapshot.room.id, {
      action: "play",
      trackId: track.id,
      actorSessionId: host.id,
      positionMs: 3_500
    });

    const pausedPlayback = await roomService.handleDuplicateSessionReplacement(
      snapshot.room.id,
      host.id
    );
    const nextSnapshot = await roomService.getRoomSnapshot(snapshot.room.id, []);

    expect(playback.status).toBe("playing");
    expect(pausedPlayback).toMatchObject({
      status: "paused",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: null
    });
    expect(pausedPlayback.mediaEpoch).toBe(playback.mediaEpoch + 1);
    expect(pausedPlayback.playbackRevision).toBeGreaterThan(playback.playbackRevision);
    expect(pausedPlayback.positionMs).toBe(3_500);
    expect(nextSnapshot.room.playback).toMatchObject({
      status: "paused",
      currentTrackId: track.id,
      sourceSessionId: host.id,
      sourcePeerId: null
    });
  });

  it("allows the host to delete a room and blocks non-host members", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);
    await roomService.joinRoom(snapshot.room.id, member.id);

    await expect(roomService.deleteRoom(snapshot.room.id, member.id)).rejects.toThrow(
      "Only the host can delete this room."
    );

    await roomService.updatePeerPresence(snapshot.room.id, host.id, "peer-host");
    await roomService.updatePeerPresence(snapshot.room.id, member.id, "peer-member");

    await expect(roomService.deleteRoom(snapshot.room.id, host.id)).resolves.toEqual({ ok: true });
    await expect(roomService.getRoomSnapshot(snapshot.room.id, [])).rejects.toThrow(
      `Room not found: ${snapshot.room.id}`
    );
  });
});
